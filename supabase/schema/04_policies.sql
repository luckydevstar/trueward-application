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
--   read   — the row is in my team, and my role may reach it
--   write  — same, plus the row must be stamped with my team and my id
--
-- The WITH CHECK clauses are what stop a client inserting into another team by
-- posting a different team_id: the anon key reaches Postgres directly, so
-- anything not asserted here is not enforced anywhere.
-- ===========================================================================

alter table app_user           enable row level security;
alter table candidate_profile  enable row level security;
alter table profile_assignment enable row level security;
alter table profile_attachment enable row level security;
alter table resume_document    enable row level security;
alter table blocked_company    enable row level security;
alter table application        enable row level security;
alter table ssn_access_log     enable row level security;

-- --- app_user -------------------------------------------------------------

-- Always your own row: the app reads it on every request to learn your role,
-- and the policies below would deadlock on themselves without it.
drop policy if exists app_user_self_select on app_user;
create policy app_user_self_select on app_user
  for select using (id = auth.uid());

drop policy if exists app_user_team_select on app_user;
create policy app_user_team_select on app_user
  for select using (
    app_role()::text = 'super_admin'
    or created_by_id = auth.uid()
    or id = app_team_id()
  );

drop policy if exists app_user_self_update on app_user;
create policy app_user_self_update on app_user
  for update using (id = auth.uid()) with check (
    id = auth.uid()
    -- Your own row, but not your own role: self-promotion would make the
    -- hierarchy decorative. Compared against app_role() rather than a subquery
    -- on app_user, which would re-enter this table's policies and recurse.
    and role = app_role()
  );

-- --- candidate_profile ----------------------------------------------------

drop policy if exists candidate_profile_select on candidate_profile;
create policy candidate_profile_select on candidate_profile
  for select using (team_id = app_team_id() and can_use_profile(id));

drop policy if exists candidate_profile_insert on candidate_profile;
create policy candidate_profile_insert on candidate_profile
  for insert with check (
    team_id = app_team_id()
    and created_by = auth.uid()
    and (is_admin() or is_builder())
  );

-- A builder edits their own; an admin edits anything on the team. A bidder
-- edits nothing — they write resume content, not someone's identity.
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

-- --- profile_assignment ---------------------------------------------------

-- A bidder may read their own assignments — that is how the UI knows what to
-- offer — but only an admin may create or remove one.
drop policy if exists profile_assignment_select on profile_assignment;
create policy profile_assignment_select on profile_assignment
  for select using (
    team_id = app_team_id() and (is_admin() or user_id = auth.uid())
  );

drop policy if exists profile_assignment_insert on profile_assignment;
create policy profile_assignment_insert on profile_assignment
  for insert with check (
    team_id = app_team_id() and is_admin() and assigned_by = auth.uid()
  );

drop policy if exists profile_assignment_delete on profile_assignment;
create policy profile_assignment_delete on profile_assignment
  for delete using (team_id = app_team_id() and is_admin());

-- --- profile_attachment ---------------------------------------------------

drop policy if exists profile_attachment_select on profile_attachment;
create policy profile_attachment_select on profile_attachment
  for select using (team_id = app_team_id() and can_use_profile(profile_id));

drop policy if exists profile_attachment_insert on profile_attachment;
create policy profile_attachment_insert on profile_attachment
  for insert with check (
    team_id = app_team_id()
    and created_by = auth.uid()
    and can_use_profile(profile_id)
  );

drop policy if exists profile_attachment_delete on profile_attachment;
create policy profile_attachment_delete on profile_attachment
  for delete using (team_id = app_team_id() and can_use_profile(profile_id));

-- --- resume_document ------------------------------------------------------
-- Follows the profile: you may write a resume for a candidate you may work
-- with, and change one you wrote.

drop policy if exists resume_document_select on resume_document;
create policy resume_document_select on resume_document
  for select using (team_id = app_team_id() and can_use_profile(profile_id));

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

-- --- blocked_company ------------------------------------------------------
-- Readable by the whole team — a bidder must be able to check the list before
-- applying, which is the only reason it exists. Edited by admins.

drop policy if exists blocked_company_select on blocked_company;
create policy blocked_company_select on blocked_company
  for select using (team_id = app_team_id());

drop policy if exists blocked_company_insert on blocked_company;
create policy blocked_company_insert on blocked_company
  for insert with check (
    team_id = app_team_id() and is_admin() and created_by = auth.uid()
  );

drop policy if exists blocked_company_delete on blocked_company;
create policy blocked_company_delete on blocked_company
  for delete using (team_id = app_team_id() and is_admin());

-- --- application ----------------------------------------------------------
--
-- Sharing a candidate means sharing their history: two people working the same
-- profile need to see where it has already been sent, or they duplicate each
-- other's work. Acting on a record stays with whoever recorded it.
--
-- A resume_builder has no part in the tracker at all.

drop policy if exists application_select on application;
create policy application_select on application
  for select using (
    team_id = app_team_id()
    and not is_builder()
    and (
      is_admin()                      -- admins see the whole team
      or created_by = auth.uid()      -- your own rows, profile or not
      or can_use_profile(profile_id)  -- rows for a profile you're assigned
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

-- --- ssn_access_log -------------------------------------------------------
-- Admins audit; nobody else reveals an SSN, so nobody else has anything to
-- read. Append-only on purpose: no update or delete policy exists, so the trail
-- cannot be edited from the app at all.

drop policy if exists ssn_access_log_select on ssn_access_log;
create policy ssn_access_log_select on ssn_access_log
  for select using (team_id = app_team_id() and is_admin());

drop policy if exists ssn_access_log_insert on ssn_access_log;
create policy ssn_access_log_insert on ssn_access_log
  for insert with check (
    team_id = app_team_id() and actor_id = auth.uid()
  );

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
