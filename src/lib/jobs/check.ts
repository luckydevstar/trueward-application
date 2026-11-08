import "server-only";

import { applicationNo, jobNo } from "@/lib/numbers";
import type { Actor } from "@/lib/roles";
import { normalizeCompany } from "@/lib/status";
import type { Db } from "@/lib/supabase/request";

/** The database's application_cooldown_days() (schema part 3). Change both together. */
export const COOLDOWN_DAYS = 14;

export type EarlierBid = {
  id: string;
  no: string;
  title: string;
  company: string;
  url: string;
  appliedAt: string;
  status: string;
  profileId: string | null;
  profileName: string | null;
  /** For the profile being checked — the one the cooldown counts. */
  thisProfile: boolean;
  /** The same posting, not just the same company. */
  sameUrl: boolean;
  /** When the cooldown on this one ends, while it hasn't. */
  reopensAt: string | null;
};

export type BidCheck = {
  /** On the profile's team's blocklist, by this name. */
  blocked: string | null;
  bids: EarlierBid[];
  /** This posting on your own job list already. */
  job: { id: string; no: string; title: string } | null;
};

/** A posting's address without what varies between visits: fragment, tracking parameters, trailing slash. */
export function postingKey(url: string): string | null {
  try {
    const u = new URL(url.trim());
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|gh_src|ref|source|src|trk|refId|trackingId|lever-)/i.test(key)) u.searchParams.delete(key);
    }
    u.hash = "";
    const path = u.pathname.replace(/\/+$/, "");
    const query = u.searchParams.toString();
    return `${u.host.replace(/^www\./, "")}${path}${query ? `?${query}` : ""}`.toLowerCase();
  } catch {
    return null;
  }
}

/** The posting's address up to its path, for a prefix match. */
function urlPrefix(url: string): string | null {
  try {
    const u = new URL(url.trim());
    return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

const likeEscape = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

const SELECT = "id, no, no_part, title, company, job_url, applied_at, status, profile_id, profile:profile_id(full_name)";

type Row = {
  id: string;
  no: number | null;
  no_part: number;
  title: string;
  company: string;
  job_url: string;
  applied_at: string;
  status: string;
  profile_id: string | null;
  profile: { full_name: string } | null;
};

/**
 * Before applying from the extension: has this company — or this very
 * posting — been applied to already? Every application the person can see
 * (their own, and their assigned profiles'), through their own client, so
 * RLS decides what counts. The cooldown is per profile, so those for the
 * profile being checked are marked; the rest are for information.
 *
 * Companies match as the cooldown trigger matches them (normalizeCompany):
 * "Globex", "globex inc" and "Globex, Inc." are one employer.
 */
export async function checkBids(
  db: Db,
  actor: Actor,
  input: { profileId: string | null; company: string; url: string | null },
): Promise<BidCheck> {
  const company = input.company.trim();
  const normalized = company ? normalizeCompany(company) : "";
  const key = input.url ? postingKey(input.url) : null;
  const prefix = input.url ? urlPrefix(input.url) : null;

  // The longest word narrows the query; the exact rule is applied below.
  const word = normalized.split(" ").sort((a, b) => b.length - a.length)[0] ?? "";

  const [byCompany, byUrl, ownJobs, team] = await Promise.all([
    word.length >= 2
      ? db
          .from("application")
          .select(SELECT)
          .ilike("company", `%${likeEscape(word)}%`)
          .order("applied_at", { ascending: false })
          .limit(300)
      : Promise.resolve({ data: [] }),
    prefix
      ? db
          .from("application")
          .select(SELECT)
          .ilike("job_url", `${likeEscape(prefix)}%`)
          .order("applied_at", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: [] }),
    prefix
      ? db
          .from("job")
          .select("id, no, title, url")
          .eq("created_by", actor.id)
          .ilike("url", `${likeEscape(prefix)}%`)
          .limit(10)
      : Promise.resolve({ data: [] }),
    input.profileId
      ? db.from("candidate_profile").select("team_id").eq("id", input.profileId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const rows = new Map<string, Row>();
  for (const row of (byCompany.data ?? []) as unknown as Row[]) {
    if (normalizeCompany(row.company) === normalized) rows.set(row.id, row);
  }
  for (const row of (byUrl.data ?? []) as unknown as Row[]) {
    if (key && postingKey(row.job_url) === key) rows.set(row.id, row);
  }

  const now = Date.now();
  const bids = [...rows.values()]
    .sort((a, b) => b.applied_at.localeCompare(a.applied_at))
    .slice(0, 30)
    .map((row): EarlierBid => {
      const reopens = Date.parse(row.applied_at) + COOLDOWN_DAYS * 86_400_000;
      return {
        id: row.id,
        no: row.no ? applicationNo(row.no, row.no_part) : "",
        title: row.title,
        company: row.company,
        url: row.job_url,
        appliedAt: row.applied_at,
        status: row.status,
        profileId: row.profile_id,
        profileName: row.profile?.full_name ?? null,
        thisProfile: Boolean(input.profileId) && row.profile_id === input.profileId,
        sameUrl: Boolean(key) && postingKey(row.job_url) === key,
        reopensAt: reopens > now ? new Date(reopens).toISOString() : null,
      };
    });

  let blocked: string | null = null;
  const teamId = (team.data as { team_id: string } | null)?.team_id;
  if (teamId && normalized) {
    const { data } = await db
      .from("blocked_company")
      .select("name")
      .eq("team_id", teamId)
      .eq("normalized_name", normalized)
      .maybeSingle();
    blocked = data?.name ?? null;
  }

  const job = ((ownJobs.data ?? []) as Array<{ id: string; no: number; title: string; url: string | null }>).find(
    (j) => j.url && key && postingKey(j.url) === key,
  );
  return { blocked, bids, job: job ? { id: job.id, no: jobNo(job.no), title: job.title } : null };
}
