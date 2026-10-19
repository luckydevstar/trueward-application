# Working in this repo

@AGENTS.md

## Antd v6 + React Server Components

**Any file that renders an antd compound subcomponent — `Typography.Title`,
`Typography.Paragraph`, `Input.TextArea`, `Space.Compact`, `List.Item.Meta`,
`Form.Item` — must be a `"use client"` file.**

In a Server Component these resolve to `undefined`. antd's modules are client
modules, so a server import gets a client-reference proxy, and a proxy carries
no static properties. Plain components (`<Card>`, `<Alert>`, `<Empty>`) work
either way, which is what makes this easy to trip over: a page renders fine
until someone adds a `Typography.Title` to it.

It does not fail at typecheck. It fails at render with:

```
Element type is invalid: expected a string ... but got: undefined
```

with no component name and no useful frame. The build reports it only for
prerendered routes, so a dynamic dashboard page can carry the bug to production.

The convention here: **server pages fetch data, client components render antd.**
See `src/app/dashboard/page.tsx` handing off to
`src/components/overview-cards.tsx`, and `src/app/login/page.tsx` handing off to
`src/app/login/login-card.tsx`.

## Authorization lives in Postgres

RLS is the boundary, not the query layer. The policies in `supabase/schema/`
(four parts, applied in order) decide what a query returns.

`src/lib/roles.ts` and `src/lib/scope.ts` mirror those rules so the UI can hide
controls that would fail. They are not enforcement. If they disagree with the
database, the database wins and the user sees a rejected write.

**Reads use `in_team(team_id)`; writes use `in_own_team(team_id)`. Never
`team_id = app_team_id()` by hand.** The super admin reviews every team and
changes none, and the two helpers are how that is said once:

- `in_team()` lets a super admin past the team check, so they can read every
  team. The bare comparison would exclude them — their `app_team_id()` is
  null, and `null = anything` is *unknown* rather than false, so they would
  match nothing with no error. That is how super admins once saw no records.
- `in_own_team()` is membership only. A written row belongs to one team and a
  super admin has none, so a `WITH CHECK` using `in_team()` would let them
  stamp rows into any team. Pair it with the role that may write —
  `is_subadmin()` for anything a team manages.

The super admin's writes are deliberate exceptions: updating and deleting any
team's profiles and attachments (their policies say `is_super_admin() or …`),
resumes and applications for a profile they assigned to themselves
(`works_in_team(team_id, profile_id)` — the row joins the *profile's* team),
and the two moves, `assign_profile_to_team()` and `transfer_team()`,
`SECURITY DEFINER` functions with their own guard. A profile's `team_id`
changes only inside those two — `guard_profile_team()` refuses a plain update
— because a profile moved without its applications leaves the cooldown blind.
SSNs stay with the team's subadmin (`canHandleSsn()`).

**A `BEFORE` trigger runs before RLS.** `enforce_application_cooldown()` is
`SECURITY DEFINER` and its refusal names the company, date and applicant, so
it steps aside for a caller who could not write the row anyway — otherwise its
error message would read another team's history out to them. A new trigger that
raises with data in the message needs the same guard.

**The one place query-layer scoping is deliberate:** `src/lib/profile-scope.ts`
narrows the profile lists a page sends to the browser, mirroring
`can_use_profile()`. This is defence in depth for a *payload* — a page that
ships every candidate on the team and lets the dropdown sort it out is one
stale policy away from a leak.

It is a single module for a reason. This rule was previously written out
inline on two pages; one of them handled `resume_builder` and forgot `bidder`,
so a bidder's resume builder listed the whole team's candidates. If you need
this rule somewhere new, call it — do not write a third copy.

Run `npm run test:rls` after touching any policy. It applies `supabase/schema/`
to a throwaway Postgres *twice* (so a non-idempotent statement fails loudly)
and asserts team isolation, the super admin's read-only reach, bidder scoping
to assigned profiles, archive behaviour, team transfer, function grants, and
the `WITH CHECK` clauses that stop cross-team inserts.

**`app_user` has no update policy, on purpose.** Every account change goes
through `src/app/dashboard/users/actions.ts` with the service role. A
self-update policy once let any account rewrite its own `created_by_id` — which
is a bidder's team. Do not add one back.

## Never widen the SSN path

`ssn_encrypted` is selected in exactly two places, and only ever compared
against null to answer "is one on file?". The plaintext has one way in
(`setSsn`) and one way out (`revealSsn`), both in
`src/app/dashboard/profiles/ssn-actions.ts`, both gated on the subadmin role
and their own team, and the reveal appends to an audit table with no update or
delete policy.

Do not add an `ssn` field to an ordinary profile update, do not return the
plaintext from a page loader, and do not grant `reveal_ssn`/`store_ssn` back to
`anon` or `authenticated` — PostgREST would then expose them to any browser
session, skipping every check in the actions. Revoking from `public` is not
enough on Supabase: its default privileges grant each API role by name, which
is why 02_functions.sql revokes them by name and the test stub reproduces those
defaults.

## PDFs are generated client-side, on purpose

`src/lib/pdf/resume-pdf.ts` draws with jsPDF at explicit coordinates. It is
deliberately not HTML/CSS: rendering CSS to PDF needs a headless browser, which
on a free serverless tier means a ~50 MB Chromium in the function, file-tracing
its binary, and a cold boot per render. That is what made PDF export unreliable
in the previous project.

The cost is manual layout — no flexbox, no page-break control. `ensure()` is the
whole pagination strategy. Check changes with `npm run render:fixture`, which
runs the same renderer under Node and writes a file you can open.

**Fonts are embedded, and must stay extractable.** Helvetica and Times are
base-14; the other families in `src/lib/pdf/fonts.ts` are static Latin TTFs in
`public/fonts/`, fetched when chosen and registered per document by
`newResumePdf()` before `renderResumePdf()` runs (a font that fails to load
falls back to Helvetica). jsPDF embeds them as CID TrueType with a ToUnicode
map — `pdffonts` shows `uni yes` — which is what lets applicant-tracking
systems read the text. Check a new font with `npm run render:fixture -- <dir>
--fonts` and `pdftotext` before offering it; never add a variable font (jsPDF
can't use one) or one without a Unicode cmap.

**There is exactly one renderer.** The builder's preview is the real PDF in an
iframe, not an HTML approximation — `renderResumePdfUrl` and
`downloadResumePdf` both call `renderResumePdf`. Do not add an HTML preview
back. The previous one drifted immediately: template, header position and
accent were wired to the PDF and silently did nothing on screen, so what you
styled was not what you downloaded.

**One exception, and it is still the same renderer:** the extension's
Download & track runs `renderResumePdf` in the function
(`src/lib/pdf/server.ts`), with fonts read from `public/fonts/` on disk. The
fonts reach the function only through `outputFileTracingIncludes` in
`next.config.ts`, keyed by route. A new route that renders a PDF must be added
there, or it renders with Helvetica in production while working locally.

## Generation goes through one function

`generateContent()` in `src/lib/ai/generate.ts` is the only caller of
OpenRouter, used by the builder (in the background, through
`src/lib/ai/jobs.ts`) and the model lab's route. Every path authorizes through
the caller's client first — the builder's `startResumeJob` inserts its
`resume_job` row under the caller's policies — and writes the log with the
service role (the log is not the caller's to write).

**Background generation** runs in `after()` from the builder's server action,
so it is bounded by the builder page's `maxDuration` (300s). The per-call
timeout in `jobs.ts` (two calls at most) must stay inside it, and
`JOB_STALE_MS` must stay above it — a row still `running` after that is shown
as timed out and stops counting toward the 6-at-once limit. **Batches** (the job sheet, the extension) insert their `resume_job` rows
as `queued` beyond the free slots; the queue runner
(`/api/cron/resume-jobs`, called by pg_cron through `resume_queue_tick()`)
claims them with `resume_queue_claim()`. The claim is the authorization — it
checks the database-held secret — so the route needs neither the gate nor a
session. The six-minute stale cut-off counts from `started_at`, not
`created_at`: a job can wait an hour in the queue and still get its full run.

**The extension's routes (`/api/ext/*`) are signed in by bearer token,** not
cookie. Build their client with `requestClient()`/`requestActor()` from
`src/lib/supabase/request.ts`, never `createClient()` — the cookie client
would see no session and every query would come back empty rather than
refused. Shared logic between a server action and an extension route lives in
`src/lib/jobs/` and takes the client as an argument, so both paths run under
the caller's own RLS.

The input is the
person's: their base prompt and additional prompt, plus the profile's
employments and education — never contact details. `buildMessages()` appends
only the response contract. Keep it that way: no client-side model calls, and
the model only ever writes `content`, which is what keeps the split below
meaningful.

## The profile / content split

`src/lib/document/schema.ts` splits a resume in two:

- **profile** — name, contact, employers, dates. Set once, never regenerated.
- **content** — positioning for one job. The only half a model authors.

They are stored in separate tables (`candidate_profile.profile`,
`resume_document.content`) and joined only at render time by
`renderedExperiences()`. Content references employers by `employmentId`; an id
that doesn't resolve is a validation failure rather than an invented employer.

Don't collapse these into one object for convenience. The separation is the
guarantee.
