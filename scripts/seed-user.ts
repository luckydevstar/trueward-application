/**
 * Creates or updates an account with a known password, and sets its role.
 *
 *   npm run seed:user -- --email you@example.com --role admin
 *   npm run seed:user -- --email you@example.com --password 'hunter2hunter2'
 *
 * This is the only way to mint the *first* privileged account: signup through
 * the UI always lands on `bidder` (the handle_new_user trigger's default), and
 * nothing in the app can promote you until an admin already exists. After the
 * first admin, use the Users page.
 *
 * Idempotent — running it again on the same email resets the password and role
 * rather than failing, so it doubles as a "I locked myself out" recovery.
 */
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { USER_ROLES, type UserRole } from "../src/lib/roles";

// Next loads .env.local automatically; a standalone tsx process does not.
for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) {
    process.loadEnvFile(file);
    break;
  }
}

// --------------------------------------------------------------------- args

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  const inline = process.argv.find((a) => a.startsWith(`--${name}=`));
  return inline?.slice(name.length + 3);
}

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

const email = arg("email");
const name = arg("name") ?? email?.split("@")[0] ?? "Admin";
const role = (arg("role") ?? "admin") as UserRole;

if (!email) {
  fail(
    "Missing --email.\n\n" +
      "  npm run seed:user -- --email you@example.com --role admin\n\n" +
      "Options:\n" +
      "  --email     required\n" +
      "  --password  optional; a strong one is generated and printed if omitted\n" +
      "  --name      optional; defaults to the local part of the email\n" +
      `  --role      optional; one of ${USER_ROLES.join(", ")} (default: admin)`,
  );
}

if (!USER_ROLES.includes(role)) {
  fail(`--role must be one of: ${USER_ROLES.join(", ")}`);
}

// base64url so the password is safe to paste into a shell without quoting.
const generated = !arg("password");
const password = arg("password") ?? randomBytes(18).toString("base64url");

if (password.length < 8) fail("--password must be at least 8 characters.");

// ------------------------------------------------------------------- client

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  fail(
    "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.\n" +
      "  cp .env.example .env.local, then fill them in from\n" +
      "  Supabase → Project Settings → API.",
  );
}

// Service role: this bypasses RLS, which is the point — there is no signed-in
// admin yet to authorize against.
const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// --------------------------------------------------------------------- work

/**
 * listUsers is paginated and has no email filter, so this walks pages rather
 * than assuming the account is on the first one.
 */
async function findByEmail(target: string) {
  const wanted = target.toLowerCase();
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) fail(error.message);
    const hit = data.users.find((u) => u.email?.toLowerCase() === wanted);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function main() {
  const existing = await findByEmail(email!);

  let userId: string;

  if (existing) {
    const { error } = await supabase.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      user_metadata: { name },
    });
    if (error) fail(`Could not update the account: ${error.message}`);
    userId = existing.id;
    console.log(`↻ updated existing account ${email}`);
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      // Skips the confirmation email — you are provisioning this yourself, and
      // an unconfirmed account can't sign in.
      email_confirm: true,
      user_metadata: { name },
    });
    if (error || !data.user) {
      fail(`Could not create the account: ${error?.message ?? "unknown error"}`);
    }
    userId = data.user.id;
    console.log(`+ created account ${email}`);
  }

  // The handle_new_user trigger inserted app_user with role 'bidder'. If the
  // trigger is missing — migration not applied — there is nothing to update,
  // and that must be a loud failure rather than a silent no-op.
  const { data: updated, error: roleError } = await supabase
    .from("app_user")
    .update({ role, name })
    .eq("id", userId)
    .select("id, role");

  if (roleError) fail(`Could not set the role: ${roleError.message}`);

  if (!updated?.length) {
    fail(
      "The auth account exists but has no app_user row.\n" +
        "  Apply supabase/migrations/0001_init.sql first — it creates the\n" +
        "  handle_new_user trigger that mirrors signups into app_user.",
    );
  }

  console.log(`✓ role set to ${role}`);
  console.log("");
  console.log("  Sign in at /login with:");
  console.log(`    email     ${email}`);
  console.log(`    password  ${password}`);
  if (generated) {
    console.log("");
    console.log("  ⚠ Generated password — copy it now, it is not stored anywhere.");
  }
  if (role === "super_admin") {
    console.log("");
    console.log(
      "  Note: super_admin owns no records — app_team_id() is null for that\n" +
        "  role, so applications, profiles, resumes and the blocklist will all\n" +
        "  be empty. Use --role admin if you want to actually use the tracker.",
    );
  }
  console.log("");
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
