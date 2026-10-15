-- ===========================================================================
-- Trueward Guru — schema part 1 of 4: Tables, enums and indexes
--
-- Run parts 1 → 2 → 3 → 4, in order, in the Supabase SQL editor. Split only
-- because the editor will not take the whole thing in one paste; together they
-- are one schema, not a migration series.
--
-- Order matters in one direction only: policies name functions, and functions
-- name tables, so a part run too early fails loudly with "function does not
-- exist" rather than doing something subtly wrong. Re-running any part, or all
-- of them, is always safe.
-- ===========================================================================

-- ===========================================================================
-- Trueward Guru — complete schema
--
-- The whole database in one file. Run it in the Supabase SQL editor; run it
-- again whenever this file changes. It converges an existing database to this
-- state rather than rebuilding one, so it is safe on a database with data in
-- it: tables and columns are added if missing, functions and policies are
-- replaced, and nothing that holds rows is dropped.
--
-- Ordering matters, and is the reason this exists. Applied as separate
-- migrations, running an older file after a newer one silently reverted
-- policies the newer one had tightened — the same policy name recreated with
-- looser wording. One file cannot be applied out of order.
--
-- ---------------------------------------------------------------------------
-- Authorization is entirely RLS
--
-- No query in the app filters by team by hand. If a policy here is wrong the
-- app leaks; if it is right, a forgotten `.eq("team_id", …)` in application
-- code is harmless. That is the whole reason for pushing scoping into the
-- database rather than the query layer.
--
-- Roles are compared as text throughout. Postgres refuses to *use* an enum
-- value in the same transaction that added it, and the SQL editor runs this
-- file as one transaction — so naming 'resume_builder'::user_role in a policy
-- would fail on any database that didn't already have that value.
-- ===========================================================================

create extension if not exists "pgcrypto";

-- ===========================================================================
-- Vocabulary
-- ===========================================================================

do $$
begin
  -- Created without resume_builder and extended below, rather than listing all
  -- four here. Enum ordering is part of the type, and a database built from
  -- this file should sort roles the same way as one that grew through the
  -- earlier migrations — where resume_builder was appended last.
  if to_regtype('public.user_role') is null then
    create type user_role as enum ('super_admin', 'subadmin', 'bidder');
  end if;

  -- `admin` was renamed to `subadmin`: the role always *was* the owner of one
  -- team, and calling it "admin" beside "super admin" suggested a difference
  -- of degree when it is a difference of kind — one tenant versus all of them.
  --
  -- A rename rather than a new value plus a data migration, so every existing
  -- row keeps its role without being touched, and no window exists where some
  -- accounts are 'admin' and others 'subadmin'.
  --
  -- Guarded, because this file is meant to converge a database rather than
  -- build one: the second run finds no 'admin' to rename and does nothing.
  if exists (
    select 1 from pg_enum e
      join pg_type t on t.oid = e.enumtypid
     where t.typname = 'user_role' and e.enumlabel = 'admin'
  ) then
    alter type user_role rename value 'admin' to 'subadmin';
  end if;

  if to_regtype('public.application_status') is null then
    create type application_status as enum
      ('applied', 'viewed', 'interviewing', 'offer', 'rejected');
  end if;

  -- Billing state of an application, independent of its status.
  if to_regtype('public.billing_status') is null then
    create type billing_status as enum ('unbillable', 'unbilled', 'billed');
  end if;
end
$$;

-- Retired — see "Retiring resume_builder" at the end of this file. Postgres
-- cannot drop an enum value, so every database that ever had this one keeps
-- it; adding it here too means every database has the *same* type, whichever
-- way it was built. Nothing may hold it: a check constraint below refuses it.
alter type user_role add value if not exists 'resume_builder';

-- ===========================================================================
-- Tables
-- ===========================================================================

-- --------------------------------------------------------------------------
-- Users
--
-- auth.users holds credentials; this table holds the app's view of a person.
-- They are 1:1 and share a primary key, so `auth.uid()` joins directly here.
-- --------------------------------------------------------------------------

create table if not exists app_user (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text not null,
  name          text,
  -- Least privilege by default: a new account must never become an admin
  -- because someone forgot to pass a role.
  role          user_role not null default 'bidder',
  -- Which account created this one. This is what lets an admin manage the
  -- people they added and nobody else's. SET NULL rather than cascade:
  -- removing an admin must not delete their team's logins as a side effect.
  created_by_id uuid references app_user (id) on delete set null,
  created_at    timestamptz not null default now()
);

-- Which resume styles this account may use. Null means "the default for the
-- role" — see src/lib/style-access.ts. An empty array would mean "none", which
-- would leave the account unable to render anything.
alter table app_user
  add column if not exists allowed_templates text[],
  add column if not exists allowed_accents   text[];

create index if not exists app_user_created_by_idx on app_user (created_by_id);

-- --------------------------------------------------------------------------
-- Candidate profiles
--
-- The stable half of a resume: who someone is, where they worked, what they
-- studied. Set once, never regenerated by a model.
--
-- The structured columns are the source of truth. `profile` is a *derived*
-- render payload — the profile half of a resume document, built from those
-- columns by buildProfileDocument() in src/lib/profile.ts. Two writers of the
-- same facts drift; one writer and one reader cannot.
-- --------------------------------------------------------------------------

create table if not exists candidate_profile (
  id            uuid primary key default gen_random_uuid(),
  full_name     text not null,
  email         text,
  profile       jsonb not null,
  team_id       uuid not null references app_user (id) on delete cascade,
  created_by    uuid references app_user (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table candidate_profile
  add column if not exists phone         text,
  add column if not exists address       text,
  add column if not exists city          text,
  add column if not exists state         text,
  add column if not exists postal_code   text,
  add column if not exists country       text,
  add column if not exists birthday      date,
  add column if not exists github_url    text,
  add column if not exists linkedin_url  text,
  -- pgp_sym_encrypt output. bytea, not text: storing ciphertext as text invites
  -- an encoding round trip that silently corrupts it.
  add column if not exists ssn_encrypted bytea;

-- Superseded: `label` and `headline` by full_name, `bidder_visible` by
-- profile_assignment.
alter table candidate_profile
  drop column if exists label,
  drop column if exists headline,
  drop column if exists bidder_visible;

create index if not exists candidate_profile_team_idx on candidate_profile (team_id);

-- --------------------------------------------------------------------------
-- Profile assignments
--
-- Which bidders may work with which candidates. Without a row here a bidder
-- sees no profile at all — assignment is opt-in, so a new candidate is private
-- to the admins until deliberately routed.
-- --------------------------------------------------------------------------

create table if not exists profile_assignment (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references candidate_profile (id) on delete cascade,
  user_id     uuid not null references app_user (id) on delete cascade,
  team_id     uuid not null references app_user (id) on delete cascade,
  assigned_by uuid references app_user (id) on delete set null,
  created_at  timestamptz not null default now(),
  -- Assigning twice is a no-op, not a second row.
  unique (profile_id, user_id)
);

create index if not exists profile_assignment_user_idx on profile_assignment (user_id);
create index if not exists profile_assignment_team_idx on profile_assignment (team_id);

-- --------------------------------------------------------------------------
-- Profile attachments — photos and supporting documents
-- --------------------------------------------------------------------------

create table if not exists profile_attachment (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references candidate_profile (id) on delete cascade,
  label      text not null,
  file_key   text not null,
  file_url   text not null,
  file_name  text,
  file_type  text,
  file_size  integer,
  team_id    uuid not null references app_user (id) on delete cascade,
  created_by uuid references app_user (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists profile_attachment_profile_idx
  on profile_attachment (profile_id);

-- --------------------------------------------------------------------------
-- Resume documents
--
-- The regenerated half: positioning for one job. `content` is JSONB validated
-- by contentSchema, and its experiences reference candidate_profile
-- employments by id. That reference is checked in the zod schema on the way in,
-- which is what makes an invented employer a validation failure rather than a
-- rendered PDF.
-- --------------------------------------------------------------------------

create table if not exists resume_document (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  profile_id uuid not null references candidate_profile (id) on delete cascade,
  content    jsonb not null,
  template   text not null default 'classic',
  -- Font scale, header fields, accent — anything the PDF renderer reads that is
  -- presentation rather than content.
  style      jsonb not null default '{}'::jsonb,
  team_id    uuid not null references app_user (id) on delete cascade,
  created_by uuid references app_user (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists resume_document_team_idx on resume_document (team_id);
create index if not exists resume_document_profile_idx on resume_document (profile_id);

-- --------------------------------------------------------------------------
-- Blocked companies — never to receive an application, from any profile
-- --------------------------------------------------------------------------

create table if not exists blocked_company (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  -- Lowercased, punctuation stripped, legal suffixes removed. Matching happens
  -- on this column, so the unique index actually prevents "Acme, Inc." and
  -- "acme inc" coexisting.
  normalized_name text not null,
  team_id         uuid not null references app_user (id) on delete cascade,
  created_by      uuid references app_user (id) on delete set null,
  created_at      timestamptz not null default now()
);

create unique index if not exists blocked_company_team_name_uidx
  on blocked_company (team_id, normalized_name);

-- --------------------------------------------------------------------------
-- Applications
--
-- Uploaded resumes live in UploadThing; `resume_key` is their handle, kept so
-- deleting a row can delete the file rather than leaking storage.
-- --------------------------------------------------------------------------

create table if not exists application (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null,
  company            text not null,
  job_url            text not null,
  status             application_status not null default 'applied',
  billing            billing_status not null default 'unbilled',
  notes              text,
  resume_document_id uuid references resume_document (id) on delete set null,
  profile_id         uuid references candidate_profile (id) on delete set null,
  applied_at         timestamptz not null default now(),
  team_id            uuid not null references app_user (id) on delete cascade,
  created_by         uuid references app_user (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table application
  add column if not exists resume_key  text,
  add column if not exists resume_url  text,
  add column if not exists resume_name text;

-- Archiving. Null means active; a timestamp means "off the working list".
--
-- A nullable timestamp rather than a boolean because "when" is the question
-- anyone actually asks of an archive, and it costs the same to store. The grid
-- reads it as a flag; nothing stops a later report reading it as a date.
--
-- Deliberately NOT a soft delete. An archived row is still a row: it still
-- counts against the duplicate cooldown, still belongs to its team, still
-- appears in totals. Archiving tidies a view; deleting retracts a record. If
-- archiving also cleared the cooldown it would be a one-click way around a rule
-- the trigger otherwise enforces.
alter table application
  add column if not exists archived_at timestamptz;

-- The shared resume library is gone: a resume belongs to the application it was
-- sent with, which is how anyone reading the grid thinks about it.
alter table application drop column if exists resume_file_id;
drop table if exists resume_file;

create index if not exists application_team_idx on application (team_id);
create index if not exists application_created_by_idx on application (created_by);
create index if not exists application_status_idx on application (status);
create index if not exists application_applied_at_idx on application (applied_at desc);
create index if not exists application_profile_idx on application (profile_id);
-- Duplicate detection matches on lower(company), so the index must too — a
-- plain index on company would go unused by that lookup.
create index if not exists application_company_lower_idx on application (lower(company));
-- The default view is active rows, newest first. Partial, so the index carries
-- only what that view reads and archived rows cost it nothing.
create index if not exists application_active_idx
  on application (team_id, applied_at desc) where archived_at is null;

-- --------------------------------------------------------------------------
-- SSN access log
--
-- Every reveal is recorded. An encrypted column whose plaintext can be pulled
-- without trace is only half a control.
-- --------------------------------------------------------------------------

create table if not exists ssn_access_log (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references candidate_profile (id) on delete cascade,
  actor_id    uuid references app_user (id) on delete set null,
  team_id     uuid not null references app_user (id) on delete cascade,
  revealed_at timestamptz not null default now()
);

create index if not exists ssn_access_log_profile_idx
  on ssn_access_log (profile_id, revealed_at desc);

-- What each of the candidate's employers does — business model, products or
-- services, customers — in the profile adder's words. Sent with generation so
-- bullets can speak the employer's real domain. Free text, kept off the
-- render payload: it is source material, never printed on the resume.
alter table candidate_profile add column if not exists company_context text;

-- --------------------------------------------------------------------------
-- Resume generation — settings and the log
--
-- The resume builder can ask a model (through OpenRouter) to write a
-- resume's content. Which model, and the system prompt it works from, are
-- platform settings rather than code: they are tuned by trying them, and a
-- deploy per attempt would make that slow. One row, enforced by the key.
-- --------------------------------------------------------------------------

create table if not exists generation_setting (
  -- Always true, so the table holds exactly one row.
  id            boolean primary key default true check (id),
  system_prompt text not null default '',
  -- An OpenRouter model id. The default is the cheap, fast one the smoke
  -- tests settled on; the super admin changes it on the Generation page or
  -- from the model lab.
  model         text not null default 'openai/gpt-6-luna',
  updated_by    uuid references app_user (id) on delete set null,
  updated_at    timestamptz not null default now()
);

insert into generation_setting (id) values (true) on conflict (id) do nothing;

/*
 * One row per generation, successful or not.
 *
 * Kept so model choice can be decided on evidence: the settings page averages
 * cost, tokens, time and how often the output validated, per model. Written by
 * the server alone (service role, after its own checks), so a client cannot
 * pad or erase it.
 */
create table if not exists resume_generation (
  id                uuid primary key default gen_random_uuid(),
  profile_id        uuid references candidate_profile (id) on delete set null,
  team_id           uuid not null references app_user (id) on delete cascade,
  created_by        uuid references app_user (id) on delete set null,
  model             text not null,
  -- Calls made, counting a repair attempt after output that didn't validate.
  attempts          integer not null default 1,
  prompt_tokens     integer,
  completion_tokens integer,
  -- In US dollars, as OpenRouter reports it. Null when it didn't say.
  cost_usd          numeric(12, 6),
  latency_ms        integer,
  ok                boolean not null,
  error             text,
  created_at        timestamptz not null default now()
);

-- How hard the model should reason. "default" leaves it to the model;
-- "lowest" turns it off where allowed and uses the cheapest effort where it
-- is mandatory; an effort name ("low", "medium", "high") asks for that where
-- the model offers it. Reasoning tokens are billed as output.
alter table generation_setting
  add column if not exists reasoning text not null default 'default';

alter table generation_setting alter column model set default 'openai/gpt-6-luna';
alter table generation_setting alter column reasoning set default 'default';

-- A settings row nobody has saved yet still carries the old defaults; move it
-- to the new ones. A row someone saved (updated_by set) is theirs and stays.
update generation_setting
   set model = 'openai/gpt-6-luna', reasoning = 'default'
 where updated_by is null;

-- Base prompts the super admin keeps. One is active — what every Generate
-- uses — and none active means the built-in default in
-- src/lib/ai/resume-prompt.ts. Kept as a library rather than one text box so
-- prompts can be compared in the model lab and switched without retyping.
create table if not exists generation_prompt (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  body       text not null,
  created_by uuid references app_user (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table generation_setting
  add column if not exists active_prompt_id uuid
    references generation_prompt (id) on delete set null;

-- Two libraries in one table, told apart by `kind`:
--   resume    the base prompt every Generate uses (active_prompt_id)
--   research  what a profile adder copies, with the profile's employments,
--             into an AI assistant to draft its company context
--             (active_research_prompt_id)
-- Null for either means the built-in one in src/lib/ai/resume-prompt.ts. The
-- loaders match the kind as well as the id, so a setting pointed at the wrong
-- library falls back to the built-in rather than sending the wrong prompt.
alter table generation_prompt
  add column if not exists kind text not null default 'resume';
alter table generation_prompt drop constraint if exists generation_prompt_kind_check;
alter table generation_prompt add constraint generation_prompt_kind_check
  check (kind in ('resume', 'research'));

alter table generation_setting
  add column if not exists active_research_prompt_id uuid
    references generation_prompt (id) on delete set null;

-- The single system_prompt the settings row used to hold becomes the
-- library's first entry, and the active one. Clearing it afterwards is what
-- makes a second run of this file do nothing.
do $$
declare
  carried uuid;
begin
  if exists (select 1 from generation_setting where btrim(system_prompt) <> '') then
    insert into generation_prompt (name, body, created_by)
    select 'Saved prompt', system_prompt, updated_by from generation_setting
    returning id into carried;
    update generation_setting set active_prompt_id = carried, system_prompt = '';
  end if;
end
$$;

-- Where a generation came from, and the detail benchmarking needs.
--   source        'builder' for real resumes, 'lab' for the model lab's tests
--   run_id        groups one lab run's models, so they can be compared
--   output        the lab's answers, kept so a run can be reviewed later;
--                 null for builder rows, whose content lives in the editor
alter table resume_generation
  add column if not exists source           text not null default 'builder',
  add column if not exists run_id           uuid,
  add column if not exists reasoning        text,
  add column if not exists prompt_label     text,
  add column if not exists cached_tokens    integer,
  add column if not exists reasoning_tokens integer,
  add column if not exists output           jsonb;

create index if not exists resume_generation_created_idx
  on resume_generation (created_at desc);
create index if not exists resume_generation_run_idx
  on resume_generation (run_id) where run_id is not null;
create index if not exists resume_generation_team_idx
  on resume_generation (team_id, created_at desc);

-- ===========================================================================
-- Retiring resume_builder
--
-- Three roles now: a super admin who runs the platform, subadmins who each run
-- a team, and bidders who work the profiles their subadmin assigns them —
-- tracking applications and building resumes. A resume builder was a bidder
-- that could also create profiles; creating profiles is the subadmin's job.
--
-- Each remaining builder becomes a bidder *assigned to every profile they
-- created*, so nobody loses sight of a candidate they were working on. Only
-- profiles in their own team: a builder's team is their creator's, and an
-- assignment that crossed teams would name someone the owner cannot manage.
--
-- Roles compared as text, like everywhere else, so this runs in the same
-- transaction as the `add value` above.
-- ===========================================================================

insert into profile_assignment (profile_id, user_id, team_id, assigned_by)
select p.id, u.id, p.team_id, u.created_by_id
  from app_user u
  join candidate_profile p
    on p.created_by = u.id
   and p.team_id = u.created_by_id
 where u.role::text = 'resume_builder'
on conflict (profile_id, user_id) do nothing;

update app_user set role = 'bidder' where role::text = 'resume_builder';

-- Dropped and re-added so the definition here is always the live one.
alter table app_user drop constraint if exists app_user_role_retired;
alter table app_user add constraint app_user_role_retired
  check (role::text <> 'resume_builder');
