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
    create type user_role as enum ('super_admin', 'admin', 'bidder');
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

-- For databases created before the role existed.
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
