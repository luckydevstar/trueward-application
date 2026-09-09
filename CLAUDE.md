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
and asserts team isolation, bidder scoping, archive behaviour, and the
`WITH CHECK` clauses that stop cross-team inserts.

## Never widen the SSN path

`ssn_encrypted` is selected in exactly two places, and only ever compared
against null to answer "is one on file?". The plaintext has one way in
(`setSsn`) and one way out (`revealSsn`), both in
`src/app/dashboard/profiles/ssn-actions.ts`, both admin-gated, and the reveal
appends to an audit table with no update or delete policy.

Do not add an `ssn` field to an ordinary profile update, do not return the
plaintext from a page loader, and do not grant `reveal_ssn`/`store_ssn` back to
`authenticated` — PostgREST would then expose them to any browser session,
skipping every check in the actions.

## PDFs are generated client-side, on purpose

`src/lib/pdf/resume-pdf.ts` draws with jsPDF at explicit coordinates. It is
deliberately not HTML/CSS: rendering CSS to PDF needs a headless browser, which
on a free serverless tier means a ~50 MB Chromium in the function, file-tracing
its binary, and a cold boot per render. That is what made PDF export unreliable
in the previous project.

The cost is manual layout — no flexbox, no page-break control. `ensure()` is the
whole pagination strategy. Check changes with `npm run render:fixture`, which
runs the same renderer under Node and writes a file you can open.

**There is exactly one renderer.** The builder's preview is the real PDF in an
iframe, not an HTML approximation — `renderResumePdfUrl` and
`downloadResumePdf` both call `renderResumePdf`. Do not add an HTML preview
back. The previous one drifted immediately: template, header position and
accent were wired to the PDF and silently did nothing on screen, so what you
styled was not what you downloaded.

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
