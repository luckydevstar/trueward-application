# Trueward Guru

Job application tracking and tailored resume generation, in one app.

Two halves that meet at the resume document:

- **The tracker** — a spreadsheet-style grid of applications with resizable
  columns, inline row editing, a resume attached per row, and a blocklist of
  companies that must never receive an application.
- **The builder** — candidate profiles and the tailored resumes generated from
  them, styled and exported to PDF.

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, Turbopack) |
| UI | Ant Design v6 |
| Database + auth | Supabase (Postgres, RLS, Supabase Auth) |
| File uploads | UploadThing |
| PDF | jsPDF, in the browser |

## Getting started

```bash
cp .env.example .env.local     # fill in Supabase + UploadThing values
npm install
npm run dev
```

Then apply the schema. In the Supabase dashboard, open the SQL editor and run
`supabase/migrations/0001_init.sql` — it creates the tables, the signup trigger,
and every RLS policy.

### The first account

There is no seeded login — nothing is hardcoded, and Supabase Auth holds the
password, so you choose it. The first privileged account is a chicken-and-egg
case: signup through the UI always lands on `bidder` (the `handle_new_user`
trigger's default), and nothing in the app can promote you until an admin
already exists.

```bash
npm run seed:user -- --email you@example.com --role admin
```

That creates the auth user, marks the address confirmed, sets the role, and
prints the password. Omit `--password` and it generates a strong one and shows
it once. It's idempotent — run it again on the same email to reset the password
or change the role, which also makes it the way back in if you're locked out.

Requires `SUPABASE_SERVICE_ROLE_KEY`, and the migration must already be applied.

> **Pick `admin`, not `super_admin`, unless you specifically want an
> account-management-only login.** `app_team_id()` returns null for
> `super_admin`, so every record policy matches zero rows — applications,
> profiles, resumes and the blocklist all come back empty by design.

From then on, the Users page creates the rest of the team.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run seed:user` | Creates/updates an account with a known password and role |
| `npm run test:rls` | Applies the migration to a throwaway Postgres and asserts the policies |
| `npm run render:fixture` | Renders a sample resume to `fixture.pdf` |

`test:rls` needs `postgresql` on PATH (`brew install postgresql@16`).

## PDF export

**This is the part that was hard in the previous project, and the reason this
one is built the way it is.**

`trueward-resume` rendered resumes with headless Chromium
(`@sparticuz/chromium` + `playwright-core`). On a free serverless tier that
means shipping a ~50 MB browser into the function, forcing its binary past the
file tracer with `outputFileTracingIncludes`, and paying a cold boot on every
render. The failure modes were "Could not find Chromium" and timeouts.

Here, PDFs are drawn with jsPDF **in the user's browser**
(`src/lib/pdf/resume-pdf.ts`). Nothing runs on a server, so there is no function
size limit, no cold start, and nothing to time out. Text uses Helvetica — a PDF
base-14 font — so nothing is embedded and the output stays selectable.

The tradeoff is real: layout is manual coordinates, not CSS. No flexbox, no
`page-break-inside`, no widow control. `ensure()` in that file is the entire
pagination strategy. `npm run render:fixture` runs the same code under Node so
you can check a layout change without clicking through the UI.

File **uploads** avoid the serverless path for the same reason — the browser
posts bytes straight to storage, so no request body crosses a function and
Vercel's 4.5 MB body limit never applies.

Uploads go to **UploadThing** with `awaitServerData: false` on the route. That
flag matters: by default the client waits for `onUploadComplete`'s return value,
which means waiting on a server-to-server callback from UploadThing back into
this app — a leg that cannot complete against a dev server on `localhost`, so
the upload control span forever even though the file had already landed. With it
off, the upload resolves as soon as the bytes are stored and the browser reads
the key and URL straight off the result.

## Request latency

A dashboard navigation costs a round trip to the auth server before it can read
anything, because the session has to be validated rather than trusted from a
cookie. `requireActor()` and the server Supabase client are both wrapped in
React's `cache()`, so the layout and the page inside it share one — otherwise
each navigation paid for two `getUser()` calls and two `app_user` reads instead
of one apiece.

`cache()` is per-request, so it never leaks one user's actor into another's
request the way a module-level singleton would.

## Authorization

Records belong to a *team*, identified by an admin's id:

- an admin's team is their own id
- a bidder's team is the admin who created them
- a super admin has no team — they manage accounts, not records

Visibility is narrower than ownership: an admin sees their whole team, a bidder
sees only rows they recorded themselves.

All of this is enforced by RLS in Postgres, via two `SECURITY DEFINER` helpers,
`app_role()` and `app_team_id()`. Application code does not filter by team — if
it did, that filter would be a second source of truth able to drift from the
policy. `src/lib/scope.ts` mirrors the rules only so the UI can hide controls
that would fail.

`npm run test:rls` covers team isolation, bidder scoping, cross-team insert
rejection, forged `created_by` rejection, and self-promotion.

### Profile assignment

Candidate profiles are **opt-in** for bidders. Without a `profile_assignment`
row a bidder sees no profile at all, so a new candidate stays private to the
admins until deliberately routed. Admins assign from the Profiles page.

Editing a candidate's identity is an admin action — a bidder writes resume
content, not someone's date of birth.

### Social Security numbers

Stored encrypted with `pgp_sym_encrypt`. The key is `APP_ENCRYPTION_KEY`, held
only in the server environment and never in the database, so a dump of
`candidate_profile` yields ciphertext alone.

Reading it takes three things at once: an admin role, an RLS-visible row, and
the key. The reveal runs in a server action
(`src/app/dashboard/profiles/ssn-actions.ts`) and appends to `ssn_access_log`,
which has no update or delete policy — the trail cannot be edited from the app.
The plaintext never ships with the page; the field starts blank even when a
number is on file.

`reveal_ssn` and `store_ssn` are revoked from `public`, so PostgREST will not
expose them to a browser session. They are reachable only via the service-role
client, after the action's own checks.

> Storing SSNs carries real obligations — retention limits, breach
> notification, and access review among them. The controls here are the
> technical half; the policy half is yours. If you don't need the full number,
> `maskSsn` in `src/lib/profile.ts` and a last-four column would remove the risk
> entirely.

## The resume document

`src/lib/document/schema.ts` splits a resume along the line that matters:

```
profile — who you are and where you worked. Set once. Never regenerated.
content — how you're positioned for one job. Regenerated per job description.
```

A model that only authors `content` is not *instructed* to leave your name,
employers, and dates alone — it cannot reach them. Employment facts are
referenced by `employmentId`, and an id that doesn't resolve is a hard
validation failure rather than an invented employer.

The two halves live in separate tables and are joined only at render time, so
regenerating positioning for a new job rewrites one row and cannot touch the
other.

The builder at `/dashboard/profiles/[id]` takes tailored content as JSON — paste
a model's output and it validates against the same schema the write path uses.
Download stays disabled until it parses.

## Deploying

Vercel, free tier, no special configuration — which is the whole point. There is
no browser binary to trace, no `serverExternalPackages`, and no `maxDuration` to
raise.

Set the environment variables from `.env.example` in the project settings.
`SUPABASE_SERVICE_ROLE_KEY`, `UPLOADTHING_TOKEN` and `APP_ENCRYPTION_KEY` must
not carry the `NEXT_PUBLIC_` prefix — that prefix is what inlines a value into
the browser bundle.
