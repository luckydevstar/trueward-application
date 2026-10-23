import dayjs from "dayjs";

import type {
  EducationValues,
  EmploymentValues,
  ProfileFormValues,
} from "@/components/profile-editor";
import { formatMonthYear, type ResumeProfile } from "@/lib/document/schema";
import {
  buildProfileDocument,
  normalizeUrl,
  type ProfileIdentity,
} from "@/lib/profile";

/**
 * Translation between the antd form (dayjs objects) and the stored shapes.
 *
 * Kept apart from src/lib/profile.ts so that module stays free of dayjs and can
 * be imported by anything, including the PDF renderer.
 */

/** dayjs → the "June 2024" string the document schema parses. */
function toMonthYear(value?: dayjs.Dayjs | null): string | undefined {
  return value ? value.format("MMMM YYYY") : undefined;
}

export type ProfileRowValues = {
  full_name: string;
  email: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  birthday: string | null;
  github_url: string | null;
  linkedin_url: string | null;
  company_context: string | null;
  profile: ResumeProfile;
};

const blank = (value?: string | null) => (value?.trim() ? value.trim() : null);

/**
 * Form values → the row to write.
 *
 * Throws if the derived document wouldn't validate — at save time, with the
 * form still on screen, rather than later inside the renderer.
 */
/**
 * An employer's id when none was typed: its company and start year,
 * "acme-2021", made unique against the ids the profile already has. Ids that
 * exist are never changed — resume content refers to employers by them.
 */
function employmentIds(employments: EmploymentValues[]): string[] {
  const taken = new Set(employments.map((e) => e.id?.trim()).filter(Boolean));
  return employments.map((e) => {
    const typed = e.id?.trim();
    if (typed) return typed;
    const slug =
      e.company
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "employer";
    const base = e.startDate ? `${slug}-${e.startDate.format("YYYY")}` : slug;
    let id = base;
    for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
    taken.add(id);
    return id;
  });
}

export function toProfileRow(values: ProfileFormValues): ProfileRowValues {
  const ids = employmentIds(values.employments ?? []);
  const identity: ProfileIdentity = {
    fullName: values.fullName.trim(),
    email: values.email.trim(),
    phone: blank(values.phone),
    address: blank(values.address),
    city: blank(values.city),
    state: blank(values.state),
    postalCode: blank(values.postalCode),
    country: blank(values.country),
    // Canonicalised on the way in, so what's stored is always absolute and the
    // display form can be derived from it anywhere.
    githubUrl: normalizeUrl(values.githubUrl),
    linkedinUrl: normalizeUrl(values.linkedinUrl),
    employments: (values.employments ?? []).map((e: EmploymentValues, index: number) => ({
      id: ids[index],
      company: e.company.trim(),
      location: blank(e.location),
      startDate: toMonthYear(e.startDate),
      endDate: toMonthYear(e.endDate),
      additionalInfo: blank(e.additionalInfo),
    })),
    education: (values.education ?? []).map((e: EducationValues) => ({
      school: e.school.trim(),
      degree: e.degree.trim(),
      location: blank(e.location),
      startYear: e.startYear ? e.startYear.format("YYYY") : undefined,
      year: e.year ? e.year.format("YYYY") : undefined,
      additionalInfo: blank(e.additionalInfo),
    })),
  } as ProfileIdentity;

  return {
    full_name: identity.fullName,
    email: identity.email,
    phone: identity.phone ?? null,
    address: identity.address ?? null,
    city: identity.city ?? null,
    state: identity.state ?? null,
    postal_code: identity.postalCode ?? null,
    country: identity.country ?? null,
    birthday: values.birthday ? values.birthday.format("YYYY-MM-DD") : null,
    github_url: identity.githubUrl ?? null,
    linkedin_url: identity.linkedinUrl ?? null,
    company_context: blank(values.companyContext),
    profile: buildProfileDocument(identity),
  };
}

type StoredRow = {
  full_name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  birthday: string | null;
  github_url: string | null;
  linkedin_url: string | null;
  company_context?: string | null;
  profile: ResumeProfile;
};

/**
 * Row → form values.
 *
 * Employments and education come back out of the JSONB rather than columns,
 * because that is where they live. Their dates are already parsed
 * `{year, month}` objects, so they go back through formatMonthYear before dayjs
 * sees them.
 */
export function toFormValues(row: StoredRow): ProfileFormValues {
  return {
    fullName: row.full_name,
    email: row.email ?? "",
    phone: row.phone ?? undefined,
    address: row.address ?? undefined,
    city: row.city ?? undefined,
    state: row.state ?? undefined,
    postalCode: row.postal_code ?? undefined,
    country: row.country ?? undefined,
    birthday: row.birthday ? dayjs(row.birthday) : null,
    githubUrl: row.github_url ?? undefined,
    linkedinUrl: row.linkedin_url ?? undefined,
    companyContext: row.company_context ?? undefined,
    employments: (row.profile?.employments ?? []).map((e) => ({
      id: e.id,
      company: e.company,
      location: e.location ?? undefined,
      startDate: dayjs(formatMonthYear(e.startDate), "MMMM YYYY"),
      endDate: e.endDate ? dayjs(formatMonthYear(e.endDate), "MMMM YYYY") : null,
      additionalInfo: e.additionalInfo ?? undefined,
    })),
    education: (row.profile?.education ?? []).map((e) => ({
      school: e.school,
      degree: e.degree,
      location: e.location ?? undefined,
      startYear: e.startYear ? dayjs(String(e.startYear.year), "YYYY") : null,
      year: e.year ? dayjs(String(e.year.year), "YYYY") : null,
      additionalInfo: e.additionalInfo ?? undefined,
    })),
  };
}
