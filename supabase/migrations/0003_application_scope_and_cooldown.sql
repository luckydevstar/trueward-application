-- ===========================================================================
-- Applications become profile-scoped, and repeat applications get a cooldown
--
--   * every application names the candidate profile it was sent for
--   * you see every application for a profile you share, not just your own
--   * you may still only change the ones you recorded
--   * the same profile cannot be sent to the same company twice in 14 days
-- ===========================================================================

-- --------------------------------------------------------------------------
-- profile_id becomes the axis applications are organised around
--
-- Left nullable: rows recorded before this migration have no profile, and
-- guessing one would attribute someone's history to a candidate at random.
-- They stay visible to their author and to admins under the policy below.
-- --------------------------------------------------------------------------

create index if not exists application_profile_idx on application (profile_id);

-- Cooldown lookups filter on (profile, company, recency) together.
create index if not exists application_cooldown_idx
  on application (profile_id, lower(company), applied_at desc);

-- --------------------------------------------------------------------------
-- Visibility follows the profile
--
-- Sharing a candidate means sharing their history: two people working the same
-- profile need to see where it has already been sent, or they duplicate each
-- other's work. Acting on a record stays with whoever recorded it.
-- --------------------------------------------------------------------------

drop policy if exists application_select on application;

create policy application_select on application
  for select using (
    team_id = app_team_id()
    and (
      app_role() <> 'bidder'          -- admins see the whole team
      or created_by = auth.uid()      -- your own rows, profile or not
      or can_use_profile(profile_id)  -- rows for a profile you're assigned
    )
  );

-- Update and delete are deliberately *not* widened: seeing a teammate's
-- application is useful, editing it is not.
drop policy if exists application_update on application;

create policy application_update on application
  for update using (
    team_id = app_team_id()
    and (app_role() <> 'bidder' or created_by = auth.uid())
  ) with check (team_id = app_team_id());

drop policy if exists application_delete on application;

create policy application_delete on application
  for delete using (
    team_id = app_team_id()
    and (app_role() <> 'bidder' or created_by = auth.uid())
  );

-- --------------------------------------------------------------------------
-- Cooldown: one profile, one company, 14 days
--
-- A trigger rather than a check in the app. The anon key reaches Postgres
-- directly, so a rule that only lives in a form is not a rule — and the whole
-- point here is that a *teammate's* application blocks yours, which client code
-- cannot see reliably anyway.
--
-- Companies are matched on the same normalised form the blocklist uses, so
-- "Acme, Inc." and "acme inc" are one company rather than two.
-- --------------------------------------------------------------------------

/**
 * A company's comparison key.
 *
 * Lowercased, punctuation collapsed to spaces, and trailing legal suffixes
 * removed — so "Globex", "globex inc" and "Globex, Inc." are one employer.
 * Without the suffix step the guard is trivially defeated by typing the name a
 * slightly different way, which is exactly what someone re-applying would do.
 *
 * This does mean "Acme Inc" and "Acme LLC" collapse together. For a 14-day
 * cooldown that is the right direction to err: it asks a question about a
 * likely duplicate rather than silently allowing one.
 *
 * A name made only of suffixes ("Inc") would otherwise normalise to nothing, so
 * the suffix-stripped form is only used when it leaves something behind.
 */
create or replace function public.normalize_company(name text)
returns text
language sql
immutable
as $$
  with squashed as (
    select btrim(
      regexp_replace(lower(coalesce(name, '')), '[^a-z0-9]+', ' ', 'g')
    ) as value
  ),
  trimmed as (
    select
      value,
      btrim(
        regexp_replace(
          value,
          '(\s+(inc|incorporated|llc|llp|lp|ltd|limited|corp|corporation|co|company|holdings|group|gmbh|plc|ag|sa|nv|bv|ab|oy|as|pty|srl|spa))+$',
          '',
          'g'
        )
      ) as stripped
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

create or replace function public.enforce_application_cooldown()
returns trigger
language plpgsql
-- SECURITY DEFINER so the check sees every application on the team, not just
-- the ones the caller may select. A bidder cannot read a teammate's row, and if
-- this ran with their visibility the duplicate it is meant to catch would be
-- invisible to it.
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
     -- would let the same pair be legal or illegal depending on when the row
     -- happened to be typed, and would refuse a correctly backdated entry
     -- because of something recorded since.
     and a.applied_at > new.applied_at - make_interval(days => window_days)
     and a.applied_at < new.applied_at + make_interval(days => window_days)
     and a.id is distinct from new.id
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
        to_char(
          clash.applied_at + make_interval(days => window_days),
          'Mon DD, YYYY'
        )
      );
  end if;

  return new;
end;
$$;

drop trigger if exists application_cooldown on application;

-- Fires on update too: moving an application's date or company could otherwise
-- walk around the rule that its insert was refused for.
create trigger application_cooldown
  before insert or update of profile_id, company, applied_at on application
  for each row execute function public.enforce_application_cooldown();

-- --------------------------------------------------------------------------
-- The cooling-off list
--
-- Derived, not stored. A table of "currently blocked" pairs would need
-- expiring, and would be one more thing able to disagree with the applications
-- it is computed from.
-- --------------------------------------------------------------------------

create or replace view application_cooldown as
  select distinct on (a.profile_id, normalize_company(a.company))
    a.profile_id,
    p.full_name           as profile_name,
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

-- The view runs with the querying user's permissions, so the underlying
-- application and candidate_profile policies still apply — a bidder sees
-- cooling-off entries only for profiles they share.
alter view application_cooldown set (security_invoker = true);
