import type { Contact } from "@/lib/document/schema";
import { displayUrl, normalizeUrl } from "@/lib/profile";

/**
 * Which contact details appear in the resume header.
 *
 * Per-resume rather than per-profile: the same candidate applying abroad may
 * want the country shown, and applying at home may not. It lives in
 * ResumeStyle alongside template and accent, and is saved with the document.
 *
 * Defaults follow US convention — city and state and postal code, no country.
 * A country line is noise when everyone reading it is in the same one.
 */
export type HeaderFields = {
  email: boolean;
  phone: boolean;
  city: boolean;
  state: boolean;
  postalCode: boolean;
  country: boolean;
  links: boolean;
};

export const HEADER_DEFAULTS: HeaderFields = {
  email: true,
  phone: true,
  city: true,
  state: true,
  postalCode: true,
  country: false,
  links: true,
};

export const HEADER_FIELD_LABELS: Array<{ key: keyof HeaderFields; label: string }> = [
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "postalCode", label: "Postal code" },
  { key: "country", label: "Country" },
  { key: "links", label: "Links" },
];

export function resolveHeaderFields(
  header?: Partial<HeaderFields>,
): HeaderFields {
  return { ...HEADER_DEFAULTS, ...(header ?? {}) };
}

/**
 * "Boston, MA 02108" — the place line, built from whichever parts are enabled.
 *
 * Postal code joins the state with a space rather than a comma, which is how a
 * US address is actually written; everything else is comma-separated.
 */
export function composeLocation(
  contact: Contact,
  fields: HeaderFields,
): string | null {
  const city = fields.city ? contact.city?.trim() : null;
  const state = fields.state ? contact.state?.trim() : null;
  const postal = fields.postalCode ? contact.postalCode?.trim() : null;
  const country = fields.country ? contact.country?.trim() : null;

  const parts: string[] = [];
  if (city) parts.push(city);
  if (state || postal) parts.push([state, postal].filter(Boolean).join(" "));
  if (country) parts.push(country);

  if (parts.length) return parts.join(", ");

  // Documents written before the parts existed only have the joined string.
  // Showing it is better than dropping the location entirely, but it cannot be
  // filtered — re-saving the profile upgrades it.
  const hasAnyPart = Boolean(
    contact.city || contact.state || contact.postalCode || contact.country,
  );
  if (hasAnyPart) return null;
  return contact.location?.trim() || null;
}

/** The header's contact segments, in print order, with links kept clickable. */
export function headerSegments(
  contact: Contact,
  fields: HeaderFields,
): Array<{ text: string; href?: string }> {
  const segments: Array<{ text: string; href?: string }> = [];

  if (fields.email && contact.email?.trim()) {
    segments.push({ text: contact.email.trim() });
  }
  if (fields.phone && contact.phone?.trim()) {
    segments.push({ text: contact.phone.trim() });
  }

  const location = composeLocation(contact, fields);
  if (location) segments.push({ text: location });

  if (fields.links) {
    for (const link of contact.links) {
      if (link.url?.trim()) {
        segments.push({
          text: displayUrl(link.url),
          // Stored links are normalised on save, but a document written before
          // that could still hold a bare host — an annotation without a scheme
          // resolves relative to the viewer and goes nowhere.
          href: normalizeUrl(link.url) ?? link.url,
        });
      }
    }
  }

  return segments;
}
