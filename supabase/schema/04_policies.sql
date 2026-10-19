-- ===========================================================================
-- Trueward Guru — schema part 4 of 4: Row level security
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
-- Row level security
--
-- Shape shared by every record table:
--   read   — in_team(team_id), and my role may reach the row
--   write  — in_own_team(team_id), my role may make the change, and the row
--            is stamped with my id
--
-- Two team tests, on purpose. in_team() admits a super admin to every team,
-- because their job is to review them. in_own_team() admits only members,
-- because a written row must belong to one team and a super admin belongs to
-- none — see 02_functions.sql. A write policy that used in_team() would let a
-- super admin stamp rows into any team.
--
-- The WITH CHECK clauses are what stop a client inserting into another team by
-- posting a different team_id: the anon key reaches Postgres directly, so
-- anything not asserted here is not enforced anywhere.
--
-- Who writes what:
--   subadmin  everything in their team
--   bidder    applications and resumes, for profiles assigned to them only
--   super     profiles and their attachments in any team (update and delete,
--             not create — a new profile needs a team, and they have none);
--             applications and resumes like a bidder, for profiles they have
--             assigned to themselves, filed in the profile's team
--             (works_in_team); account management goes through server
--             actions, and moves through SECURITY DEFINER functions
-- ===========================================================================

alter table app_user           enable row level security;
alter table candidate_profile  enable row level security;
alter table profile_assignment enable row level security;
alter table profile_attachment enable row level security;
alter table resume_document    enable row level security;
alter table blocked_company    enable row level security;
alter table application        enable row level security;
alter table ssn_access_log     enable row level security;
alter table generation_setting enable row level security;
alter table resume_generation  enable row level security;
alter table generation_prompt  enable row level security;
alter table resume_job         enable row level security;
alter table job_sheet          enable row level security;
alter table sheet_job          enable row level security;
alter table resume_queue_setting enable row level security;
alter table resume_queue_secret  enable row level security;

-- --- app_user -------------------------------------------------------------

-- Always your own row: the app reads it on every request to learn your role,
-- and the policies below would deadlock on themselves without it.
drop policy if exists app_user_self_select on app_user;
create policy app_user_self_select on app_user
  for select using (id = auth.uid());

-- The super admin's own row is readable by every team member: they may work
-- a profile in any team, and the team reading that history should see who
-- recorded it rather than an unknown author. Their row holds a name, an email
-- and a role, nothing a teammate shouldn't know about the platform's owner.
drop policy if exists app_user_team_select on app_user;
create policy app_user_team_select on app_user
  for select using (
    app_role()::text = 'super_admin'
    or created_by_id = auth.uid()
    or id = app_team_id()
    -- Team members only: not anon, and not a teamless account that signed
    -- itself up.
    or (role::text = 'super_admin' and app_team_id() is not null)
  );

-- No update policy, so nobody can update app_user through the API at all.
--
-- There used to be one for your own row, which pinned `id` and `role` and
-- nothing else — so any account could rewrite its own `created_by_id`, which
-- *is* a bidder's team (app_team_id()). Combined with open sign-up, a stranger
-- could register and join any team whose subadmin id they knew.
--
-- Nothing needs it. Every change to an account — name, email, password, style
-- allowances — goes through src/app/dashboard/users/actions.ts, which checks
-- the actor itself and writes with the service role.
drop policy if exists app_user_self_update on app_user;

-- --- candidate_profile ----------------------------------------------------

drop policy if exists candidate_profile_select on candidate_profile;
create policy candidate_profile_select on candidate_profile
  for select using (in_team(team_id) and can_use_profile(id));

-- Profiles are the subadmin's to create and keep, and the super admin may
-- correct or remove any of them. A bidder reads the ones assigned to them and
-- edits none — they write resume content against a profile, never the
-- person's identity.
--
-- The super admin's WITH CHECK admits any team, so moving a profile by
-- rewriting team_id is stopped by a trigger instead (guard_profile_team() in
-- part 2): a profile moved without its applications would leave the cooldown
-- blind to where that candidate has been sent.
drop policy if exists candidate_profile_insert on candidate_profile;
create policy candidate_profile_insert on candidate_profile
  for insert with check (
    in_own_team(team_id) and is_subadmin() and created_by = auth.uid()
  );

drop policy if exists candidate_profile_update on candidate_profile;
create policy candidate_profile_update on candidate_profile
  for update using (is_super_admin() or (in_own_team(team_id) and is_subadmin()))
  with check (is_super_admin() or in_own_team(team_id));

drop policy if exists candidate_profile_delete on candidate_profile;
create policy candidate_profile_delete on candidate_profile
  for delete using (is_super_admin() or (in_own_team(team_id) and is_subadmin()));

-- --- profile_assignment ---------------------------------------------------

-- A bidder may read their own assignments — that is how the UI knows what to
-- offer — but only their subadmin may create or remove one. The super admin
-- assigns profiles to themselves, in any team, and removes only their own.
drop policy if exists profile_assignment_select on profile_assignment;
create policy profile_assignment_select on profile_assignment
  for select using (
    in_team(team_id) and (is_admin() or user_id = auth.uid())
  );

-- Both ends must be in the team: the profile (profile_in_team) and the person,
-- who must be a bidder this subadmin created. Without the second, an
-- assignment could name another team's bidder, who would then see this
-- team's candidate through can_use_profile().
drop policy if exists profile_assignment_insert on profile_assignment;
create policy profile_assignment_insert on profile_assignment
  for insert with check (
    (
      in_own_team(team_id)
      and is_subadmin()
      and assigned_by = auth.uid()
      and profile_in_team(profile_id, team_id)
      and exists (
        select 1 from app_user u
         where u.id = user_id
           and u.created_by_id = team_id
           and u.role::text = 'bidder'
      )
    )
    or (
      -- Themselves only: the super admin does not route a team's work to its
      -- bidders, which stays the subadmin's call.
      is_super_admin()
      and user_id = auth.uid()
      and assigned_by = auth.uid()
      and profile_in_team(profile_id, team_id)
    )
  );

-- A subadmin removes their bidders' assignments, not the super admin's: that
-- one is the super admin's to give up.
drop policy if exists profile_assignment_delete on profile_assignment;
create policy profile_assignment_delete on profile_assignment
  for delete using (
    (
      in_own_team(team_id)
      and is_subadmin()
      and exists (
        select 1 from app_user u
         where u.id = user_id
           and u.created_by_id = team_id
           and u.role::text = 'bidder'
      )
    )
    or (is_super_admin() and user_id = auth.uid())
  );

-- --- profile_attachment ---------------------------------------------------
-- Part of the profile, so it follows the profile: readable by whoever may use
-- the profile, written by whoever may edit it — its subadmin, or the super
-- admin.

drop policy if exists profile_attachment_select on profile_attachment;
create policy profile_attachment_select on profile_attachment
  for select using (in_team(team_id) and can_use_profile(profile_id));

drop policy if exists profile_attachment_insert on profile_attachment;
create policy profile_attachment_insert on profile_attachment
  for insert with check (
    (is_super_admin() or (in_own_team(team_id) and is_subadmin()))
    and created_by = auth.uid()
    and profile_in_team(profile_id, team_id)
  );

drop policy if exists profile_attachment_delete on profile_attachment;
create policy profile_attachment_delete on profile_attachment
  for delete using (is_super_admin() or (in_own_team(team_id) and is_subadmin()));

-- --- resume_document ------------------------------------------------------
-- Follows the profile: you may write a resume for a candidate you may work
-- with, and change one you wrote. A bidder whose assignment is removed keeps
-- sight of nothing, including their own resumes for that candidate.
--
-- works_in_team() rather than in_own_team() in the writes, so a super admin
-- working a profile assigned to them writes into its team like a bidder.

drop policy if exists resume_document_select on resume_document;
create policy resume_document_select on resume_document
  for select using (in_team(team_id) and can_use_profile(profile_id));

drop policy if exists resume_document_insert on resume_document;
create policy resume_document_insert on resume_document
  for insert with check (
    works_in_team(team_id, profile_id)
    and created_by = auth.uid()
    and can_use_profile(profile_id)
    and profile_in_team(profile_id, team_id)
  );

-- The WITH CHECK repeats the profile tests so an update cannot re-point a
-- resume at a candidate the author may not work with.
drop policy if exists resume_document_update on resume_document;
create policy resume_document_update on resume_document
  for update using (
    works_in_team(team_id, profile_id)
    and (is_subadmin() or created_by = auth.uid())
    and can_use_profile(profile_id)
  ) with check (
    works_in_team(team_id, profile_id)
    and can_use_profile(profile_id)
    and profile_in_team(profile_id, team_id)
  );

drop policy if exists resume_document_delete on resume_document;
create policy resume_document_delete on resume_document
  for delete using (
    works_in_team(team_id, profile_id)
    and (is_subadmin() or created_by = auth.uid())
    and can_use_profile(profile_id)
  );

-- --- blocked_company ------------------------------------------------------
-- Readable by the whole team — a bidder must be able to check the list before
-- applying, which is the only reason it exists. Edited by the subadmin.

drop policy if exists blocked_company_select on blocked_company;
create policy blocked_company_select on blocked_company
  for select using (in_team(team_id));

drop policy if exists blocked_company_insert on blocked_company;
create policy blocked_company_insert on blocked_company
  for insert with check (
    in_own_team(team_id) and is_subadmin() and created_by = auth.uid()
  );

drop policy if exists blocked_company_delete on blocked_company;
create policy blocked_company_delete on blocked_company
  for delete using (in_own_team(team_id) and is_subadmin());

-- --- application ----------------------------------------------------------
--
-- Sharing a candidate means sharing their history: two people working the same
-- profile need to see where it has already been sent, or they duplicate each
-- other's work. Acting on a record stays with whoever recorded it.
--
-- A bidder records applications only for a profile assigned to them —
-- can_use_profile() is false for them on a null profile, so "no profile" is not
-- a way around it. A subadmin may still record one with no profile, as the
-- older rows have none. A super admin records, and changes their own, only for
-- a profile assigned to them, in that profile's team (works_in_team(), which
-- is false for them on a null profile).

drop policy if exists application_select on application;
create policy application_select on application
  for select using (
    in_team(team_id)
    and (
      is_admin()                      -- subadmins see the team, super all
      or created_by = auth.uid()      -- your own rows, profile or not
      or can_use_profile(profile_id)  -- rows for a profile you're assigned
    )
  );

drop policy if exists application_insert on application;
create policy application_insert on application
  for insert with check (
    works_in_team(team_id, profile_id)
    and created_by = auth.uid()
    and can_use_profile(profile_id)
    and (profile_id is null or profile_in_team(profile_id, team_id))
  );

-- A bidder keeps sight of an application they recorded after the profile is
-- unassigned (select: created_by), but can no longer change it — the WITH
-- CHECK requires the profile to be theirs to work.
drop policy if exists application_update on application;
create policy application_update on application
  for update using (
    works_in_team(team_id, profile_id)
    and (is_subadmin() or created_by = auth.uid())
  ) with check (
    works_in_team(team_id, profile_id)
    and can_use_profile(profile_id)
    and (profile_id is null or profile_in_team(profile_id, team_id))
  );

drop policy if exists application_delete on application;
create policy application_delete on application
  for delete using (
    works_in_team(team_id, profile_id)
    and (is_subadmin() or created_by = auth.uid())
  );

-- --- ssn_access_log -------------------------------------------------------
-- Subadmins reveal and audit their team's; the super admin audits every team.
-- Append-only on purpose: no update or delete policy exists, so the trail
-- cannot be edited from the app at all.

drop policy if exists ssn_access_log_select on ssn_access_log;
create policy ssn_access_log_select on ssn_access_log
  for select using (in_team(team_id) and is_admin());

drop policy if exists ssn_access_log_insert on ssn_access_log;
create policy ssn_access_log_insert on ssn_access_log
  for insert with check (
    in_own_team(team_id) and is_subadmin() and actor_id = auth.uid()
  );

-- --- generation_setting ---------------------------------------------------
-- The super admin's to read and change. Nobody else reads the prompt: the
-- builder's server action fetches it with the service role after checking the
-- caller may use the profile, so the prompt never travels to a browser.
-- No insert or delete policy — the one row is created by part 1.

drop policy if exists generation_setting_select on generation_setting;
create policy generation_setting_select on generation_setting
  for select using (is_super_admin());

drop policy if exists generation_setting_update on generation_setting;
create policy generation_setting_update on generation_setting
  for update using (is_super_admin())
  with check (is_super_admin() and updated_by = auth.uid());

-- --- generation_prompt ----------------------------------------------------
-- The super admin's library. The builder's action reads the active prompt with
-- the service role, so nobody else needs to read it.

drop policy if exists generation_prompt_select on generation_prompt;
create policy generation_prompt_select on generation_prompt
  for select using (is_super_admin());

drop policy if exists generation_prompt_insert on generation_prompt;
create policy generation_prompt_insert on generation_prompt
  for insert with check (is_super_admin() and created_by = auth.uid());

drop policy if exists generation_prompt_update on generation_prompt;
create policy generation_prompt_update on generation_prompt
  for update using (is_super_admin()) with check (is_super_admin());

drop policy if exists generation_prompt_delete on generation_prompt;
create policy generation_prompt_delete on generation_prompt
  for delete using (is_super_admin());

-- --- resume_generation ----------------------------------------------------
-- Read-only from the app: subadmins see their team's, the super admin every
-- team's. Written by the server with the service role, so no insert policy.

drop policy if exists resume_generation_select on resume_generation;
create policy resume_generation_select on resume_generation
  for select using (in_team(team_id) and is_admin());

-- --- resume_job -----------------------------------------------------------
-- A person's own drafts. Started through the builder's action (the caller's
-- client, so these checks apply) and finished by the server with the service
-- role. Read, edited and removed by their creator only, and only while they
-- may still work the profile — the same test resumes and applications use.

drop policy if exists resume_job_select on resume_job;
create policy resume_job_select on resume_job
  for select using (created_by = auth.uid() and can_use_profile(profile_id));

drop policy if exists resume_job_insert on resume_job;
create policy resume_job_insert on resume_job
  for insert with check (
    created_by = auth.uid()
    and works_in_team(team_id, profile_id)
    and can_use_profile(profile_id)
    and profile_in_team(profile_id, team_id)
  );

drop policy if exists resume_job_update on resume_job;
create policy resume_job_update on resume_job
  for update using (created_by = auth.uid() and works_in_team(team_id, profile_id))
  with check (
    created_by = auth.uid()
    and works_in_team(team_id, profile_id)
    and can_use_profile(profile_id)
    and profile_in_team(profile_id, team_id)
  );

drop policy if exists resume_job_delete on resume_job;
create policy resume_job_delete on resume_job
  for delete using (created_by = auth.uid());

-- --- job_sheet / sheet_job -----------------------------------------------
-- A person's own job list. Nobody else reads it — not their subadmin, not the
-- super admin: what matters to the team is the resumes and applications made
-- from it, which carry their own policies.

drop policy if exists job_sheet_own on job_sheet;
create policy job_sheet_own on job_sheet
  for all using (created_by = auth.uid()) with check (created_by = auth.uid());

drop policy if exists sheet_job_own on sheet_job;
create policy sheet_job_own on sheet_job
  for all using (created_by = auth.uid()) with check (created_by = auth.uid());

-- --- resume queue ----------------------------------------------------------
-- The super admin may see and move the runner's endpoint; the secret has no
-- policy at all, so only the functions in part 2 and pg_cron read it.

drop policy if exists resume_queue_setting_super on resume_queue_setting;
create policy resume_queue_setting_super on resume_queue_setting
  for all to authenticated using (is_super_admin()) with check (is_super_admin());

revoke all on resume_queue_secret from anon, authenticated;

-- ===========================================================================
-- Retired with the resume_builder role. Dropped here rather than in part 2
-- because the policies above were its last users, and Postgres refuses to drop
-- a function a policy still names.
-- ===========================================================================

drop function if exists public.is_builder();

-- ===========================================================================
-- Note on file storage
--
-- Uploaded bytes live in UploadThing, not in Supabase Storage, so there is no
-- bucket or storage.objects policy here. Access control for a file is the row
-- that points at it: the row is team-scoped by the policies above, and the app
-- only ever surfaces a URL it read from a row the caller was allowed to select.
--
-- Worth being clear about the limit of that: an UploadThing file URL is a
-- capability, not a session-checked resource. Anyone holding the URL can fetch
-- it. If resumes ever need to be unguessable-and-revocable, move them behind a
-- route handler that re-checks the row before streaming.
-- ===========================================================================
