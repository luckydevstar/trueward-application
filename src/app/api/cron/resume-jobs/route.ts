import { NextResponse } from "next/server";

import { runResumeJob } from "@/lib/ai/jobs";
import { anonRpc } from "@/lib/anon-rpc";

/** Long enough for a round of generations: two model calls at most, 260s. */
export const maxDuration = 300;

/**
 * The queue runner. pg_cron calls this each minute while jobs are waiting
 * (resume_queue_tick in schema part 2), with the database's secret as a
 * bearer token; this hands it straight back to resume_queue_claim(), which
 * checks it and moves the next jobs to running. They run here, together.
 *
 * Outside the device gate and sign-in (proxy.ts): no browser is behind it,
 * and a wrong secret claims nothing.
 */
export async function POST(request: Request) {
  const secret = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (secret.length < 32) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let ids: string[];
  try {
    ids = (await anonRpc<string[] | null>("resume_queue_claim", { p_secret: secret })) ?? [];
  } catch (error) {
    // Anyone can call this route, so the database's words stay in the log.
    console.error("resume_queue_claim failed", error);
    return NextResponse.json({ error: "Claim failed" }, { status: 502 });
  }

  await Promise.allSettled(ids.map((id) => runResumeJob(id)));
  return NextResponse.json({ ran: ids.length });
}
