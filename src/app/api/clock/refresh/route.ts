import { adminTokens } from "@/lib/clock";
import { body, fail } from "@/lib/ext-http";

/** Renews the clock's session — still an admin's, or it ends here. */
export async function POST(request: Request) {
  const input = await body<{ refreshToken?: string }>(request);
  if (!input?.refreshToken) return fail("Sign in again.", 401);
  return adminTokens("refresh_token", { refresh_token: input.refreshToken });
}
