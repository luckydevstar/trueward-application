-- ===========================================================================
-- The resume_builder role
--
-- Creates candidate profiles and builds resumes from them. Sees only the
-- profiles they created themselves — not a teammate's, not the team's. No
-- applications, no blocklist, no user management.
--
-- ---------------------------------------------------------------------------
-- Why this migration is mostly a rewrite of existing policies
--
-- Almost every privileged check so far read `app_role() <> 'bidder'`. When
-- bidder was the only unprivileged role that was the same thing as "is an
-- admin" — but a second unprivileged role makes them different, and a new role
-- would have passed all 22 of them by default. Anything meaning "is an admin"
-- now says so.
--
-- That is the failure mode worth naming: a role added without auditing those
-- checks would silently inherit admin rights over applications, the blocklist,
-- profile assignment and billing.
-- ===========================================================================

alter type user_role add value if not exists 'resume_builder';

-- ---------------------------------------------------------------------------
-- Role predicates
--
-- Compared as text, deliberately. Postgres refuses to *use* an enum value in
-- the same transaction that added it, and a policy body naming
-- 'resume_builder'::user_role counts as using it — so the whole migration would
-- fail if the editor wraps it in one transaction. Casting the role to text
-- never constructs the enum value and sidesteps that entirely.
-- ---------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select app_role()::text in ('admin', 'super_admin')
$$;

create or replace function public.is_builder()
returns boolean
language sql
stable
as $$
  select app_role()::text = 'resume_builder'
$$;

-- ---------------------------------------------------------------------------
-- A builder belongs to the admin who created them
--
-- app_team_id() listed the roles it knew and returned null for anything else,
-- so a resume_builder had no team — and every policy starts with
-- `team_id = app_team_id()`, which is null-safe in the worst way: it isn't
-- false, it's unknown, so it never matches. The account could read nothing and
-- write nothing, with no error explaining why.
--
-- Rewritten with text comparisons for the same reason as the predicates above.
-- ---------------------------------------------------------------------------

create or replace function public.app_team_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case
    when u.role::text = 'admin' then u.id
    when u.role::text in ('bidder', 'resume_builder') then u.created_by_id
    else null                       -- super_admin: owns no records
  end
  from app_user u
  where u.id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- Which profiles a person may work with
--
-- admin           every profile on the team
-- resume_builder  only the ones they created
-- bidder          only the ones assigned to them
-- ---------------------------------------------------------------------------

create or replace function public.can_use_profile(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when is_admin() then true
    when is_builder() then exists (
      select 1 from candidate_profile
      where id = target and created_by = auth.uid()
    )
    else exists (
      select 1 from profile_assignment
      where profile_id = target and user_id = auth.uid()
    )
  end
$$;

-- ---------------------------------------------------------------------------
-- candidate_profile
--
-- A builder creates and edits their own; an admin edits anything on the team.
-- A bidder still edits nothing — they write resume content, not someone's
-- identity.
-- ---------------------------------------------------------------------------

drop policy if exists candidate_profile_select on candidate_profile;
create policy candidate_profile_select on candidate_profile
  for select using (
    team_id = app_team_id() and can_use_profile(id)
  );

drop policy if exists candidate_profile_insert on candidate_profile;
create policy candidate_profile_insert on candidate_profile
  for insert with check (
    team_id = app_team_id()
    and created_by = auth.uid()
    and (is_admin() or is_builder())
  );

drop policy if exists candidate_profile_update on candidate_profile;
create policy candidate_profile_update on candidate_profile
  for update using (
    team_id = app_team_id()
    and (is_admin() or (is_builder() and created_by = auth.uid()))
  ) with check (team_id = app_team_id());

drop policy if exists candidate_profile_delete on candidate_profile;
create policy candidate_profile_delete on candidate_profile
  for delete using (
    team_id = app_team_id()
    and (is_admin() or (is_builder() and created_by = auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- resume_document
--
-- Follows the profile: you may write a resume for a candidate you may work
-- with, and change one you wrote.
-- ---------------------------------------------------------------------------

drop policy if exists resume_document_select on resume_document;
create policy resume_document_select on resume_document
  for select using (
    team_id = app_team_id() and can_use_profile(profile_id)
  );

drop policy if exists resume_document_insert on resume_document;
create policy resume_document_insert on resume_document
  for insert with check (
    team_id = app_team_id()
    and created_by = auth.uid()
    and can_use_profile(profile_id)
  );

drop policy if exists resume_document_update on resume_document;
create policy resume_document_update on resume_document
  for update using (
    team_id = app_team_id()
    and (is_admin() or created_by = auth.uid())
    and can_use_profile(profile_id)
  ) with check (team_id = app_team_id());

drop policy if exists resume_document_delete on resume_document;
create policy resume_document_delete on resume_document
  for delete using (
    team_id = app_team_id()
    and (is_admin() or created_by = auth.uid())
    and can_use_profile(profile_id)
  );

-- ---------------------------------------------------------------------------
-- profile_attachment — same reach as the profile it hangs off
-- ---------------------------------------------------------------------------

drop policy if exists profile_attachment_delete on profile_attachment;
create policy profile_attachment_delete on profile_attachment
  for delete using (
    team_id = app_team_id() and can_use_profile(profile_id)
  );

-- ---------------------------------------------------------------------------
-- profile_assignment — routing candidates to people is an admin job
-- ---------------------------------------------------------------------------

drop policy if exists profile_assignment_insert on profile_assignment;
create policy profile_assignment_insert on profile_assignment
  for insert with check (
    team_id = app_team_id() and is_admin() and assigned_by = auth.uid()
  );

drop policy if exists profile_assignment_delete on profile_assignment;
create policy profile_assignment_delete on profile_assignment
  for delete using (team_id = app_team_id() and is_admin());

-- ---------------------------------------------------------------------------
-- application — a builder has no part in the tracker
--
-- Without this they would have read the whole team's applications, and been
-- able to edit and delete any of them.
-- ---------------------------------------------------------------------------

drop policy if exists application_select on application;
create policy application_select on application
  for select using (
    team_id = app_team_id()
    and not is_builder()
    and (
      is_admin()
      or created_by = auth.uid()
      or can_use_profile(profile_id)
    )
  );

drop policy if exists application_insert on application;
create policy application_insert on application
  for insert with check (
    team_id = app_team_id() and created_by = auth.uid() and not is_builder()
  );

drop policy if exists application_update on application;
create policy application_update on application
  for update using (
    team_id = app_team_id()
    and not is_builder()
    and (is_admin() or created_by = auth.uid())
  ) with check (team_id = app_team_id());

drop policy if exists application_delete on application;
create policy application_delete on application
  for delete using (
    team_id = app_team_id()
    and not is_builder()
    and (is_admin() or created_by = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- blocked_company — readable by the team, edited by admins
-- ---------------------------------------------------------------------------

drop policy if exists blocked_company_insert on blocked_company;
create policy blocked_company_insert on blocked_company
  for insert with check (
    team_id = app_team_id() and is_admin() and created_by = auth.uid()
  );

drop policy if exists blocked_company_delete on blocked_company;
create policy blocked_company_delete on blocked_company
  for delete using (team_id = app_team_id() and is_admin());

-- ---------------------------------------------------------------------------
-- ssn_access_log — the audit trail is an admin's to read
-- ---------------------------------------------------------------------------

drop policy if exists ssn_access_log_select on ssn_access_log;
create policy ssn_access_log_select on ssn_access_log
  for select using (team_id = app_team_id() and is_admin());

-- ---------------------------------------------------------------------------
-- Billing stays an admin decision
--
-- The trigger asked whether the caller was a bidder. A resume_builder is not,
-- so it would have let one through — even though they never reach an
-- application. Asking the question the right way round removes the question.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_billing_authority()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- A new application is always 'unbilled'. Rejecting rather than silently
    -- coercing, so a client sending something else finds out it was ignored.
    if new.billing is distinct from 'unbilled'::billing_status then
      raise exception using
        errcode = 'insufficient_privilege',
        message = 'Only an admin can set billing status. New applications start as unbilled.';
    end if;
    return new;
  end if;

  if new.billing is distinct from old.billing then
    raise exception using
      errcode = 'insufficient_privilege',
      message = format(
        'Only an admin can change billing status (tried %s → %s).',
        old.billing, new.billing
      );
  end if;

  return new;
end;
$$;
