/**
 * Client-safe status vocabulary and the date handling that goes with it.
 *
 * Colors are antd `Tag` palette names rather than CSS classes, so a theme
 * change in src/lib/theme.ts carries here without edits.
 */

export const APPLICATION_STATUSES = [
  "applied",
  "viewed",
  "interviewing",
  "offer",
  "rejected",
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const STATUS_META: Record<
  ApplicationStatus,
  { label: string; color: string }
> = {
  applied: { label: "Applied", color: "default" },
  viewed: { label: "Viewed", color: "gold" },
  interviewing: { label: "Interviewing", color: "purple" },
  offer: { label: "Offer", color: "green" },
  rejected: { label: "Rejected", color: "red" },
};

/**
 * Billing state of an application, independent of its status.
 *
 * Default is "unbilled": a fresh application is pending billing, not
 * un-billable and certainly not yet billed.
 */
export const BILLING_STATUSES = ["unbillable", "unbilled", "billed"] as const;

export type BillingStatus = (typeof BILLING_STATUSES)[number];

export const BILLING_META: Record<
  BillingStatus,
  { label: string; color: string }
> = {
  unbillable: { label: "Unbillable", color: "default" },
  // The state that wants action.
  unbilled: { label: "Unbilled", color: "gold" },
  billed: { label: "Billed", color: "green" },
};

/** "upwork.com" from a full job URL, for a compact source label. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "link";
  }
}

/** Comparison key for the blocklist and duplicate detection. */
export function normalizeCompany(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Every date in the app is rendered and parsed in US Eastern.
 *
 * Named as a zone rather than the fixed "EST" offset so daylight saving is
 * handled — half the year Eastern is actually EDT (UTC-4), and a hardcoded
 * -05:00 would be an hour off from March to November.
 */
export const APP_TIME_ZONE = "America/New_York";

/**
 * "Date applied" is a calendar date, not an instant, so both ends must agree on
 * a zone. A date input yields "2026-07-15", which `new Date()` parses as UTC
 * midnight — already the 14th in Eastern. Parsing and rendering are therefore
 * both pinned to APP_TIME_ZONE, so the day you pick is the day you see. Mixing
 * the two hides on Vercel, whose runtime is UTC, and only shows up elsewhere.
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: APP_TIME_ZONE,
  });
}

/** Value for a date input, in APP_TIME_ZONE. */
export function toDateInput(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  // en-CA renders as YYYY-MM-DD, which is what date inputs want.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Offset of APP_TIME_ZONE from UTC at a given instant, in ms (negative west). */
function zoneOffsetMs(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const at = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);

  const wallAsUtc = Date.UTC(
    at("year"),
    at("month") - 1,
    at("day"),
    at("hour") % 24,
    at("minute"),
    at("second"),
  );
  return wallAsUtc - instant.getTime();
}

/** Parses "2026-07-15" as midnight in APP_TIME_ZONE. */
export function fromDateInput(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return new Date(NaN);

  const utcGuess = Date.UTC(y, m - 1, d, 0, 0, 0);
  // Resolve twice: the offset itself depends on the instant, which matters on
  // the two DST changeover days.
  const first = utcGuess - zoneOffsetMs(new Date(utcGuess));
  return new Date(utcGuess - zoneOffsetMs(new Date(first)));
}
