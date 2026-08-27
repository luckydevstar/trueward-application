-- ===========================================================================
-- Trueward Guru — schema part 3 of 4: Duplicate applications, billing and the cooldown view
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
-- Duplicate applications
-- ===========================================================================

/**
 * A company's comparison key.
 *
 * Lowercased, punctuation collapsed, trailing legal suffixes removed — so
 * "Globex", "globex inc" and "Globex, Inc." are one employer. Without the
 * suffix step the guard is defeated by typing the name a slightly different
 * way, which is exactly what someone re-applying would do.
 *
 * Must stay in step with normalizeCompany() in src/lib/status.ts, which lets
 * the UI warn before a write this would refuse.
 */
create or replace function public.normalize_company(name text)
returns text
language sql
immutable
as $$
  with squashed as (
    select btrim(regexp_replace(lower(coalesce(name, '')), '[^a-z0-9]+', ' ', 'g')) as value
  ),
  trimmed as (
    select
      value,
      btrim(regexp_replace(
        value,
        '(\s+(inc|incorporated|llc|llp|lp|ltd|limited|corp|corporation|co|company|holdings|group|gmbh|plc|ag|sa|nv|bv|ab|oy|as|pty|srl|spa))+$',
        '', 'g'
      )) as stripped
    from squashed
  )
  select case when stripped = '' then value else stripped end from trimmed
$$;

create index if not exists application_company_normalized_idx
  on application (profile_id, normalize_company(company), applied_at desc);

/** How many days a company is closed to a profile after an application. */
create or replace function public.application_cooldown_days()
returns integer
language sql
immutable
as $$ select 14 $$;

/**
 * One profile, one company, 14 days.
 *
 * A trigger rather than a check in the app: the anon key reaches Postgres
 * directly, and the duplicate this catches is usually a *teammate's* row, which
 * client code often cannot see at all.
 *
 * SECURITY DEFINER for that second reason — a bidder cannot read a teammate's
 * application, and with their visibility the duplicate would be invisible here.
 */
create or replace function public.enforce_application_cooldown()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  clash record;
  window_days integer := application_cooldown_days();
begin
  -- Rows with no profile predate this rule and have nothing to clash against.
  if new.profile_id is null then
    return new;
  end if;

  select a.id, a.company, a.applied_at, u.name, u.email
    into clash
    from application a
    left join app_user u on u.id = a.created_by
   where a.profile_id = new.profile_id
     and a.team_id = new.team_id
     and normalize_company(a.company) = normalize_company(new.company)
     -- Measured between the two applications rather than from now(), so the
     -- rule means "not twice within 14 days of each other". Anchoring on now()
     -- would make the same pair legal or illegal depending on when the row
     -- happened to be typed, and would refuse a correctly backdated entry.
     and a.applied_at > new.applied_at - make_interval(days => window_days)
     and a.applied_at < new.applied_at + make_interval(days => window_days)
     and a.id is distinct from new.id
     -- No archived_at filter, on purpose. An archived application was still
     -- sent, and the cooldown exists so a candidate isn't approached twice in
     -- a fortnight. Skipping archived rows here would turn "archive it" into a
     -- one-click bypass of this trigger.
   order by a.applied_at desc
   limit 1;

  if found then
    raise exception using
      errcode = 'check_violation',
      message = format(
        '%s was already applied to for this profile on %s by %s. It reopens on %s.',
        clash.company,
        to_char(clash.applied_at, 'Mon DD, YYYY'),
        coalesce(clash.name, clash.email, 'a teammate'),
        to_char(clash.applied_at + make_interval(days => window_days), 'Mon DD, YYYY')
      );
  end if;

  return new;
end;
$$;

drop trigger if exists application_cooldown on application;
-- Fires on update too: moving an application's date or company could otherwise
-- walk around the rule its insert was refused for.
create trigger application_cooldown
  before insert or update of profile_id, company, applied_at on application
  for each row execute function public.enforce_application_cooldown();

/**
 * Billing is an admin decision — a bidder records the application, an admin
 * decides what it is worth.
 *
 * A trigger because RLS is row-level: a policy can say whether a row may be
 * updated at all, not which of its columns may change. Postgres column
 * privileges are granted to *database* roles, and every signed-in caller shares
 * the one `authenticated` role.
 */
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
    -- Rejecting rather than silently coercing, so a client sending something
    -- else finds out it was ignored.
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

drop trigger if exists application_billing_authority on application;
create trigger application_billing_authority
  before insert or update on application
  for each row execute function public.enforce_billing_authority();

/**
 * The cooling-off list — one row per (profile, company) still inside the
 * window.
 *
 * Derived, not stored. A table of "currently blocked" pairs would need expiring
 * and would be one more thing able to disagree with the applications it is
 * computed from. security_invoker, so the caller's own policies decide what
 * they see.
 */
drop view if exists application_cooldown;
create view application_cooldown
with (security_invoker = true) as
  select distinct on (a.profile_id, normalize_company(a.company))
    a.profile_id,
    p.full_name as profile_name,
    a.company,
    a.applied_at,
    a.applied_at + make_interval(days => application_cooldown_days()) as reopens_at,
    a.created_by,
    a.team_id
  from application a
  join candidate_profile p on p.id = a.profile_id
  where a.profile_id is not null
    and a.applied_at > now() - make_interval(days => application_cooldown_days())
  order by a.profile_id, normalize_company(a.company), a.applied_at desc;
