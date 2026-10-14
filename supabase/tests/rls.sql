\set ON_ERROR_STOP on
\pset pager off

-- Supabase grants these to `authenticated` by default; the throwaway cluster
-- doesn't, so RLS would never even be reached without them.
--
-- Functions are deliberately *not* granted here. supabase-stub.sql sets the
-- same default privileges Supabase does, so each function arrives with
-- EXECUTE for anon, authenticated and service_role by name, and the schema's
-- own revokes are what decide the rest. A blanket grant here would re-open
-- reveal_ssn and make section 9c's grant checks meaningless.
grant usage on schema public to authenticated;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
grant all on all tables in schema public to authenticated;

-- ---------------------------------------------------------------- fixtures
-- Team A: subadmin a, bidders b1 and b2.
-- Team C: subadmin c, bidder b3.
-- A super admin, s, who reviews every team and belongs to none.

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin_a@example.com'),
  ('00000000-0000-0000-0000-0000000000b1', 'b1@example.com'),
  ('00000000-0000-0000-0000-0000000000b2', 'b2@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'admin_c@example.com'),
  ('00000000-0000-0000-0000-0000000000b3', 'b3@example.com'),
  ('00000000-0000-0000-0000-00000000005a', 'super@example.com');

-- The signup trigger already made the app_user rows; set up the hierarchy.
update app_user set role = 'subadmin'
 where id in ('00000000-0000-0000-0000-00000000000a',
              '00000000-0000-0000-0000-00000000000c');
update app_user set role = 'bidder', created_by_id = '00000000-0000-0000-0000-00000000000a'
 where id in ('00000000-0000-0000-0000-0000000000b1',
              '00000000-0000-0000-0000-0000000000b2');
update app_user set role = 'bidder', created_by_id = '00000000-0000-0000-0000-00000000000c'
 where id = '00000000-0000-0000-0000-0000000000b3';
update app_user set role = 'super_admin'
 where id = '00000000-0000-0000-0000-00000000005a';

\echo ''
\echo '=== 1. app_team_id() resolves per role ==='
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000a';
select 'admin_a team' as who, app_team_id() = '00000000-0000-0000-0000-00000000000a' as expect_true;
set test.uid = '00000000-0000-0000-0000-0000000000b1';
select 'bidder b1 team' as who, app_team_id() = '00000000-0000-0000-0000-00000000000a' as expect_true;
set test.uid = '00000000-0000-0000-0000-00000000005a';
select 'super has no team' as who, app_team_id() is null as expect_true;
reset role;

\echo ''
\echo '=== 2. subadmin a assigns a profile; bidder b1 records against it ==='
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000a';
insert into candidate_profile (id, full_name, email, profile, team_id, created_by)
values ('00000000-0000-0000-0000-0000000000f0', 'First Candidate', 'first@example.com',
        '{"fullName":"First","contact":{"email":"first@example.com","links":[]},"employments":[],"education":[]}'::jsonb,
        app_team_id(), auth.uid());
insert into profile_assignment (profile_id, user_id, team_id, assigned_by)
values ('00000000-0000-0000-0000-0000000000f0',
        '00000000-0000-0000-0000-0000000000b1', app_team_id(), auth.uid());

set test.uid = '00000000-0000-0000-0000-0000000000b1';
insert into application (title, company, job_url, profile_id, team_id, created_by)
values ('Frontend Eng', 'Acme', 'https://example.com/1',
        '00000000-0000-0000-0000-0000000000f0', app_team_id(), auth.uid());
select 'b1 sees own' as check, count(*) = 1 as expect_true from application;
reset role;

\echo ''
\echo '=== 3. teammate b2 must NOT see b1 row; admin_a must ==='
set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000000b2';
select 'b2 sees teammate row' as check, count(*) = 0 as expect_true from application;
set test.uid = '00000000-0000-0000-0000-00000000000a';
select 'admin_a sees team row' as check, count(*) = 1 as expect_true from application;
reset role;

\echo ''
\echo '=== 4. other team (admin_c) sees nothing ==='
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000c';
select 'admin_c isolated' as check, count(*) = 0 as expect_true from application;
select 'admin_c sees no team A profile' as check, count(*) = 0 as expect_true
  from candidate_profile;
reset role;

\echo ''
\echo '=== 5. b1 cannot insert into another team (WITH CHECK) ==='
set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000000b1';
do $$
begin
  insert into application (title, company, job_url, profile_id, team_id, created_by)
  values ('Sneaky', 'Evil', 'https://example.com/2',
          '00000000-0000-0000-0000-0000000000f0',
          '00000000-0000-0000-0000-00000000000c', auth.uid());
  raise exception 'FAIL: cross-team insert was allowed';
exception
  when insufficient_privilege then
    raise notice 'PASS: cross-team insert rejected';
end
$$;
reset role;

\echo ''
\echo '=== 6. b1 cannot forge created_by as a teammate ==='
set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000000b1';
do $$
begin
  insert into application (title, company, job_url, profile_id, team_id, created_by)
  -- Not Acme: that company is in its cooldown for this profile, and the
  -- trigger would refuse it before the policy got the chance.
  values ('Forged', 'Umbrella', 'https://example.com/3',
          '00000000-0000-0000-0000-0000000000f0',
          app_team_id(), '00000000-0000-0000-0000-0000000000b2');
  raise exception 'FAIL: forged created_by was allowed';
exception
  when insufficient_privilege then
    raise notice 'PASS: forged created_by rejected';
end
$$;
reset role;

\echo ''
\echo '=== 6b. a bidder records only for a profile assigned to them ==='
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000a';
insert into candidate_profile (id, full_name, email, profile, team_id, created_by)
values ('00000000-0000-0000-0000-0000000000fa', 'Unassigned Candidate', 'un@example.com',
        '{"fullName":"Un","contact":{"email":"un@example.com","links":[]},"employments":[],"education":[]}'::jsonb,
        app_team_id(), auth.uid());

set test.uid = '00000000-0000-0000-0000-0000000000b1';
do $$
begin
  insert into application (title, company, job_url, profile_id, team_id, created_by)
  values ('Not mine', 'Hooli', 'https://example.com/h1',
          '00000000-0000-0000-0000-0000000000fa', app_team_id(), auth.uid());
  raise exception 'FAIL: bidder recorded against an unassigned profile';
exception
  when insufficient_privilege then
    raise notice 'PASS: unassigned profile refused';
end
$$;

-- "No profile" must not be a way around the rule.
do $$
begin
  insert into application (title, company, job_url, team_id, created_by)
  values ('No profile', 'Hooli', 'https://example.com/h2', app_team_id(), auth.uid());
  raise exception 'FAIL: bidder recorded an application with no profile';
exception
  when insufficient_privilege then
    raise notice 'PASS: profile-less application refused for a bidder';
end
$$;
reset role;

\echo ''
\echo '=== 7. an account cannot change its own role or team ==='
-- There is no update policy on app_user any more, so both of these match
-- nothing. The second was the real hole: created_by_id *is* a bidder's team,
-- and the old self-update policy pinned only id and role.
set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000000b1';
do $$
begin
  update app_user set role = 'subadmin' where id = auth.uid();
  if found then
    raise exception 'FAIL: self-promotion was allowed';
  end if;
  raise notice 'PASS: self-promotion matched no rows';
exception
  when insufficient_privilege then
    raise notice 'PASS: self-promotion rejected by policy';
end
$$;

do $$
begin
  update app_user set created_by_id = '00000000-0000-0000-0000-00000000000c'
   where id = auth.uid();
  if found then
    raise exception 'FAIL: a bidder moved themselves into another team';
  end if;
  raise notice 'PASS: self-transfer matched no rows';
exception
  when insufficient_privilege then
    raise notice 'PASS: self-transfer rejected by policy';
end
$$;

do $$
begin
  update app_user set name = 'Renamed' where id = auth.uid();
  if found then
    raise exception 'FAIL: app_user is still writable through the API';
  end if;
  raise notice 'PASS: app_user has no update path from a session';
end
$$;

select 'b1 is still on team A' as check,
       app_team_id() = '00000000-0000-0000-0000-00000000000a' as expect_true;
reset role;

\echo ''
\echo '=== 7b. a self-registered stranger has no team and reaches nothing ==='
insert into auth.users (id, email)
  values ('00000000-0000-0000-0000-0000000000aa', 'stranger@example.com');
set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000000aa';
select 'stranger has no team' as check, app_team_id() is null as expect_true;
select 'stranger sees no profiles' as check, count(*) = 0 as expect_true
  from candidate_profile;
select 'stranger sees no applications' as check, count(*) = 0 as expect_true
  from application;
select 'stranger sees no other accounts' as check, count(*) = 1 as expect_true
  from app_user;
-- Acme on purpose: b1 applied there for this profile today. The refusal must
-- come from the policy, not from the cooldown trigger, whose message would
-- hand team A's history to someone outside it.
do $$
begin
  insert into application (title, company, job_url, profile_id, team_id, created_by)
  values ('Gatecrash', 'Acme', 'https://example.com/gc',
          '00000000-0000-0000-0000-0000000000f0',
          '00000000-0000-0000-0000-00000000000a', auth.uid());
  raise exception 'FAIL: a teamless account wrote into team A';
exception
  when insufficient_privilege then
    raise notice 'PASS: teamless account cannot write';
end
$$;
reset role;

\echo ''
\echo '=== 8. super_admin reviews every team ==='
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000005a';

-- Still null, deliberately. There is no single team id that could stand for
-- "all of them", so the reach comes from in_team() letting a super admin past
-- the team test rather than from inventing a team for them.
select 'super team is still null' as check, app_team_id() is null as expect_true;
select 'in_team() admits a super admin' as check,
       in_team('00000000-0000-0000-0000-00000000000a') as expect_true;
select 'in_own_team() does not' as check,
       in_own_team('00000000-0000-0000-0000-00000000000a') = false as expect_true;

select 'super sees team A''s application' as check, count(*) = 1 as expect_true
  from application where team_id = '00000000-0000-0000-0000-00000000000a';
select 'super sees team A''s profiles' as check, count(*) = 2 as expect_true
  from candidate_profile where team_id = '00000000-0000-0000-0000-00000000000a';
select 'super sees every account' as check, count(*) >= 6 as expect_true
  from app_user;
reset role;

-- Team C records one of its own, so there are two teams to see across. A
-- subadmin may still record without a profile.
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000c';
insert into application (title, company, job_url, team_id, created_by)
values ('Team C row', 'Soylent', 'https://example.com/c1',
        app_team_id(), auth.uid());
reset role;

set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000005a';
select 'super sees both teams' as check,
       count(distinct team_id) >= 2 as expect_true from application;
reset role;

\echo ''
\echo '=== 8a. ...and changes none of their records, except profiles ==='
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000005a';

do $$
begin
  insert into application (title, company, job_url, profile_id, team_id, created_by)
  values ('Review only', 'Acme', 'https://example.com/ro',
          '00000000-0000-0000-0000-0000000000f0',
          '00000000-0000-0000-0000-00000000000a', auth.uid());
  raise exception 'FAIL: a super admin recorded an application';
exception
  when insufficient_privilege then
    raise notice 'PASS: super admin cannot record applications';
end $$;

update application set notes = 'edited by the platform owner'
 where team_id = '00000000-0000-0000-0000-00000000000a';
select 'super cannot edit an application' as check, count(*) = 0 as expect_true
  from application where notes = 'edited by the platform owner';

delete from application where team_id = '00000000-0000-0000-0000-00000000000a';
select 'super cannot delete an application' as check, count(*) = 1 as expect_true
  from application where team_id = '00000000-0000-0000-0000-00000000000a';

do $$
begin
  insert into candidate_profile (full_name, profile, team_id, created_by)
  values ('Planted', '{}'::jsonb, '00000000-0000-0000-0000-00000000000a', auth.uid());
  raise exception 'FAIL: a super admin created a profile';
exception
  when insufficient_privilege then
    raise notice 'PASS: super admin cannot create profiles';
end $$;

-- Profiles are the exception: the super admin corrects and removes them in
-- any team.
update candidate_profile set full_name = 'Rewritten'
 where id = '00000000-0000-0000-0000-0000000000f0';
select 'super can edit any team''s profile' as check,
       full_name = 'Rewritten' as expect_true
  from candidate_profile where id = '00000000-0000-0000-0000-0000000000f0';
update candidate_profile set full_name = 'First Candidate'
 where id = '00000000-0000-0000-0000-0000000000f0';

-- ...but not move one by rewriting team_id: that would leave its
-- applications behind, and the cooldown blind.
do $$
begin
  update candidate_profile set team_id = '00000000-0000-0000-0000-00000000000c'
   where id = '00000000-0000-0000-0000-0000000000f0';
  raise exception 'FAIL: a profile was moved without its history';
exception
  when insufficient_privilege then
    raise notice 'PASS: team_id only changes through the hand-over';
end $$;

insert into profile_attachment (id, profile_id, label, file_key, file_url, team_id, created_by)
values ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000000f0',
        'Reviewed', 'key-s', 'https://files.example.com/s',
        '00000000-0000-0000-0000-00000000000a', auth.uid());
select 'super can attach a file to any profile' as check, count(*) = 1 as expect_true
  from profile_attachment where id = '00000000-0000-0000-0000-0000000005a1';
delete from profile_attachment where id = '00000000-0000-0000-0000-0000000005a1';
select 'and remove it' as check, count(*) = 0 as expect_true
  from profile_attachment where id = '00000000-0000-0000-0000-0000000005a1';
reset role;

set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000c';
insert into candidate_profile (id, full_name, profile, team_id, created_by)
values ('00000000-0000-0000-0000-0000000000fe', 'Short-lived', '{}'::jsonb,
        app_team_id(), auth.uid());
set test.uid = '00000000-0000-0000-0000-00000000005a';
delete from candidate_profile where id = '00000000-0000-0000-0000-0000000000fe';
select 'super can delete any team''s profile' as check, count(*) = 0 as expect_true
  from candidate_profile where id = '00000000-0000-0000-0000-0000000000fe';

do $$
begin
  insert into profile_assignment (profile_id, user_id, team_id, assigned_by)
  values ('00000000-0000-0000-0000-0000000000fa',
          '00000000-0000-0000-0000-0000000000b2',
          '00000000-0000-0000-0000-00000000000a', auth.uid());
  raise exception 'FAIL: a super admin assigned a profile';
exception
  when insufficient_privilege then
    raise notice 'PASS: super admin cannot assign profiles';
end $$;

do $$
begin
  insert into blocked_company (name, normalized_name, team_id, created_by)
  values ('Planted', 'planted', '00000000-0000-0000-0000-00000000000a', auth.uid());
  raise exception 'FAIL: a super admin edited a blocklist';
exception
  when insufficient_privilege then
    raise notice 'PASS: super admin cannot edit the blocklist';
end $$;

do $$
begin
  insert into resume_document (title, profile_id, content, team_id, created_by)
  values ('Planted', '00000000-0000-0000-0000-0000000000f0', '{}'::jsonb,
          '00000000-0000-0000-0000-00000000000a', auth.uid());
  raise exception 'FAIL: a super admin wrote a resume';
exception
  when insufficient_privilege then
    raise notice 'PASS: super admin cannot write resumes';
end $$;
reset role;

\echo ''
\echo '=== 8b. a subadmin is confined to its own team ==='
-- The counterpart assertion: widening the top must not have widened the
-- middle. If in_team() were wrong this is what would catch it.
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000a';
select 'subadmin sees only its own team' as check,
       count(*) = 0 as expect_true
  from application where team_id = '00000000-0000-0000-0000-00000000000c';
select 'subadmin sees no other subadmin' as check, count(*) = 0 as expect_true
  from app_user where id = '00000000-0000-0000-0000-00000000000c';
select 'subadmin sees no other team''s bidder' as check, count(*) = 0 as expect_true
  from app_user where id = '00000000-0000-0000-0000-0000000000b3';
select 'subadmin sees its own bidders' as check, count(*) = 2 as expect_true
  from app_user where created_by_id = auth.uid();
do $$
begin
  update candidate_profile set team_id = '00000000-0000-0000-0000-00000000000c'
   where id = '00000000-0000-0000-0000-0000000000f0';
  raise exception 'FAIL: a subadmin moved a profile out of their team';
exception
  when insufficient_privilege then
    raise notice 'PASS: a subadmin cannot move a profile by update';
end $$;
reset role;

\echo ''
\echo '=== 9a. profiles are invisible to a bidder until assigned ==='
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000a';
insert into candidate_profile (id, full_name, email, profile, team_id, created_by)
values ('00000000-0000-0000-0000-0000000000f1', 'Jane Doe', 'jane@example.com',
        '{"fullName":"Jane Doe","contact":{"email":"jane@example.com","links":[]},"employments":[],"education":[]}'::jsonb,
        app_team_id(), auth.uid());
select 'admin sees profile' as check, count(*) = 1 as expect_true
  from candidate_profile where id = '00000000-0000-0000-0000-0000000000f1';

set test.uid = '00000000-0000-0000-0000-0000000000b1';
select 'unassigned bidder cannot see it' as check, count(*) = 0 as expect_true
  from candidate_profile where id = '00000000-0000-0000-0000-0000000000f1';
select 'bidder sees only what is assigned' as check, count(*) = 1 as expect_true
  from candidate_profile;

set test.uid = '00000000-0000-0000-0000-00000000000a';
insert into profile_assignment (profile_id, user_id, team_id, assigned_by)
values ('00000000-0000-0000-0000-0000000000f1',
        '00000000-0000-0000-0000-0000000000b1', app_team_id(), auth.uid());

set test.uid = '00000000-0000-0000-0000-0000000000b1';
select 'assigned bidder sees it' as check, count(*) = 1 as expect_true
  from candidate_profile where id = '00000000-0000-0000-0000-0000000000f1';
set test.uid = '00000000-0000-0000-0000-0000000000b2';
select 'other bidder still blind' as check, count(*) = 0 as expect_true
  from candidate_profile;
reset role;

\echo ''
\echo '=== 9b. a bidder''s view of a profile is read-only ==='
set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000000b1';
do $$
begin
  insert into profile_assignment (profile_id, user_id, team_id, assigned_by)
  values ('00000000-0000-0000-0000-0000000000f1',
          '00000000-0000-0000-0000-0000000000b2', app_team_id(), auth.uid());
  raise exception 'FAIL: bidder assigned a profile';
exception
  when insufficient_privilege then
    raise notice 'PASS: bidder cannot assign profiles';
end
$$;

do $$
begin
  insert into candidate_profile (full_name, profile, team_id, created_by)
  values ('Own Candidate', '{}'::jsonb, app_team_id(), auth.uid());
  raise exception 'FAIL: bidder created a profile';
exception
  when insufficient_privilege then
    raise notice 'PASS: bidder cannot create profiles';
end
$$;

update candidate_profile set full_name = 'Hacked'
 where id = '00000000-0000-0000-0000-0000000000f1';
select 'bidder edit blocked' as check,
       (select full_name from candidate_profile
         where id = '00000000-0000-0000-0000-0000000000f1') = 'Jane Doe' as expect_true;

delete from candidate_profile where id = '00000000-0000-0000-0000-0000000000f1';
select 'bidder delete blocked' as check, count(*) = 1 as expect_true
  from candidate_profile where id = '00000000-0000-0000-0000-0000000000f1';
reset role;

-- Attachments are part of the profile: visible to the assignee, not theirs to
-- add or remove.
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000a';
insert into profile_attachment (profile_id, label, file_key, file_url, team_id, created_by)
values ('00000000-0000-0000-0000-0000000000f1', 'Photo', 'key-1',
        'https://files.example.com/1', app_team_id(), auth.uid());

set test.uid = '00000000-0000-0000-0000-0000000000b1';
select 'assignee sees the attachment' as check, count(*) = 1 as expect_true
  from profile_attachment where profile_id = '00000000-0000-0000-0000-0000000000f1';
do $$
begin
  insert into profile_attachment (profile_id, label, file_key, file_url, team_id, created_by)
  values ('00000000-0000-0000-0000-0000000000f1', 'Mine', 'key-2',
          'https://files.example.com/2', app_team_id(), auth.uid());
  raise exception 'FAIL: bidder attached a file to a profile';
exception
  when insufficient_privilege then
    raise notice 'PASS: bidder cannot add attachments';
end
$$;
delete from profile_attachment where profile_id = '00000000-0000-0000-0000-0000000000f1';
select 'bidder cannot remove an attachment' as check, count(*) = 1 as expect_true
  from profile_attachment where profile_id = '00000000-0000-0000-0000-0000000000f1';
reset role;

\echo ''
\echo '=== 9c. assignments stay inside one team ==='
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000c';
insert into candidate_profile (id, full_name, profile, team_id, created_by)
values ('00000000-0000-0000-0000-0000000000fc', 'Team C Candidate', '{}'::jsonb,
        app_team_id(), auth.uid());

set test.uid = '00000000-0000-0000-0000-00000000000a';
do $$
begin
  insert into profile_assignment (profile_id, user_id, team_id, assigned_by)
  values ('00000000-0000-0000-0000-0000000000f1',
          '00000000-0000-0000-0000-0000000000b3', app_team_id(), auth.uid());
  raise exception 'FAIL: a profile was assigned to another team''s bidder';
exception
  when insufficient_privilege then
    raise notice 'PASS: cannot assign to another team''s bidder';
end
$$;

do $$
begin
  insert into profile_assignment (profile_id, user_id, team_id, assigned_by)
  values ('00000000-0000-0000-0000-0000000000fc',
          '00000000-0000-0000-0000-0000000000b1', app_team_id(), auth.uid());
  raise exception 'FAIL: another team''s profile was assigned';
exception
  when insufficient_privilege then
    raise notice 'PASS: cannot assign another team''s profile';
end
$$;

do $$
begin
  insert into profile_assignment (profile_id, user_id, team_id, assigned_by)
  values ('00000000-0000-0000-0000-0000000000f1',
          '00000000-0000-0000-0000-00000000000a', app_team_id(), auth.uid());
  raise exception 'FAIL: a profile was assigned to a subadmin';
exception
  when insufficient_privilege then
    raise notice 'PASS: only bidders take assignments';
end
$$;

do $$
begin
  insert into profile_attachment (profile_id, label, file_key, file_url, team_id, created_by)
  values ('00000000-0000-0000-0000-0000000000fc', 'Cross', 'key-x',
          'https://files.example.com/x', app_team_id(), auth.uid());
  raise exception 'FAIL: attached a file to another team''s profile';
exception
  when insufficient_privilege then
    raise notice 'PASS: attachments must match their profile''s team';
end
$$;
reset role;

\echo ''
\echo '=== 9d. SSN round-trips, and a wrong key yields null not plaintext ==='
-- As the database owner: the crypto helpers are not callable from a session at
-- all (checked below), only by the service role the SSN actions use.
update candidate_profile
   set ssn_encrypted = encrypt_ssn('123-45-6789', 'correct-horse-battery')
 where id = '00000000-0000-0000-0000-0000000000f1';

select 'ciphertext is not plaintext' as check,
       position('123456789' in encode(ssn_encrypted, 'escape')) = 0 as expect_true
  from candidate_profile where id = '00000000-0000-0000-0000-0000000000f1';

select 'right key decrypts, digits only' as check,
       decrypt_ssn(ssn_encrypted, 'correct-horse-battery') = '123456789' as expect_true
  from candidate_profile where id = '00000000-0000-0000-0000-0000000000f1';

select 'wrong key yields null' as check,
       decrypt_ssn(ssn_encrypted, 'wrong-key') is null as expect_true
  from candidate_profile where id = '00000000-0000-0000-0000-0000000000f1';

\echo ''
\echo '=== 9e. no browser session can call the SSN functions ==='
-- Revoking from public is not enough on Supabase, whose default privileges
-- grant each API role by name. These are the grants that remain.
select fn as check,
       not has_function_privilege('authenticated', fn, 'execute')
       and not has_function_privilege('anon', fn, 'execute') as expect_true
  from unnest(array[
    'public.reveal_ssn(uuid, text)',
    'public.store_ssn(uuid, text, text)',
    'public.encrypt_ssn(text, text)',
    'public.decrypt_ssn(bytea, text)'
  ]) as fn;

select 'service role can still reveal' as check,
       has_function_privilege('service_role', 'public.reveal_ssn(uuid, text)', 'execute')
       and has_function_privilege('service_role', 'public.store_ssn(uuid, text, text)', 'execute')
       as expect_true;

select fn || ' is not anon''s' as check,
       has_function_privilege('authenticated', fn, 'execute')
       and not has_function_privilege('anon', fn, 'execute') as expect_true
  from unnest(array[
    'public.assign_profile_to_team(uuid, uuid)',
    'public.transfer_team(uuid, uuid)'
  ]) as fn;

\echo ''
\echo '=== 9f. bidder cannot reach the SSN ciphertext at all ==='
set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000000b2';
select 'unassigned bidder gets no row' as check, count(*) = 0 as expect_true
  from candidate_profile where id = '00000000-0000-0000-0000-0000000000f1';
reset role;

\echo ''
\echo '=== 9g. the SSN access log is append-only, and the subadmin''s to write ==='
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000a';
insert into ssn_access_log (profile_id, actor_id, team_id)
values ('00000000-0000-0000-0000-0000000000f1', auth.uid(), app_team_id());
select 'log entry recorded' as check, count(*) = 1 as expect_true from ssn_access_log;
delete from ssn_access_log;
select 'log cannot be deleted' as check, count(*) = 1 as expect_true from ssn_access_log;
update ssn_access_log set actor_id = null;
select 'log cannot be edited' as check,
       (select count(*) from ssn_access_log where actor_id is not null) = 1 as expect_true;

set test.uid = '00000000-0000-0000-0000-0000000000b1';
do $$
begin
  insert into ssn_access_log (profile_id, actor_id, team_id)
  values ('00000000-0000-0000-0000-0000000000f1', auth.uid(), app_team_id());
  raise exception 'FAIL: a bidder wrote to the SSN log';
exception
  when insufficient_privilege then
    raise notice 'PASS: bidder cannot write the SSN log';
end
$$;
select 'bidder cannot read the log' as check, count(*) = 0 as expect_true
  from ssn_access_log;

set test.uid = '00000000-0000-0000-0000-00000000005a';
select 'super admin audits every team' as check, count(*) = 1 as expect_true
  from ssn_access_log;
reset role;

\echo ''
\echo '=== 10a. sharing a profile shares its application history ==='
-- b2 is assigned the same profile as b1, then b1 records against it.
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000a';
insert into profile_assignment (profile_id, user_id, team_id, assigned_by)
values ('00000000-0000-0000-0000-0000000000f1',
        '00000000-0000-0000-0000-0000000000b2', app_team_id(), auth.uid());

set test.uid = '00000000-0000-0000-0000-0000000000b1';
insert into application (id, title, company, job_url, profile_id, team_id, created_by)
values ('00000000-0000-0000-0000-00000000a001', 'Backend Eng', 'Globex',
        'https://example.com/g1', '00000000-0000-0000-0000-0000000000f1',
        app_team_id(), auth.uid());

set test.uid = '00000000-0000-0000-0000-0000000000b2';
select 'teammate sees shared-profile row' as check, count(*) = 1 as expect_true
  from application where id = '00000000-0000-0000-0000-00000000a001';
reset role;

\echo ''
\echo '=== 10b. ...but cannot change or delete it ==='
set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000000b2';
update application set title = 'Hijacked'
 where id = '00000000-0000-0000-0000-00000000a001';
select 'teammate edit blocked' as check,
       (select title from application
         where id = '00000000-0000-0000-0000-00000000a001') = 'Backend Eng' as expect_true;
delete from application where id = '00000000-0000-0000-0000-00000000a001';
select 'teammate delete blocked' as check, count(*) = 1 as expect_true
  from application where id = '00000000-0000-0000-0000-00000000a001';
reset role;

\echo ''
\echo '=== 10c. an unshared profile stays private ==='
-- A second profile, assigned to b1 only.
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000a';
insert into candidate_profile (id, full_name, email, profile, team_id, created_by)
values ('00000000-0000-0000-0000-0000000000f2', 'Solo Candidate', 'solo@example.com',
        '{"fullName":"Solo","contact":{"email":"solo@example.com","links":[]},"employments":[],"education":[]}'::jsonb,
        app_team_id(), auth.uid());
insert into profile_assignment (profile_id, user_id, team_id, assigned_by)
values ('00000000-0000-0000-0000-0000000000f2',
        '00000000-0000-0000-0000-0000000000b1', app_team_id(), auth.uid());

set test.uid = '00000000-0000-0000-0000-0000000000b1';
insert into application (id, title, company, job_url, profile_id, team_id, created_by)
values ('00000000-0000-0000-0000-00000000a002', 'Solo Role', 'Initech',
        'https://example.com/i1', '00000000-0000-0000-0000-0000000000f2',
        app_team_id(), auth.uid());

set test.uid = '00000000-0000-0000-0000-0000000000b2';
select 'unshared profile row hidden' as check, count(*) = 0 as expect_true
  from application where id = '00000000-0000-0000-0000-00000000a002';
reset role;

\echo ''
\echo '=== 10d. 14-day cooldown blocks a repeat for the same profile ==='
set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000000b2';
do $$
begin
  -- Same profile, same company, different person and different role.
  insert into application (title, company, job_url, profile_id, team_id, created_by)
  values ('Platform Eng', 'globex', 'https://example.com/g2',
          '00000000-0000-0000-0000-0000000000f1', app_team_id(), auth.uid());
  raise exception 'FAIL: duplicate within the window was allowed';
exception
  when check_violation then
    raise notice 'PASS: repeat inside 14 days rejected';
end
$$;
reset role;

\echo ''
\echo '=== 10e. ...matches on normalised company name ==='
set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000000b1';
do $$
begin
  insert into application (title, company, job_url, profile_id, team_id, created_by)
  values ('Any', 'Globex, Inc.', 'https://example.com/g3',
          '00000000-0000-0000-0000-0000000000f1', app_team_id(), auth.uid());
  raise exception 'FAIL: punctuation walked around the cooldown';
exception
  when check_violation then
    raise notice 'PASS: "Globex, Inc." matched "Globex"';
end
$$;
reset role;

\echo ''
\echo '=== 10f. a different profile, and an expired window, are both fine ==='
set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000000b1';
-- Same company, different profile: allowed.
insert into application (title, company, job_url, profile_id, team_id, created_by)
values ('Other Candidate', 'Globex', 'https://example.com/g4',
        '00000000-0000-0000-0000-0000000000f2', app_team_id(), auth.uid());
select 'other profile allowed' as check, count(*) = 1 as expect_true
  from application
 where company = 'Globex' and profile_id = '00000000-0000-0000-0000-0000000000f2';

-- Age the original past the window, then the same company reopens.
reset role;
update application set applied_at = now() - interval '15 days'
 where id = '00000000-0000-0000-0000-00000000a001';

set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000000b1';
insert into application (title, company, job_url, profile_id, team_id, created_by)
values ('Reapply', 'Globex', 'https://example.com/g5',
        '00000000-0000-0000-0000-0000000000f1', app_team_id(), auth.uid());
select 'reapply after 14 days allowed' as check, count(*) = 1 as expect_true
  from application where title = 'Reapply';
reset role;

\echo ''
\echo '=== 10g. archiving is an update, and does not lift the cooldown ==='
set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000000b1';

-- b1 archives their own row. No new policy: archiving is an ordinary update,
-- so it inherits "your own rows, or any if you're the subadmin".
update application set archived_at = now() where id = '00000000-0000-0000-0000-00000000a001';
select 'owner can archive' as check, archived_at is not null as expect_true
  from application where id = '00000000-0000-0000-0000-00000000a001';

-- ...and the archived row still blocks a repeat. Archiving tidies a view; it
-- does not retract the application.
do $$
begin
  insert into application (title, company, job_url, applied_at, profile_id, team_id, created_by)
  values ('Sneak Past', 'Globex', 'https://example.com/g6',
          (select applied_at from application where id = '00000000-0000-0000-0000-00000000a001'),
          '00000000-0000-0000-0000-0000000000f1', app_team_id(), auth.uid());
  raise exception 'FAIL: archiving walked around the cooldown';
exception
  when check_violation then
    raise notice 'PASS: archived row still holds the company closed';
end
$$;

update application set archived_at = null where id = '00000000-0000-0000-0000-00000000a001';
select 'owner can restore' as check, archived_at is null as expect_true
  from application where id = '00000000-0000-0000-0000-00000000a001';
reset role;

-- A teammate who only sees the row through a shared profile still cannot
-- archive it — same check that already refuses their edits.
set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000000b2';
update application set archived_at = now() where id = '00000000-0000-0000-0000-00000000a001';
select 'teammate cannot archive' as check, count(*) = 0 as expect_true
  from application where id = '00000000-0000-0000-0000-00000000a001' and archived_at is not null;
reset role;

\echo ''
\echo '=== 11. billing status is the subadmin''s ==='
set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000000b1';

do $$
begin
  update application set billing = 'billed'
   where id = '00000000-0000-0000-0000-00000000a001';
  raise exception 'FAIL: bidder changed billing';
exception
  when insufficient_privilege then
    raise notice 'PASS: bidder cannot change billing';
end
$$;

do $$
begin
  insert into application (title, company, job_url, profile_id, billing, team_id, created_by)
  values ('Presumptuous', 'Umbrella', 'https://example.com/u1',
          '00000000-0000-0000-0000-0000000000f2', 'billed', app_team_id(), auth.uid());
  raise exception 'FAIL: bidder inserted a billed application';
exception
  when insufficient_privilege then
    raise notice 'PASS: bidder cannot insert non-default billing';
end
$$;

-- A bidder editing their own row without touching billing must still work.
update application set title = 'Renamed by owner'
 where id = '00000000-0000-0000-0000-00000000a001';
select 'bidder can still edit own row' as check,
       (select title from application
         where id = '00000000-0000-0000-0000-00000000a001') = 'Renamed by owner' as expect_true;

-- And the subadmin may set it.
set test.uid = '00000000-0000-0000-0000-00000000000a';
update application set billing = 'billed'
 where id = '00000000-0000-0000-0000-00000000a001';
select 'subadmin can change billing' as check,
       (select billing from application
         where id = '00000000-0000-0000-0000-00000000a001') = 'billed' as expect_true;
reset role;

\echo ''
\echo '=== 12. a bidder builds resumes for assigned profiles only ==='
set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000000b1';
insert into resume_document (id, title, profile_id, content, team_id, created_by)
values ('00000000-0000-0000-0000-0000000000d1', 'Jane — Backend',
        '00000000-0000-0000-0000-0000000000f1',
        '{"targetTitle":"Backend","summary":"x","skills":[],"experiences":[]}'::jsonb,
        app_team_id(), auth.uid());
select 'bidder sees own resume' as check, count(*) = 1 as expect_true
  from resume_document where id = '00000000-0000-0000-0000-0000000000d1';

do $$
begin
  insert into resume_document (title, profile_id, content, team_id, created_by)
  values ('Not mine', '00000000-0000-0000-0000-0000000000fa', '{}'::jsonb,
          app_team_id(), auth.uid());
  raise exception 'FAIL: bidder wrote a resume for an unassigned profile';
exception
  when insufficient_privilege then
    raise notice 'PASS: resume for an unassigned profile refused';
end
$$;

do $$
begin
  update resume_document set profile_id = '00000000-0000-0000-0000-0000000000fa'
   where id = '00000000-0000-0000-0000-0000000000d1';
  raise exception 'FAIL: a resume was re-pointed at an unassigned profile';
exception
  when insufficient_privilege then
    raise notice 'PASS: cannot move a resume to an unassigned profile';
end
$$;

-- A teammate on the same profile can read it, but it is not theirs to change.
set test.uid = '00000000-0000-0000-0000-0000000000b2';
select 'co-assignee sees the resume' as check, count(*) = 1 as expect_true
  from resume_document where id = '00000000-0000-0000-0000-0000000000d1';
update resume_document set title = 'Taken over'
 where id = '00000000-0000-0000-0000-0000000000d1';
select 'co-assignee cannot edit it' as check,
       (select title from resume_document
         where id = '00000000-0000-0000-0000-0000000000d1') = 'Jane — Backend' as expect_true;

-- The super admin reviews it; the subadmin may edit it.
set test.uid = '00000000-0000-0000-0000-00000000005a';
select 'super sees the resume' as check, count(*) = 1 as expect_true
  from resume_document where id = '00000000-0000-0000-0000-0000000000d1';
update resume_document set title = 'Reviewed'
 where id = '00000000-0000-0000-0000-0000000000d1';
select 'super cannot edit it' as check,
       (select title from resume_document
         where id = '00000000-0000-0000-0000-0000000000d1') = 'Jane — Backend' as expect_true;

set test.uid = '00000000-0000-0000-0000-00000000000a';
update resume_document set title = 'Jane — Backend (edited)'
 where id = '00000000-0000-0000-0000-0000000000d1';
select 'subadmin can edit it' as check,
       (select title from resume_document
         where id = '00000000-0000-0000-0000-0000000000d1') = 'Jane — Backend (edited)' as expect_true;
reset role;

\echo ''
\echo '=== 12b. unassigning takes the profile away, history stays visible ==='
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000a';
delete from profile_assignment
 where profile_id = '00000000-0000-0000-0000-0000000000f2'
   and user_id = '00000000-0000-0000-0000-0000000000b1';

set test.uid = '00000000-0000-0000-0000-0000000000b1';
select 'unassigned profile is gone' as check, count(*) = 0 as expect_true
  from candidate_profile where id = '00000000-0000-0000-0000-0000000000f2';
select 'own application still visible' as check, count(*) = 1 as expect_true
  from application where id = '00000000-0000-0000-0000-00000000a002';
do $$
begin
  update application set title = 'Still working it'
   where id = '00000000-0000-0000-0000-00000000a002';
  raise exception 'FAIL: bidder edited an application for an unassigned profile';
exception
  when insufficient_privilege then
    raise notice 'PASS: unassigned profile''s applications are read-only';
end
$$;

-- Put it back for the sections that follow.
set test.uid = '00000000-0000-0000-0000-00000000000a';
insert into profile_assignment (profile_id, user_id, team_id, assigned_by)
values ('00000000-0000-0000-0000-0000000000f2',
        '00000000-0000-0000-0000-0000000000b1', app_team_id(), auth.uid());
reset role;

\echo ''
\echo '=== 13. a remaining resume_builder becomes a bidder, keeping their profiles ==='
-- A database that still has one, as before this change: the constraint is
-- lifted to plant the row, then part 1 runs again the way it would in the SQL
-- editor.
alter table app_user drop constraint app_user_role_retired;
insert into auth.users (id, email)
  values ('00000000-0000-0000-0000-0000000000e0', 'builder@example.com');
update app_user set role = 'resume_builder',
                    created_by_id = '00000000-0000-0000-0000-00000000000a'
 where id = '00000000-0000-0000-0000-0000000000e0';
insert into candidate_profile (id, full_name, profile, team_id, created_by)
values ('00000000-0000-0000-0000-0000000000e1', 'Builder''s Candidate', '{}'::jsonb,
        '00000000-0000-0000-0000-00000000000a',
        '00000000-0000-0000-0000-0000000000e0');

set client_min_messages = warning;
\o /dev/null
\ir ../schema/01_tables.sql
\o
reset client_min_messages;

select 'former builder is a bidder' as check, role::text = 'bidder' as expect_true
  from app_user where id = '00000000-0000-0000-0000-0000000000e0';
select 'and is assigned what they built' as check, count(*) = 1 as expect_true
  from profile_assignment
 where user_id = '00000000-0000-0000-0000-0000000000e0'
   and profile_id = '00000000-0000-0000-0000-0000000000e1';

set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000000e0';
select 'they still see their candidate' as check, count(*) = 1 as expect_true
  from candidate_profile where id = '00000000-0000-0000-0000-0000000000e1';
reset role;

do $$
begin
  update app_user set role = 'resume_builder'
   where id = '00000000-0000-0000-0000-0000000000e0';
  raise exception 'FAIL: the retired role was accepted';
exception
  when check_violation then
    raise notice 'PASS: resume_builder can no longer be held';
end
$$;

\echo ''
\echo '=== 14. a super admin hands a profile to a subadmin, history and all ==='

set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000a';
insert into candidate_profile (id, team_id, created_by, full_name, profile)
values ('00000000-0000-0000-0000-0000000000f9', app_team_id(), auth.uid(),
        'Moving Candidate', '{}'::jsonb);
insert into application (id, title, company, job_url, profile_id, team_id, created_by)
values ('00000000-0000-0000-0000-00000000a900', 'Moved Role', 'Umbrella',
        'https://example.com/moved', '00000000-0000-0000-0000-0000000000f9',
        app_team_id(), auth.uid());
-- A bidder in the *old* team is assigned to it.
insert into profile_assignment (profile_id, user_id, team_id, assigned_by)
values ('00000000-0000-0000-0000-0000000000f9',
        '00000000-0000-0000-0000-0000000000b1', app_team_id(), auth.uid());
reset role;

-- A subadmin may not hand profiles around, even their own.
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000a';
do $$
begin
  perform assign_profile_to_team(
    '00000000-0000-0000-0000-0000000000f9',
    '00000000-0000-0000-0000-00000000000c');
  raise exception 'FAIL: a subadmin moved a profile between teams';
exception
  when insufficient_privilege then
    raise notice 'PASS: only a super admin can hand a profile over';
end $$;
reset role;

set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000005a';

-- Not to a bidder: a team is a subadmin's id, and handing a profile to a
-- bidder would make a team app_team_id() can never resolve to.
do $$
begin
  perform assign_profile_to_team(
    '00000000-0000-0000-0000-0000000000f9',
    '00000000-0000-0000-0000-0000000000b1');
  raise exception 'FAIL: a profile was handed to a bidder';
exception
  when invalid_parameter_value then
    raise notice 'PASS: profiles can only be handed to a subadmin';
end $$;

-- The real move.
select assign_profile_to_team(
  '00000000-0000-0000-0000-0000000000f9',
  '00000000-0000-0000-0000-00000000000c');
reset role;

set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000005a';
select 'profile moved to the new team' as check,
       team_id = '00000000-0000-0000-0000-00000000000c' as expect_true
  from candidate_profile where id = '00000000-0000-0000-0000-0000000000f9';

-- The point of the whole exercise: history travels, so the cooldown still
-- knows where this candidate has already been sent.
select 'its applications moved too' as check,
       team_id = '00000000-0000-0000-0000-00000000000c' as expect_true
  from application where id = '00000000-0000-0000-0000-00000000a900';

-- The old team's bidder loses it; the new owner re-assigns to their own.
select 'old assignments were dropped' as check, count(*) = 0 as expect_true
  from profile_assignment
 where profile_id = '00000000-0000-0000-0000-0000000000f9';
reset role;

\echo ''
\echo '=== 14b. the new owner sees it; the old one does not ==='
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000c';
select 'new owner sees the profile' as check, count(*) = 1 as expect_true
  from candidate_profile where id = '00000000-0000-0000-0000-0000000000f9';
select 'new owner sees its history' as check, count(*) = 1 as expect_true
  from application where id = '00000000-0000-0000-0000-00000000a900';
reset role;

set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000a';
select 'previous owner no longer sees it' as check, count(*) = 0 as expect_true
  from candidate_profile where id = '00000000-0000-0000-0000-0000000000f9';
select 'nor its history' as check, count(*) = 0 as expect_true
  from application where id = '00000000-0000-0000-0000-00000000a900';
reset role;

\echo ''
\echo '=== 14c. a session with no app_user row cannot hand profiles over ==='

-- A valid JWT whose account has no app_user row: an account that was deleted
-- while signed in, or an auth.users row that never got one.
--
-- Every role predicate answers null for them, and the guard was written
-- `if not is_super_admin()`. `if null` does not branch, so the guard was
-- skipped and the body — SECURITY DEFINER, so RLS does not stop it either —
-- ran. The predicates coalesce to false now; this is what holds that shut.
set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000000de';

select 'no app_user row, so no role' as check, app_role() is null as expect_true;
select 'is_super_admin() is false, not null' as check,
       is_super_admin() = false as expect_true;
select 'is_admin() is false, not null' as check, is_admin() = false as expect_true;
select 'is_subadmin() is false, not null' as check, is_subadmin() = false as expect_true;
select 'in_team() is false, not null' as check,
       in_team('00000000-0000-0000-0000-00000000000c') = false as expect_true;
select 'in_own_team() is false, not null' as check,
       in_own_team('00000000-0000-0000-0000-00000000000c') = false as expect_true;

do $$
begin
  perform assign_profile_to_team(
    '00000000-0000-0000-0000-0000000000f9',
    '00000000-0000-0000-0000-00000000000a');
  raise exception 'FAIL: a session with no app_user row moved a profile';
exception
  when insufficient_privilege then
    raise notice 'PASS: a roleless session is refused the hand-over';
end $$;
reset role;

-- And it really did not move.
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000005a';
select 'the profile stayed where it was' as check,
       team_id = '00000000-0000-0000-0000-00000000000c' as expect_true
  from candidate_profile where id = '00000000-0000-0000-0000-0000000000f9';
reset role;

\echo ''
\echo '=== 15. transferring a team before its subadmin is deleted ==='
-- Team D: subadmin d and bidder b4, with a profile, an assignment, an
-- application, a resume, and a blocklist that overlaps team C's.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000d', 'admin_d@example.com'),
  ('00000000-0000-0000-0000-0000000000b4', 'b4@example.com');
update app_user set role = 'subadmin'
 where id = '00000000-0000-0000-0000-00000000000d';
update app_user set role = 'bidder', created_by_id = '00000000-0000-0000-0000-00000000000d'
 where id = '00000000-0000-0000-0000-0000000000b4';

-- A calendar event the subadmin created, in the calendar's table. Stood in
-- for here so the cross-app branch of transfer_team() runs.
create table calendar_event (
  id uuid primary key default gen_random_uuid(),
  created_by uuid
);
insert into calendar_event (created_by) values ('00000000-0000-0000-0000-00000000000d');

set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000d';
insert into candidate_profile (id, full_name, profile, team_id, created_by)
values ('00000000-0000-0000-0000-0000000000fd', 'Team D Candidate', '{}'::jsonb,
        app_team_id(), auth.uid());
insert into profile_assignment (profile_id, user_id, team_id, assigned_by)
values ('00000000-0000-0000-0000-0000000000fd',
        '00000000-0000-0000-0000-0000000000b4', app_team_id(), auth.uid());
insert into blocked_company (name, normalized_name, team_id, created_by)
values ('Acme', 'acme', app_team_id(), auth.uid()),
       ('Initech', 'initech', app_team_id(), auth.uid());

set test.uid = '00000000-0000-0000-0000-0000000000b4';
insert into application (id, title, company, job_url, profile_id, team_id, created_by)
values ('00000000-0000-0000-0000-00000000ad01', 'D Role', 'Hooli',
        'https://example.com/d1', '00000000-0000-0000-0000-0000000000fd',
        app_team_id(), auth.uid());
insert into resume_document (id, title, profile_id, content, team_id, created_by)
values ('00000000-0000-0000-0000-0000000000dd', 'D resume',
        '00000000-0000-0000-0000-0000000000fd', '{}'::jsonb, app_team_id(), auth.uid());

set test.uid = '00000000-0000-0000-0000-00000000000c';
insert into blocked_company (name, normalized_name, team_id, created_by)
values ('ACME Inc', 'acme', app_team_id(), auth.uid());
reset role;

set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000a';
do $$
begin
  perform transfer_team('00000000-0000-0000-0000-00000000000d',
                        '00000000-0000-0000-0000-00000000000a');
  raise exception 'FAIL: a subadmin took over another team';
exception
  when insufficient_privilege then
    raise notice 'PASS: only a super admin can move a team';
end $$;

set test.uid = '00000000-0000-0000-0000-0000000000de';
do $$
begin
  perform transfer_team('00000000-0000-0000-0000-00000000000d',
                        '00000000-0000-0000-0000-00000000000c');
  raise exception 'FAIL: a roleless session moved a team';
exception
  when insufficient_privilege then
    raise notice 'PASS: a roleless session cannot move a team';
end $$;

set test.uid = '00000000-0000-0000-0000-00000000005a';
do $$
begin
  perform transfer_team('00000000-0000-0000-0000-00000000000d',
                        '00000000-0000-0000-0000-0000000000b3');
  raise exception 'FAIL: a team was handed to a bidder';
exception
  when invalid_parameter_value then
    raise notice 'PASS: a team only moves to a subadmin';
end $$;

do $$
begin
  perform transfer_team('00000000-0000-0000-0000-00000000000d',
                        '00000000-0000-0000-0000-00000000000d');
  raise exception 'FAIL: a team was handed to itself';
exception
  when invalid_parameter_value then
    raise notice 'PASS: a team cannot move to its own subadmin';
end $$;

select transfer_team('00000000-0000-0000-0000-00000000000d',
                     '00000000-0000-0000-0000-00000000000c');
reset role;

-- As the owner, so the counts are the whole table rather than what one
-- caller can see.
select 'nothing is left on team D' as check,
       (select count(*) from candidate_profile  where team_id = '00000000-0000-0000-0000-00000000000d')
     + (select count(*) from application        where team_id = '00000000-0000-0000-0000-00000000000d')
     + (select count(*) from resume_document    where team_id = '00000000-0000-0000-0000-00000000000d')
     + (select count(*) from profile_assignment where team_id = '00000000-0000-0000-0000-00000000000d')
     + (select count(*) from blocked_company    where team_id = '00000000-0000-0000-0000-00000000000d')
     + (select count(*) from app_user where created_by_id = '00000000-0000-0000-0000-00000000000d')
       = 0 as expect_true;
select 'the blocklist merged, one row per company' as check,
       (select count(*) from blocked_company
         where team_id = '00000000-0000-0000-0000-00000000000c'
           and normalized_name = 'acme') = 1
       and (select count(*) from blocked_company
         where team_id = '00000000-0000-0000-0000-00000000000c'
           and normalized_name = 'initech') = 1 as expect_true;
select 'the calendar event changed hands' as check,
       created_by = '00000000-0000-0000-0000-00000000000c' as expect_true
  from calendar_event;

set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000000b4';
select 'the bidder moved with the team' as check,
       app_team_id() = '00000000-0000-0000-0000-00000000000c' as expect_true;
select 'and keeps their assigned profile' as check, count(*) = 1 as expect_true
  from candidate_profile where id = '00000000-0000-0000-0000-0000000000fd';

set test.uid = '00000000-0000-0000-0000-00000000000c';
select 'the inheritor sees the profile' as check, count(*) = 1 as expect_true
  from candidate_profile where id = '00000000-0000-0000-0000-0000000000fd';
select 'and its application' as check, count(*) = 1 as expect_true
  from application where id = '00000000-0000-0000-0000-00000000ad01';
select 'and the bidder' as check, count(*) = 1 as expect_true
  from app_user where id = '00000000-0000-0000-0000-0000000000b4';
reset role;

drop table calendar_event;

-- With the team empty, deleting the subadmin takes nothing with it.
delete from auth.users where id = '00000000-0000-0000-0000-00000000000d';
select 'deleting the emptied subadmin lost nothing' as check, count(*) = 1 as expect_true
  from candidate_profile where id = '00000000-0000-0000-0000-0000000000fd';

\echo ''
\echo '=== 16. blocklist is team-wide readable, edited by the subadmin ==='
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000a';
insert into blocked_company (name, normalized_name, team_id, created_by)
values ('Evil Corp', 'evil corp', app_team_id(), auth.uid());
set test.uid = '00000000-0000-0000-0000-0000000000b1';
select 'bidder reads blocklist' as check, count(*) = 1 as expect_true from blocked_company;
delete from blocked_company;
select 'bidder delete blocked' as check, count(*) = 1 as expect_true from blocked_company;
do $$
begin
  insert into blocked_company (name, normalized_name, team_id, created_by)
  values ('Mine', 'mine', app_team_id(), auth.uid());
  raise exception 'FAIL: bidder added to the blocklist';
exception
  when insufficient_privilege then
    raise notice 'PASS: bidder cannot add to the blocklist';
end
$$;
set test.uid = '00000000-0000-0000-0000-00000000000a';
delete from blocked_company where normalized_name = 'evil corp';
select 'subadmin can remove an entry' as check, count(*) = 0 as expect_true
  from blocked_company;
reset role;
