import "server-only";

import { NextResponse } from "next/server";

/** One error shape for the extension's API: `{ error }`, with a status. */
export const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

export const UNAUTHORIZED = () => fail("Sign in to Trueward first.", 401);

/** A JSON body, or null when it isn't one. */
export async function body<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

type Tokens = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  expires_at?: number;
  user?: { id: string; email?: string };
  error_description?: string;
  msg?: string;
};

/** Signs the extension in with a Trueward account, or renews its session. */
export async function supabaseToken(grant: "password" | "refresh_token", payload: Record<string, string>) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=${grant}`, {
    method: "POST",
    headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const tokens = (await response.json().catch(() => ({}))) as Tokens;
  if (!response.ok || !tokens.access_token) {
    return fail(tokens.error_description ?? tokens.msg ?? "Couldn't sign in.", 401);
  }
  return NextResponse.json({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: tokens.expires_at ?? Math.floor(Date.now() / 1000) + (tokens.expires_in ?? 3600),
    email: tokens.user?.email ?? null,
  });
}
