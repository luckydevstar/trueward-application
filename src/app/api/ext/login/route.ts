import { body, fail, supabaseToken } from "@/lib/ext-http";

/**
 * The extension's sign-in: the same email and password as the app. Behind the
 * device gate like everything else, so it works only from an approved
 * browser.
 */
export async function POST(request: Request) {
  const input = await body<{ email?: string; password?: string }>(request);
  if (!input?.email || !input.password) return fail("Enter your email and password.");
  return supabaseToken("password", { email: input.email.trim(), password: input.password });
}
