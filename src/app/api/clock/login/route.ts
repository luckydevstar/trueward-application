import { adminTokens } from "@/lib/clock";
import { body, fail } from "@/lib/ext-http";

/**
 * The desktop clock's sign-in: an admin's email and password. Outside the
 * device gate, so it needs no approved device — see src/lib/clock.ts.
 */
export async function POST(request: Request) {
  const input = await body<{ email?: string; password?: string }>(request);
  if (!input?.email || !input.password) return fail("Enter your email and password.");
  return adminTokens("password", { email: input.email.trim(), password: input.password });
}
