import {
  profileSchema,
  type Employment,
  type EducationBlock,
  type ResumeProfile,
} from "@/lib/document/schema";

/**
 * A candidate's identity as the editor works with it.
 *
 * The structured columns are the source of truth: they are what an admin edits,
 * what the list sorts by, and where the PII lives. `candidate_profile.profile`
 * is a *derived* render payload — the profile half of a resume document, built
 * from these fields by buildProfileDocument() below.
 *
 * That derivation happens in exactly one place on purpose. Two writers of the
 * same facts drift; one writer and one reader cannot.
 *
 * Note what is deliberately absent from the derived payload: birthday, SSN,
 * street address, postal code. None of them belong on a resume, so they never
 * enter the document a renderer or a model can see.
 */
export type ProfileIdentity = {
  fullName: string;
  email: string;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  birthday?: string | null;
  githubUrl?: string | null;
  linkedinUrl?: string | null;
  employments: Array<Partial<Employment> & { id: string; company: string }>;
  education: Array<Partial<EducationBlock> & { school: string; degree: string }>;
};

/**
 * Canonicalises whatever someone typed into an absolute URL.
 *
 * Accepts "linkedin.com/in/jane" as readily as the full form — asking for a
 * scheme is a pointless hurdle when it can only ever be https here. Returns
 * null for anything that isn't a plausible host, so a stray word doesn't become
 * a dead link on a resume.
 */
export function normalizeUrl(input: string | null | undefined): string | null {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return null;

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    // "https://foo" parses fine but is not a real destination.
    return url.hostname.includes(".") ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * The short form a resume should print: "linkedin.com/in/janedoe".
 *
 * Derived rather than stored alongside the URL. A separate "handle" field would
 * be a second copy of the same fact — free to disagree with the URL the moment
 * someone edits one and not the other, and one more box to fill for every link.
 * There is nothing in "https://www." a reader needs, and the full URL is still
 * carried as the PDF's link annotation, so nothing is lost by hiding it.
 */
export function displayUrl(input: string): string {
  const fallback = input
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "");

  const normalized = normalizeUrl(input);
  if (!normalized) return fallback;

  try {
    const url = new URL(normalized);
    const host = url.hostname.replace(/^www\./i, "");
    const path = url.pathname.replace(/\/+$/, "");
    return `${host}${path}${url.search}`;
  } catch {
    return fallback;
  }
}


/**
 * Projects the identity onto the resume document's `profile` half and validates
 * it. Throws if the result wouldn't render — better here, at save time, with
 * the form still on screen, than later inside the PDF renderer.
 */
export function buildProfileDocument(identity: ProfileIdentity): ResumeProfile {
  // Only the two links the form offers, and only when filled in — an empty
  // "GitHub" would print a bare label with no URL.
  const links = [
    { label: "GitHub", url: normalizeUrl(identity.githubUrl) },
    { label: "LinkedIn", url: normalizeUrl(identity.linkedinUrl) },
  ].filter((l): l is { label: string; url: string } => Boolean(l.url));

  return profileSchema.parse({
    fullName: identity.fullName,
    contact: {
      email: identity.email,
      phone: identity.phone || null,
      // Parts, not a joined string: which of them prints is decided per resume
      // in the header settings, and a pre-joined value can't be filtered.
      city: identity.city || null,
      state: identity.state || null,
      postalCode: identity.postalCode || null,
      country: identity.country || null,
      links,
    },
    employments: identity.employments,
    education: identity.education,
  });
}

/** Digits only, for display as ***-**-1234. */
export function maskSsn(value: string | null | undefined): string {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length < 4) return "•••-••-••••";
  return `•••-••-${digits.slice(-4)}`;
}
