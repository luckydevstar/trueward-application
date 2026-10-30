import "server-only";

import { createServerClient } from "@supabase/ssr";

import type { CurrentActor } from "@/lib/actor";
import { createClient } from "@/lib/supabase/server";

import type { Database } from "./types";

export type Db = Awaited<ReturnType<typeof createClient>>;

/**
 * Supabase as whoever sent this request — for the routes the Chrome extension
 * calls as well as the app's own pages.
 *
 * The extension signs in with the person's own Trueward account and sends
 * that session's access token as a bearer token: a browser extension's
 * requests can't be relied on to carry the site's cookies. A request without
 * one falls back to the cookie session, so the same routes serve the app.
 * Either way it is the user's own JWT, so RLS decides everything — no route
 * here holds a key that bypasses it.
 */
export async function requestClient(request: Request): Promise<{ db: Db; token: string | null }> {
  const header = request.headers.get("authorization");
  const token = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null;
  if (!token) return { db: await createClient(), token: null };
  return { db: tokenClient(token), token };
}

/** Supabase as the holder of this access token — RLS reads it like a cookie session. */
export function tokenClient(token: string): Db {
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: { getAll: () => [], setAll: () => {} },
      global: { headers: { Authorization: `Bearer ${token}` } },
    },
  );
}

/** The signed-in person behind a request, or null — never a redirect, for API routes. */
export async function requestActor(request: Request): Promise<{ db: Db; actor: CurrentActor } | null> {
  const { db, token } = await requestClient(request);
  const { data: auth } = await db.auth.getClaims(token ?? undefined);
  const userId = auth?.claims?.sub;
  if (!userId) return null;

  const { data } = await db
    .from("app_user")
    .select("*") // `*`: see requireActor() on finance_access
    .eq("id", userId)
    .maybeSingle();
  if (!data) return null;

  return {
    db,
    actor: {
      id: data.id,
      email: data.email,
      name: data.name,
      role: data.role,
      createdById: data.created_by_id,
      allowedTemplates: data.allowed_templates,
      allowedAccents: data.allowed_accents,
      financeAccess: data.role === "super_admin" || data.finance_access === true,
    },
  };
}
