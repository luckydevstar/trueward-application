import { Alert } from "antd";

import { UsageDashboard, type UsageGroup } from "@/components/usage-dashboard";
import { requireActor } from "@/lib/actor";
import { fetchAll } from "@/lib/fetch-all";
import { isAdminRole } from "@/lib/roles";
import { seesAllTeams } from "@/lib/scope";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Usage" };

/**
 * What resume generation has cost, and who spent it.
 *
 * Built on the generation log, which records for every call who made it, for
 * which profile and team, and what OpenRouter charged. RLS decides the scope,
 * so this page does no team filtering of its own: a subadmin's select returns
 * their team's rows — themselves and their bidders — and the super admin's
 * returns every team's. A bidder has no page here.
 *
 * Aggregated on the server, so the browser receives a few dozen totals rather
 * than every row of the log.
 */

const PERIODS = { "7d": 7, "30d": 30, "90d": 90 } as const;
type Period = keyof typeof PERIODS | "month";
type Source = "builder" | "lab" | "all";

/** Start of the period, and the days in it. Out of the component: it reads the clock. */
function periodWindow(period: Period): { since: Date; days: string[] } {
  const now = new Date();
  const since =
    period === "month"
      ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (PERIODS[period] - 1)));
  const days: string[] = [];
  for (let d = new Date(since); d <= now; d = new Date(d.getTime() + 86_400_000)) {
    days.push(d.toISOString().slice(0, 10));
  }
  return { since, days };
}

async function openRouterCredit(): Promise<number | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  try {
    const response = await fetch("https://openrouter.ai/api/v1/credits", {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return null;
    const { data } = (await response.json()) as { data?: { total_credits?: number; total_usage?: number } };
    return typeof data?.total_credits === "number" ? data.total_credits - (data.total_usage ?? 0) : null;
  } catch {
    return null;
  }
}

type LogRow = {
  created_by: string | null;
  team_id: string;
  profile_id: string | null;
  cost_usd: number | null;
  ok: boolean;
  created_at: string;
};

function group(rows: LogRow[], key: (r: LogRow) => string, label: (id: string) => string): UsageGroup[] {
  const totals = new Map<string, UsageGroup>();
  for (const row of rows) {
    const id = key(row);
    const g = totals.get(id) ?? { id, label: label(id), runs: 0, valid: 0, spend: 0, last: row.created_at };
    g.runs += 1;
    g.valid += row.ok ? 1 : 0;
    g.spend += Number(row.cost_usd ?? 0);
    if (row.created_at > g.last) g.last = row.created_at;
    totals.set(id, g);
  }
  return [...totals.values()].sort((a, b) => b.spend - a.spend || b.runs - a.runs);
}

export default async function UsagePage({ searchParams }: PageProps<"/dashboard/usage">) {
  const actor = await requireActor();
  if (!isAdminRole(actor.role)) {
    return (
      <Alert type="warning" showIcon title="Not available" description="Usage is for subadmins and the super admin." />
    );
  }

  const params = await searchParams;
  const period: Period =
    params.period === "7d" || params.period === "90d" || params.period === "month" ? params.period : "30d";
  const everyTeam = seesAllTeams(actor);
  // Lab runs are the super admin's model tests; a subadmin's view is real
  // resumes only.
  const source: Source =
    everyTeam && (params.source === "lab" || params.source === "all") ? params.source : "builder";

  const { since, days } = periodWindow(period);
  const supabase = await createClient();

  const [log, users, profiles, credit] = await Promise.all([
    fetchAll<LogRow>((from, to) => {
      const query = supabase
        .from("resume_generation")
        .select("created_by, team_id, profile_id, cost_usd, ok, created_at")
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);
      // "Real usage" is resumes generated in the builder plus the follow-up
      // questions asked about them; "lab" is the super admin's model tests.
      return source === "all"
        ? query
        : source === "lab"
          ? query.eq("source", "lab")
          : query.in("source", ["builder", "followup"]);
    }),
    supabase.from("app_user").select("id, name, email, role"),
    supabase.from("candidate_profile").select("id, full_name"),
    everyTeam ? openRouterCredit() : Promise.resolve(null),
  ]);

  const people = new Map((users.data ?? []).map((u) => [u.id, u]));
  const profileName = new Map((profiles.data ?? []).map((p) => [p.id, p.full_name]));
  const personLabel = (id: string) => {
    const u = people.get(id);
    if (!u) return "Removed account";
    return `${u.name ?? u.email}${u.id === actor.id ? " (you)" : ""}`;
  };
  const rows = log.rows;

  const byDay = new Map(days.map((d) => [d, { day: d, spend: 0, runs: 0 }]));
  for (const row of rows) {
    const d = byDay.get(row.created_at.slice(0, 10));
    if (d) {
      d.spend += Number(row.cost_usd ?? 0);
      d.runs += 1;
    }
  }

  return (
    <UsageDashboard
      everyTeam={everyTeam}
      period={period}
      source={source}
      credit={credit}
      totals={{
        spend: rows.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0),
        runs: rows.length,
        valid: rows.filter((r) => r.ok).length,
        people: new Set(rows.map((r) => r.created_by)).size,
      }}
      daily={[...byDay.values()]}
      bySubadmin={
        everyTeam
          ? group(rows, (r) => r.team_id, (id) => {
              const u = people.get(id);
              if (!u) return "Removed subadmin";
              // Profiles not yet handed to a subadmin sit in the super admin's
              // own pool, which is a team id but not a subadmin.
              return u.role === "super_admin" ? "Unassigned pool (super admin)" : (u.name ?? u.email);
            })
          : []
      }
      byPerson={group(rows, (r) => r.created_by ?? "removed", (id) => (id === "removed" ? "Removed account" : personLabel(id)))}
      byProfile={group(rows, (r) => r.profile_id ?? "deleted", (id) =>
        id === "deleted" ? "Deleted profile" : (profileName.get(id) ?? "Profile no longer visible"),
      )}
      truncated={log.error !== null}
    />
  );
}
