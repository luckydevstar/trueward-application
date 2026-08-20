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
the four files in `supabase/schema/`, in order:

| | |
| --- | --- |
| `01_tables.sql` | Tables, enums and indexes |
| `02_functions.sql` | Identity, scope, bookkeeping and SSN |
| `03_rules.sql` | Duplicate applications, billing and the cooldown view |
| `04_policies.sql` | Row level security |

They are one schema split across four pastes, not a migration series — the SQL
editor will not take 37 KB at once. Order matters in one direction only:
policies name functions and functions name tables, so a part run too early fails
with "relation does not exist" rather than doing something subtly wrong.

Run them again, all four, whenever any of them changes. They *converge* an
existing database rather than rebuilding one: tables and columns are added if
missing, functions and policies are replaced, and nothing holding rows is
dropped. Applying the whole set twice in a row is part of the test suite.

They replaced a numbered migration series, for a reason worth keeping in mind:
applying an older migration after a newer one silently reverted policies the
newer one had tightened, because both created a policy of the same name and the
last one won. These four never overlap, so re-running them in order cannot
produce that.

If something is refused with "new row violates row-level security policy", run
`supabase/diagnose.sql` — it reads only, and prints which parts of the schema are
live, the policy that refused, and the team each account resolves to.

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

Requires `SUPABASE_SERVICE_ROLE_KEY`, and the schema must already be applied.

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
| `npm run test:rls` | Applies `supabase/schema/` twice to a throwaway Postgres and asserts the policies |
| `npm run render:fixture` | Renders the sample resume once per template into `fixtures/` |

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
`page-break-inside`, no widow control. Text flows through `Flow` cursors — a
column with its own vertical position *and page* — which is the entire
pagination strategy, and what makes the two-column sidebar template possible at
all: the columns fill independently, so the sidebar can run onto page two while
the main column is still on page one.

`npm run render:fixture` runs the same code under Node and writes one PDF per
template, so a layout change can be checked without clicking through the UI.

### Templates

`src/lib/pdf/templates.ts` holds the specs. Each varies the header treatment
(plain / filled banner / coloured sidebar), the section-heading style (hairline
rule / accent bar / filled chip), margins and spacing:

| | |
| --- | --- |
| Classic | Plain header, hairline rules |
| Modern | Accent name, heavier section bars |
| Compact | Tighter margins, for a long history |
| Banner | Full-width colour block behind the name |
| Sidebar | Coloured column carrying contact, skills, education |
| Wave | Gradient wash over the top third, curving into the page |

**Wave is worth a note.** The panel is a *backdrop*, not a container: the
header, summary, skills and first experiences all flow across it, and the curve
passes behind them. That is why it is a pale wash rather than a saturated
block — content sitting on it is ordinary ink text, and a strong fill would
force that text to be reversed, so any paragraph straddling the curve would
change colour mid-sentence.

The top tint is set to `0.65`, as saturated as it can go while staying
comfortably readable. Measured contrast of ink against it: slate 6.9, rose 8.0,
plum 8.1, rust 8.2, blue 8.3, emerald 8.7 — WCAG AA wants 4.5 for body text and
AAA wants 7, so every accent clears AA with room and all but slate clear AAA.

PDF has real gradients — axial shading dictionaries — but jsPDF's public API
exposes no way to build one, so it is approximated with a stack of thin bands,
one per point of height, each overlapping the next by half a point so no
hairline seam shows between them. The curved edge is a single symmetric bezier
used as a *clip path*, not a white mask: a mask would only be invisible against
a white page and would surface as a pale slab the moment anything sat behind
it. It costs ~300 fill operations, which is why that file is roughly 4 KB
larger than the others, and it paints on page one only.

Which templates and accents an account may use is set per account, on the Users
page. Empty means "the default for their role", and `resume_builder` defaults to
everything except the Banner template and the rust accent — the two loudest
choices, and poor defaults for work that goes out under someone else's name
without review. An admin can widen or narrow any individual account, and the
per-account setting wins outright.

This is enforced in the UI, not the database: it is a style guideline, and
treating a cosmetic field as a boundary would mean validating it on every write.
A stale choice — a saved resume or a remembered preference naming a template the
account no longer has — snaps to the first permitted one rather than rendering
something the picker cannot represent.

Text drawn on a filled panel picks its own colour: `prefersLightText` computes
WCAG relative luminance, so a pale accent gets dark text rather than
white-on-yellow. That is also why the sidebar's headings use the panel's text
colour rather than the accent — the accent *is* the fill there.

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

**Measure in production before chasing this.** `next dev` compiles each route
the first time you visit it, and disables `<Link>` prefetching. Measured here:

| | |
| --- | --- |
| Dev, first visit to a route | 2.66 s |
| Dev, once compiled | ~40 ms |
| `next build && next start` | ~0.3 ms |

Clicking through a dashboard in dev pays that first-visit cost once per route,
which is most of what "slow transitions" usually is.

Beyond that, three things keep navigation cheap:

- **`getClaims()`, not `getUser()`.** Both verify the token rather than trusting
  the cookie, so it isn't a security trade — but with asymmetric signing keys
  `getClaims` checks the signature locally against a cached JWKS instead of
  calling the auth server. That call was on the critical path of every
  navigation, in both the proxy and `requireActor()`. On a project still using
  a legacy symmetric (HS256) secret it falls back to a round trip; enabling
  asymmetric signing keys in the Supabase dashboard is what unlocks the gain.
- **`cache()` on `requireActor()` and the server client**, so the layout and the
  page inside it share one call rather than repeating it. It's per-request, so
  it never leaks one user's actor into another's request the way a module-level
  singleton would.
- **`dashboard/loading.tsx`**, so a click paints immediately. Without it the App
  Router holds the old page on screen until the new one's data returns, which
  reads as a dead click and then a jump.

These pages stay server-rendered rather than moving to client-side fetching.
The data they need is behind RLS either way, so CSR would trade one server round
trip for a client one and give up the server-side gate — `loading.tsx` gets the
same perceived speed without that.

## Authorization

Records belong to a *team*, identified by an admin's id:

- an admin's team is their own id
- a bidder's and a resume builder's team is the admin who created them
- a super admin has no team — they manage accounts, not records

Within a team, reach narrows by role:

| Role | Sees | Pages |
| --- | --- | --- |
| `admin` | everything on the team | all |
| `bidder` | applications they recorded, profiles assigned to them | Applications, Profiles, Resume builder, Blocklist |
| `resume_builder` | only the profiles they created | Profiles, Resume builder |
| `super_admin` | no records at all | Users |

> **Adding a role means auditing the policies, not just the enum.** Almost every
> privileged check used to read `app_role() <> 'bidder'`, which was the same
> thing as "is an admin" only while bidder was the *only* unprivileged role. A
> second one made them different: `resume_builder` would have inherited admin
> rights over applications, the blocklist, profile assignment and billing by
> default. Anything meaning "is an admin" now says so, via `is_admin()`.
>
> `app_team_id()` was the other trap — it listed the roles it knew and returned
> null for the rest, and `team_id = app_team_id()` with a null is not false but
> *unknown*, so it never matches. A new role could read nothing and write
> nothing, with no error saying why. The policy tests caught it.

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

Experiences run most-recent-first, but the check only compares roles whose
periods **don't overlap**. Two jobs held at the same time — a permanent role and
a concurrent contract — have no canonical order, and which reads better depends
on the posting, so either arrangement is accepted. A genuinely reversed list is
still caught.

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
