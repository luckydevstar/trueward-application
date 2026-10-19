import { body, fail, supabaseToken } from "@/lib/ext-http";

/** Renews the extension's session before its access token runs out. */
export async function POST(request: Request) {
  const input = await body<{ refreshToken?: string }>(request);
  if (!input?.refreshToken) return fail("Sign in again.", 401);
  return supabaseToken("refresh_token", { refresh_token: input.refreshToken });
}
