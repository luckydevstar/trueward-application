-- ===========================================================================
-- Paste this into the Supabase SQL editor. It reads only — nothing is written.
--
-- It answers the question the app cannot: which version of each policy and
-- helper is actually live. "new row violates row-level security policy" means
-- one clause of a WITH CHECK evaluated false, and the app has no way to see
-- which, so this prints them and the values they compare against.
-- ===========================================================================

-- 1. Which parts of the schema have landed ----------------------------------
select
  to_regprocedure('public.app_role()')                    is not null as "app_role",
  to_regprocedure('public.can_use_profile(uuid)')         is not null as "can_use_profile",
  to_regprocedure('public.normalize_company(text)')       is not null as "normalize_company",
  to_regprocedure('public.enforce_billing_authority()')   is not null as "billing",
  to_regprocedure('public.in_own_team(uuid)')             is not null as "in_own_team",
  to_regprocedure('public.transfer_team(uuid, uuid)')     is not null as "transfer_team",
  -- Retired with the resume_builder role; should be false once part 4 has run.
  to_regprocedure('public.is_builder()')                  is not null as "is_builder (want false)",
  exists (
    select 1 from pg_constraint where conname = 'app_user_role_retired'
  ) as "resume_builder retired",
  exists (
    select 1 from information_schema.columns
    where table_name = 'application' and column_name = 'archived_at'
  ) as "archived_at";

-- 2. Is the self-update hole closed? -----------------------------------------
--
-- The old app_user_self_update policy let any account rewrite its own
-- created_by_id — its team. It should be gone.
select
  case
    when exists (
      select 1 from pg_policy
       where polrelid = 'public.app_user'::regclass and polname = 'app_user_self_update'
    ) then 'OPEN — re-run supabase/schema/ part 4'
    else 'OK — no update path on app_user'
  end as app_user_update_status;

-- 3. Can a browser session call the SSN functions? ---------------------------
--
-- Every row should read false. True means reveal_ssn & co. are reachable
-- through PostgREST by anyone with the anon key; re-run part 2.
select fn,
       has_function_privilege('anon', fn, 'execute')          as anon,
       has_function_privilege('authenticated', fn, 'execute') as authenticated
  from unnest(array[
    'public.reveal_ssn(uuid, text)',
    'public.store_ssn(uuid, text, text)',
    'public.encrypt_ssn(text, text)',
    'public.decrypt_ssn(bytea, text)'
  ]) as fn;

-- 4. The live insert rule for profiles --------------------------------------
select polname as policy, pg_get_expr(polwithcheck, polrelid) as with_check
from pg_policy
where polrelid = 'public.candidate_profile'::regclass and polcmd = 'a';

-- 5. What each account resolves to ------------------------------------------
--
-- `team` is what app_team_id() will return for them. A bidder showing null
-- here was never attached to a subadmin and can do nothing.
select
  u.email,
  u.role,
  case
    when u.role::text = 'subadmin' then u.id
    when u.role::text = 'bidder' then u.created_by_id
    else null
  end as team,
  c.email as created_by
from app_user u
left join app_user c on c.id = u.created_by_id
order by u.role::text, u.email;
