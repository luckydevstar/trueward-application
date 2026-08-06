\set ON_ERROR_STOP on
\pset pager off

-- Supabase grants these to `authenticated` by default; the throwaway cluster
-- doesn't, so RLS would never even be reached without them.
grant usage on schema public to authenticated;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
grant all on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- ---------------------------------------------------------------- fixtures
-- Two teams. Team A: admin_a with bidders b1 and b2. Team C: admin_c alone.

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin_a@example.com'),
  ('00000000-0000-0000-0000-0000000000b1', 'b1@example.com'),
  ('00000000-0000-0000-0000-0000000000b2', 'b2@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'admin_c@example.com');

-- The signup trigger already made the app_user rows; set up the hierarchy.
update app_user set role = 'admin' where id = '00000000-0000-0000-0000-00000000000a';
update app_user set role = 'admin' where id = '00000000-0000-0000-0000-00000000000c';
update app_user set role = 'bidder', created_by_id = '00000000-0000-0000-0000-00000000000a'
  where id in ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2');

\echo ''
\echo '=== 1. app_team_id() resolves per role ==='
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000a';
select 'admin_a team' as who, app_team_id() = '00000000-0000-0000-0000-00000000000a' as expect_true;
set test.uid = '00000000-0000-0000-0000-0000000000b1';
select 'bidder b1 team' as who, app_team_id() = '00000000-0000-0000-0000-00000000000a' as expect_true;
reset role;

\echo ''
\echo '=== 2. bidder b1 records an application ==='
set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000000b1';
insert into application (title, company, job_url, team_id, created_by)
values ('Frontend Eng', 'Acme', 'https://example.com/1',
        app_team_id(), auth.uid());
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
reset role;

\echo ''
\echo '=== 5. b1 cannot insert into another team (WITH CHECK) ==='
set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000000b1';
do $$
begin
  insert into application (title, company, job_url, team_id, created_by)
  values ('Sneaky', 'Evil', 'https://example.com/2',
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
  insert into application (title, company, job_url, team_id, created_by)
  values ('Forged', 'Acme', 'https://example.com/3',
          app_team_id(), '00000000-0000-0000-0000-0000000000b2');
  raise exception 'FAIL: forged created_by was allowed';
exception
  when insufficient_privilege then
    raise notice 'PASS: forged created_by rejected';
end
$$;
reset role;

\echo ''
\echo '=== 7. bidder cannot self-promote to admin ==='
set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000000b1';
do $$
begin
  update app_user set role = 'admin' where id = auth.uid();
  if found then
    raise exception 'FAIL: self-promotion was allowed';
  end if;
  raise notice 'PASS: self-promotion matched no rows';
exception
  when insufficient_privilege then
    raise notice 'PASS: self-promotion rejected by policy';
end
$$;
reset role;

\echo ''
\echo '=== 8. super_admin owns no records ==='
insert into auth.users (id, email)
  values ('00000000-0000-0000-0000-00000000005a', 'super@example.com');
update app_user set role = 'super_admin'
  where id = '00000000-0000-0000-0000-00000000005a';
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000005a';
select 'super team is null' as check, app_team_id() is null as expect_true;
select 'super sees no applications' as check, count(*) = 0 as expect_true from application;
reset role;

\echo ''
\echo '=== 9a. profiles are invisible to a bidder until assigned ==='
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000a';
insert into candidate_profile (id, full_name, email, profile, team_id, created_by)
values ('00000000-0000-0000-0000-0000000000f1', 'Jane Doe', 'jane@example.com',
        '{"fullName":"Jane Doe","contact":{"email":"jane@example.com","links":[]},"employments":[],"education":[]}'::jsonb,
        app_team_id(), auth.uid());
select 'admin sees profile' as check, count(*) = 1 as expect_true from candidate_profile;

set test.uid = '00000000-0000-0000-0000-0000000000b1';
select 'unassigned bidder sees none' as check, count(*) = 0 as expect_true from candidate_profile;

set test.uid = '00000000-0000-0000-0000-00000000000a';
insert into profile_assignment (profile_id, user_id, team_id, assigned_by)
values ('00000000-0000-0000-0000-0000000000f1',
        '00000000-0000-0000-0000-0000000000b1', app_team_id(), auth.uid());

set test.uid = '00000000-0000-0000-0000-0000000000b1';
select 'assigned bidder sees it' as check, count(*) = 1 as expect_true from candidate_profile;
set test.uid = '00000000-0000-0000-0000-0000000000b2';
select 'other bidder still blind' as check, count(*) = 0 as expect_true from candidate_profile;
reset role;

\echo ''
\echo '=== 9b. bidders cannot assign profiles or edit identity ==='
set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000000b1';
do $$
begin
  insert into profile_assignment (profile_id, user_id, team_id, assigned_by)
  values ('00000000-0000-0000-0000-0000000000f1',
          '00000000-0000-0000-0000-0000000000b2', app_team_id(), auth.uid());
  raise exception 'FAIL: bidder self-assigned a profile';
exception
  when insufficient_privilege then
    raise notice 'PASS: bidder cannot assign profiles';
end
$$;
update candidate_profile set full_name = 'Hacked'
 where id = '00000000-0000-0000-0000-0000000000f1';
select 'bidder edit blocked' as check,
       (select full_name from candidate_profile
         where id = '00000000-0000-0000-0000-0000000000f1') = 'Jane Doe' as expect_true;
reset role;

\echo ''
\echo '=== 9c. SSN round-trips, and a wrong key yields null not plaintext ==='
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000a';
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
reset role;

\echo ''
\echo '=== 9d. bidder cannot reach the SSN ciphertext at all ==='
set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000000b2';
select 'unassigned bidder gets no row' as check, count(*) = 0 as expect_true
  from candidate_profile where id = '00000000-0000-0000-0000-0000000000f1';
reset role;

\echo ''
\echo '=== 9e. the SSN access log is append-only ==='
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
reset role;

\echo ''
\echo '=== 9f. resume storage is team-scoped by the first path segment ==='
grant usage on schema storage to authenticated;
grant all on all tables in schema storage to authenticated;

set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000000b1';
-- Own team's folder: allowed.
insert into storage.objects (bucket_id, name)
values ('resumes', app_team_id()::text || '/abc-cv.pdf');
select 'upload into own team' as check, count(*) = 1 as expect_true from storage.objects;

do $$
begin
  insert into storage.objects (bucket_id, name)
  values ('resumes', '00000000-0000-0000-0000-00000000000c/sneaky.pdf');
  raise exception 'FAIL: wrote into another team''s folder';
exception
  when insufficient_privilege then
    raise notice 'PASS: cross-team upload rejected';
end
$$;
reset role;

set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000c';
select 'other team sees nothing' as check, count(*) = 0 as expect_true
  from storage.objects;
delete from storage.objects where bucket_id = 'resumes';
-- Checked back as a member of the owning team: admin_c can see nothing either
-- way, so counting from there would pass whether or not the delete went through.
set test.uid = '00000000-0000-0000-0000-00000000000a';
select 'other team cannot delete' as check, count(*) = 1 as expect_true
  from storage.objects;
reset role;

\echo ''
\echo '=== 9. blocklist is team-wide readable, bidder cannot delete ==='
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000a';
insert into blocked_company (name, normalized_name, team_id, created_by)
values ('Evil Corp', 'evil corp', app_team_id(), auth.uid());
set test.uid = '00000000-0000-0000-0000-0000000000b1';
select 'bidder reads blocklist' as check, count(*) = 1 as expect_true from blocked_company;
delete from blocked_company;
select 'bidder delete blocked' as check, count(*) = 1 as expect_true from blocked_company;
reset role;
