-- ===========================================================================
-- Profile rework, assignments, attachments
--
--   * candidate_profile gains a structured postal address, birthday, and an
--     encrypted SSN
--   * profile_assignment routes specific candidates to specific bidders
--   * profile_attachment holds photos and supporting documents
--   * application gains its own resume attachment, edited inline in the grid
-- ===========================================================================

create extension if not exists "pgcrypto";

-- --------------------------------------------------------------------------
-- Candidate profile: identity fields
--
-- `label` and `headline` are dropped — the list now identifies a profile by
-- the person's name, which is what anyone reading it was using anyway.
-- --------------------------------------------------------------------------

alter table candidate_profile
  add column phone       text,
  add column address     text,
  add column city        text,
  add column state       text,
  add column postal_code text,
  add column country     text,
  add column birthday    date,
  add column github_url  text,
  add column linkedin_url text,
  -- pgp_sym_encrypt output. bytea, not text: storing ciphertext as text
  -- invites an encoding round trip that silently corrupts it.
  add column ssn_encrypted bytea;

-- Existing rows carry a label; keep the data by folding it into full_name's
-- neighbourhood before the column goes.
update candidate_profile
   set full_name = coalesce(nullif(full_name, ''), label)
 where full_name is null or full_name = '';

alter table candidate_profile
  drop column if exists label,
  drop column if exists headline;

-- --------------------------------------------------------------------------
-- SSN encryption
--
-- The key never lives in the database. It is passed in per call from
-- APP_ENCRYPTION_KEY, held only in the server environment, so a dump of this
-- table yields ciphertext and nothing else.
--
-- These are deliberately NOT security definer. They are pure transforms with
-- no table access — the caller still has to get past RLS to reach the row, and
-- a definer function here would be a way to decrypt rows you can't select.
-- --------------------------------------------------------------------------

create or replace function public.encrypt_ssn(plain text, key text)
returns bytea
language sql
immutable
as $$
  select case
    when plain is null or btrim(plain) = '' then null
    -- Digits only: "123-45-6789" and "123456789" must not encrypt to two
    -- different ciphertexts for the same person.
    else pgp_sym_encrypt(regexp_replace(plain, '\D', '', 'g'), key)
  end
$$;

create or replace function public.decrypt_ssn(cipher bytea, key text)
returns text
language plpgsql
immutable
as $$
begin
  if cipher is null then
    return null;
  end if;
  return pgp_sym_decrypt(cipher, key);
exception
  -- A wrong key raises. Surfacing that as null rather than an error keeps the
  -- failure from leaking whether a given row *has* an SSN.
  when others then
    return null;
end;
$$;

/**
 * Read and write the ciphertext without the key or the plaintext ever crossing
 * the client boundary.
 *
 * Called only from the service-role client, and only after
 * src/app/dashboard/profiles/ssn-actions.ts has checked the caller is an admin
 * *and* that the row is visible to them through RLS. Because service role
 * bypasses policies, these two functions are exactly as safe as those checks —
 * so `revoke from authenticated` below makes sure they cannot be invoked from a
 * browser session directly, which would skip the checks entirely.
 */
create function public.reveal_ssn(target uuid, key text)
returns text
language sql
stable
as $$
  select decrypt_ssn(ssn_encrypted, key)
  from candidate_profile
  where id = target
$$;

create function public.store_ssn(target uuid, plain text, key text)
returns void
language sql
as $$
  update candidate_profile
     set ssn_encrypted = encrypt_ssn(plain, key)
   where id = target
$$;

-- PostgREST exposes public functions to any authenticated caller by default.
-- These two must not be reachable that way — the anon/authenticated roles could
-- otherwise call reveal_ssn with a guessed key and skip every check above.
revoke all on function public.reveal_ssn(uuid, text) from public;
revoke all on function public.store_ssn(uuid, text, text) from public;
revoke all on function public.encrypt_ssn(text, text) from public;
revoke all on function public.decrypt_ssn(bytea, text) from public;

-- --------------------------------------------------------------------------
-- SSN access log
--
-- Every reveal is recorded. An encrypted column whose plaintext can be pulled
-- without trace is only half a control.
-- --------------------------------------------------------------------------

create table ssn_access_log (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references candidate_profile (id) on delete cascade,
  actor_id   uuid references app_user (id) on delete set null,
  team_id    uuid not null references app_user (id) on delete cascade,
  revealed_at timestamptz not null default now()
);

create index ssn_access_log_profile_idx on ssn_access_log (profile_id, revealed_at desc);

-- --------------------------------------------------------------------------
-- Profile assignments
--
-- Which bidders may work with which candidate profiles. Without a row here a
-- bidder sees no profile at all — assignment is opt-in, so a new candidate is
-- private to the admins until deliberately routed.
-- --------------------------------------------------------------------------

create table profile_assignment (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references candidate_profile (id) on delete cascade,
  user_id     uuid not null references app_user (id) on delete cascade,
  team_id     uuid not null references app_user (id) on delete cascade,
  assigned_by uuid references app_user (id) on delete set null,
  created_at  timestamptz not null default now(),

  -- Assigning twice is a no-op, not a second row.
  unique (profile_id, user_id)
);

create index profile_assignment_user_idx on profile_assignment (user_id);
create index profile_assignment_team_idx on profile_assignment (team_id);

/**
 * True when the current user may work with this profile.
 *
 * SECURITY DEFINER so candidate_profile's policy can consult
 * profile_assignment without that table's own policy re-entering
 * candidate_profile — the two reference each other, and a plain function
 * would recurse.
 */
create function public.can_use_profile(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    -- Admins see their whole team's candidates; assignment is a bidder concept.
    when app_role() <> 'bidder' then true
    else exists (
      select 1 from profile_assignment
      where profile_id = target and user_id = auth.uid()
    )
  end
$$;

-- --------------------------------------------------------------------------
-- Profile attachments
-- --------------------------------------------------------------------------

create table profile_attachment (
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

create index profile_attachment_profile_idx on profile_attachment (profile_id);

-- --------------------------------------------------------------------------
-- Application resume attachment
--
-- The standalone resume library is gone; a resume is attached to the
-- application it was sent with, uploaded from the grid cell itself. Denormalized
-- onto the row rather than a join, because the grid renders one cell per row and
-- a join would cost a query per page of results.
-- --------------------------------------------------------------------------

alter table application
  add column resume_key  text,
  add column resume_url  text,
  add column resume_name text;

-- Carry across whatever the library already held for each application, so the
-- grid isn't blank for historical rows.
update application a
   set resume_key  = r.file_key,
       resume_url  = coalesce(r.file_url, r.url),
       resume_name = coalesce(r.file_name, r.label)
  from resume_file r
 where a.resume_file_id = r.id;

alter table application drop column if exists resume_file_id;

-- The shared library is gone with its page: a resume now belongs to the
-- application it was sent with, which is how anyone reading the grid thinks
-- about it anyway.
drop table if exists resume_file;

-- --------------------------------------------------------------------------
-- Employment and education additional info
--
-- Free-text context that never appears verbatim on a resume — it is raw
-- material for whatever generates `content`. Lives in the profile JSONB
-- alongside each employment, so no column is needed here; see
-- src/lib/document/schema.ts.
-- --------------------------------------------------------------------------

-- ===========================================================================
-- Policies for the new tables
-- ===========================================================================

alter table profile_assignment enable row level security;
alter table profile_attachment enable row level security;
alter table ssn_access_log     enable row level security;

-- --- profile_assignment ---------------------------------------------------

-- A bidder may read their own assignments (that is how the UI knows what to
-- offer), but only an admin may create or remove one.
create policy profile_assignment_select on profile_assignment
  for select using (
    team_id = app_team_id()
    and (app_role() <> 'bidder' or user_id = auth.uid())
  );

create policy profile_assignment_insert on profile_assignment
  for insert with check (
    team_id = app_team_id()
    and app_role() <> 'bidder'
    and assigned_by = auth.uid()
  );

create policy profile_assignment_delete on profile_assignment
  for delete using (
    team_id = app_team_id() and app_role() <> 'bidder'
  );

-- --- profile_attachment ---------------------------------------------------

create policy profile_attachment_select on profile_attachment
  for select using (
    team_id = app_team_id() and can_use_profile(profile_id)
  );

create policy profile_attachment_insert on profile_attachment
  for insert with check (
    team_id = app_team_id()
    and created_by = auth.uid()
    and can_use_profile(profile_id)
  );

create policy profile_attachment_delete on profile_attachment
  for delete using (
    team_id = app_team_id() and can_use_profile(profile_id)
  );

-- --- ssn_access_log -------------------------------------------------------

-- Admins audit; bidders never reveal an SSN, so they have nothing to read.
create policy ssn_access_log_select on ssn_access_log
  for select using (
    team_id = app_team_id() and app_role() <> 'bidder'
  );

-- Written by the reveal action. Append-only on purpose: no update or delete
-- policy exists, so the trail cannot be edited from the app at all.
create policy ssn_access_log_insert on ssn_access_log
  for insert with check (
    team_id = app_team_id() and actor_id = auth.uid()
  );

-- --- candidate_profile: assignment replaces bidder_visible ----------------

drop policy if exists candidate_profile_select on candidate_profile;

create policy candidate_profile_select on candidate_profile
  for select using (
    team_id = app_team_id() and can_use_profile(id)
  );

-- Editing a candidate's identity is an admin action. A bidder writes resume
-- content, not someone's name and date of birth.
drop policy if exists candidate_profile_update on candidate_profile;

create policy candidate_profile_update on candidate_profile
  for update using (
    team_id = app_team_id() and app_role() <> 'bidder'
  ) with check (team_id = app_team_id());

drop policy if exists candidate_profile_insert on candidate_profile;

create policy candidate_profile_insert on candidate_profile
  for insert with check (
    team_id = app_team_id()
    and created_by = auth.uid()
    and app_role() <> 'bidder'
  );

drop policy if exists candidate_profile_delete on candidate_profile;

create policy candidate_profile_delete on candidate_profile
  for delete using (
    team_id = app_team_id() and app_role() <> 'bidder'
  );

-- bidder_visible is superseded by profile_assignment.
alter table candidate_profile drop column if exists bidder_visible;

-- --- resume_document: follows profile access ------------------------------

drop policy if exists resume_document_select on resume_document;

create policy resume_document_select on resume_document
  for select using (
    team_id = app_team_id() and can_use_profile(profile_id)
  );
