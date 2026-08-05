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

/** "Boston, MA" — what a resume shows, assembled from the structured fields. */
export function displayLocation(identity: {
  city?: string | null;
  state?: string | null;
  country?: string | null;
}): string | null {
  const parts = [identity.city, identity.state, identity.country]
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p));
  return parts.length ? parts.join(", ") : null;
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
    { label: "GitHub", url: identity.githubUrl },
    { label: "LinkedIn", url: identity.linkedinUrl },
  ]
    .filter((l): l is { label: string; url: string } => Boolean(l.url?.trim()))
    .map((l) => ({ label: l.label, url: l.url.trim() }));

  return profileSchema.parse({
    fullName: identity.fullName,
    contact: {
      email: identity.email,
      phone: identity.phone || null,
      location: displayLocation(identity),
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
