-- ===========================================================================
-- Paste this into the Supabase SQL editor. It reads only — nothing is written.
--
-- It answers the question the app cannot: which version of each policy and
-- helper is actually live. "new row violates row-level security policy" means
-- one clause of a WITH CHECK evaluated false, and the app has no way to see
-- which, so this prints them and the values they compare against.
-- ===========================================================================

-- 1. Which migrations have landed -------------------------------------------
select
  to_regprocedure('public.app_role()')            is not null as "0001 app_role",
  to_regprocedure('public.can_use_profile(uuid)') is not null as "0002 can_use_profile",
  to_regprocedure('public.normalize_company(text)') is not null as "0003 normalize_company",
  to_regprocedure('public.enforce_billing_authority()') is not null as "0004 billing",
  to_regprocedure('public.is_builder()')          is not null as "0005 is_builder",
  exists (
    select 1 from information_schema.columns
    where table_name = 'app_user' and column_name = 'allowed_templates'
  ) as "0006 allowed_templates";

-- 2. Does app_team_id() know about resume_builder? --------------------------
--
-- This is the one that bites. The pre-0005 version listed only 'admin' and
-- 'bidder' and returned null for anything else — and `team_id = app_team_id()`
-- against null is not false but *unknown*, so it matches nothing and every
-- insert is refused with no indication why.
select
  case
    when pg_get_functiondef(to_regprocedure('public.app_team_id()')) like '%resume_builder%'
      then 'OK — 0005 version is live'
    else 'STALE — re-run supabase/migrations/0005_resume_builder_role.sql'
  end as app_team_id_status;

-- 3. The live insert rule for profiles --------------------------------------
select polname as policy, pg_get_expr(polwithcheck, polrelid) as with_check
from pg_policy
where polrelid = 'public.candidate_profile'::regclass and polcmd = 'a';

-- 4. What each account resolves to ------------------------------------------
--
-- `team` is what app_team_id() will return for them. A resume_builder showing
-- null here cannot create anything, whatever the policy says.
select
  u.email,
  u.role,
  case
    when u.role::text = 'admin' then u.id
    when u.role::text in ('bidder', 'resume_builder') then u.created_by_id
    else null
  end as team,
  c.email as created_by
from app_user u
left join app_user c on c.id = u.created_by_id
order by u.role::text, u.email;
