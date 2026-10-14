-- ===========================================================================
-- Trueward Guru — schema part 2 of 4: Identity, scope, bookkeeping and SSN
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
-- Identity and scope
-- ===========================================================================

/**
 * Mirror every auth signup into app_user.
 *
 * SECURITY DEFINER because the trigger runs as the *signing-up* user, who has
 * no rights on app_user yet — the row it needs to insert is the very row that
 * would grant them.
 */
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.app_user (id, email, name)
  values (new.id, new.email, nullif(new.raw_user_meta_data ->> 'name', ''));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

/**
 * The caller's role.
 *
 * SECURITY DEFINER so it can read app_user without re-entering that table's own
 * policies, which would recurse infinitely. STABLE so Postgres evaluates it
 * once per statement rather than once per row.
 */
create or replace function public.app_role()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from app_user where id = auth.uid()
$$;

/**
 * The team the caller belongs to, identified by a subadmin's id.
 *
 *   subadmin     their own id
 *   bidder       the subadmin who created them
 *   super_admin  none — they review every team and belong to none
 *
 * Listing the roles it knows and returning null for the rest is a trap worth
 * naming: every policy starts with `team_id = app_team_id()`, and that against
 * null is not false but *unknown*, so it matches nothing. An account whose role
 * is missing here can read nothing and write nothing, with no error saying why.
 */
create or replace function public.app_team_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case
    when u.role::text = 'subadmin' then u.id
    when u.role::text = 'bidder' then u.created_by_id
    -- A super admin still has no team of their own. Their reach comes from
    -- in_team() below instead, which lets them past the team check entirely
    -- rather than pretending they belong to one — there is no single team id
    -- that could stand for "all of them".
    else null
  end
  from app_user u
  where u.id = auth.uid()
$$;

/**
 * Every predicate here is wrapped in coalesce(..., false): they answer false,
 * never null, for a caller with no app_user row (a session whose account was
 * deleted, or an auth.users row that never got one).
 *
 * In a policy the difference is invisible — RLS denies on null exactly as it
 * denies on false. In plpgsql it inverts the check: `if not is_super_admin()`
 * on a null is `if null`, which does not branch, so the guard is skipped and
 * the body runs. assign_profile_to_team() was reachable that way.
 *
 * Fixing it in the predicates rather than at the one call site is deliberate.
 * The next `if not is_admin()` someone writes is then safe by default, instead
 * of safe only if they knew about this.
 */

/**
 * The privileged roles.
 *
 * A positive list rather than "not a bidder". That phrasing was the same thing
 * while bidder was the only unprivileged role, and stopped being so the moment
 * a second one existed — every check written that way would hand a new role
 * admin rights by default.
 */
create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(app_role()::text in ('subadmin', 'super_admin'), false)
$$;

/**
 * The platform owner, as opposed to the owner of one team.
 *
 * Separate from is_admin() because the two answer different questions: a
 * subadmin is an admin *of their team*, while this is the role that is not
 * bounded by a team at all.
 */
create or replace function public.is_super_admin()
returns boolean
language sql
stable
as $$
  select coalesce(app_role()::text = 'super_admin', false)
$$;

/**
 * The team test every policy starts with.
 *
 * `team_id = app_team_id()` on its own excludes a super admin, because their
 * app_team_id() is null and `null = anything` is unknown rather than false —
 * they matched nothing, silently, which is why they could see no records at
 * all.
 *
 * Writing it once here rather than `is_super_admin() or team_id = ...` in
 * twenty policies is the point: the next policy added gets the rule by using
 * the helper, instead of by someone remembering the disjunction.
 */
create or replace function public.in_team(target uuid)
returns boolean
language sql
stable
as $$
  select coalesce(is_super_admin() or target = app_team_id(), false)
$$;

/**
 * The owner of one team: the only role that changes a team's records on
 * anyone's behalf but their own.
 *
 * Every write policy that used to say is_admin() says this instead, because a
 * super admin *reviews* teams rather than running them. They read everything
 * through in_team(); the writes they make are account management (server
 * actions, service role) and the two structural moves below, which are
 * SECURITY DEFINER functions with their own guard.
 */
create or replace function public.is_subadmin()
returns boolean
language sql
stable
as $$
  select coalesce(app_role()::text = 'subadmin', false)
$$;

/**
 * The team test for *writes*: the caller is a member of this team.
 *
 * The other half of in_team(). That one lets a super admin past the team check
 * so they can read every team; this one deliberately does not, because a row
 * has to belong to exactly one team and a super admin belongs to none. Writing
 * `in_team(team_id)` in a WITH CHECK would let a super admin stamp a row into
 * any team they liked, which is the one thing reviewing must not do.
 *
 *   reads   in_team(team_id)
 *   writes  in_own_team(team_id)
 */
create or replace function public.in_own_team(target uuid)
returns boolean
language sql
stable
as $$
  select coalesce(target = app_team_id(), false)
$$;

/**
 * Which profiles the caller may work with.
 *
 *   subadmin, super_admin  every profile they can see (the team, or all teams)
 *   bidder                 only the ones assigned to them
 *
 * SECURITY DEFINER so candidate_profile's policy can consult
 * profile_assignment without that table's policy re-entering
 * candidate_profile — the two reference each other.
 */
create or replace function public.can_use_profile(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when is_admin() then true
    else exists (
      select 1 from profile_assignment
      where profile_id = target and user_id = auth.uid()
    )
  end
$$;

/**
 * Whether a profile belongs to the given team.
 *
 * The cross-check that keeps a child row's team_id honest. A row's own team_id
 * is pinned by in_own_team(), but the profile it points at was not: a subadmin
 * could file an attachment, resume or application in their team against
 * *another* team's profile id. Nothing leaked — they still could not read that
 * profile — but the row would claim a relationship that does not exist.
 *
 * SECURITY DEFINER because the answer must not depend on whether the caller
 * can see the profile; a bidder writing against an assigned profile can, but
 * the check is about the data, not about them.
 */
create or replace function public.profile_in_team(target_profile uuid, target_team uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from candidate_profile
    where id = target_profile and team_id = target_team
  )
$$;

-- ===========================================================================
-- Bookkeeping
-- ===========================================================================

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists candidate_profile_touch on candidate_profile;
create trigger candidate_profile_touch before update on candidate_profile
  for each row execute function public.touch_updated_at();

drop trigger if exists resume_document_touch on resume_document;
create trigger resume_document_touch before update on resume_document
  for each row execute function public.touch_updated_at();

drop trigger if exists application_touch on application;
create trigger application_touch before update on application
  for each row execute function public.touch_updated_at();

-- ===========================================================================
-- Social Security numbers
--
-- The key never lives in the database. It is passed in per call from
-- APP_ENCRYPTION_KEY, held only in the server environment, so a dump of
-- candidate_profile yields ciphertext and nothing else. Losing it means losing
-- every stored SSN — that is the intended trade.
-- ===========================================================================

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
 * Read and write the ciphertext without the key or the plaintext crossing the
 * client boundary.
 *
 * Called only from the service-role client, and only after
 * src/app/dashboard/profiles/ssn-actions.ts has checked the caller is an admin
 * *and* that the row is visible to them through RLS. Service role bypasses
 * policies, so these are exactly as safe as those checks — which is why they
 * are revoked from public below.
 */
create or replace function public.reveal_ssn(target uuid, key text)
returns text
language sql
stable
as $$
  select decrypt_ssn(ssn_encrypted, key) from candidate_profile where id = target
$$;

create or replace function public.store_ssn(target uuid, plain text, key text)
returns void
language sql
as $$
  update candidate_profile
     set ssn_encrypted = encrypt_ssn(plain, key)
   where id = target
$$;

-- PostgREST exposes public functions to any authenticated caller by default.
-- These must not be reachable that way — anon or authenticated could otherwise
-- call reveal_ssn with a guessed key and skip every check above.
--
-- Revoked from anon and authenticated *by name*, not only from public.
-- Supabase's default privileges grant EXECUTE on every new function to anon,
-- authenticated and service_role individually, and revoking from public does
-- not touch a grant made to a role by name — so `from public` alone left all
-- four callable from any browser session. service_role keeps its grant: it is
-- the only caller (ssn-actions.ts), and the guarded block re-grants it in case
-- a database was built without those defaults.
revoke all on function public.reveal_ssn(uuid, text) from public;
revoke all on function public.store_ssn(uuid, text, text) from public;
revoke all on function public.encrypt_ssn(text, text) from public;
revoke all on function public.decrypt_ssn(bytea, text) from public;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.reveal_ssn(uuid, text)',
    'public.store_ssn(uuid, text, text)',
    'public.encrypt_ssn(text, text)',
    'public.decrypt_ssn(bytea, text)'
  ] loop
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', fn);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on function %s from authenticated', fn);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', fn);
    end if;
  end loop;
end
$$;

/**
 * Hands a candidate profile to a subadmin, with everything attached to it.
 *
 * One of a super admin's two structural powers — the other is moving a whole
 * team, transfer_team() below. Everything else they do to records is reading.
 *
 * **Why the history moves too.** The duplicate cooldown
 * (enforce_application_cooldown) only looks at applications in the *same*
 * team. Move a profile without its applications and the new owner could
 * re-apply to a company that candidate was sent to last week, with nothing to
 * stop them — which is the exact harm the cooldown exists to prevent, and it
 * lands on the candidate rather than on us. So this is not "set a column": it
 * is one transaction that moves the profile and every row that hangs off it.
 *
 * **Why assignments are dropped rather than moved.** A profile_assignment
 * names a bidder in the *old* team. Carrying those across would leave the new
 * owner's profile assigned to people who are not in their team and cannot be
 * managed by them. The new owner re-assigns to their own bidders, which is the
 * point of handing it over.
 *
 * SECURITY DEFINER, because the moving rows are in tables the caller is about
 * to stop being able to see — the update that takes a profile out of your team
 * is the update that makes it invisible to you. The guard is the explicit
 * is_super_admin() check, not RLS.
 */
create or replace function public.assign_profile_to_team(
  -- `target_profile`, not `profile`: candidate_profile has a column called
  -- `profile` (the jsonb document), and a parameter of the same name makes
  -- every `where id = profile` ambiguous. Postgres says so loudly, which is
  -- the good case; the bad case would have been it silently resolving to the
  -- column.
  target_profile uuid,
  target_team uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_role text;
begin
  if not is_super_admin() then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'Only a super admin can move a profile between teams.';
  end if;

  -- A team is a subadmin's id. Handing a profile to a bidder would create a
  -- team nobody administers, and app_team_id() would never resolve to it.
  select role::text into target_role from app_user where id = target_team;

  if target_role is null then
    raise exception using
      errcode = 'foreign_key_violation',
      message = 'No such account to hand the profile to.';
  end if;

  if target_role <> 'subadmin' then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = format(
        'Profiles can only be handed to a subadmin; %s is a %s.',
        target_team, target_role
      );
  end if;

  -- Lets this transaction past guard_profile_team(). Transaction-local, so it
  -- ends with this call.
  perform set_config('app.moving_profile', 'on', true);

  -- Order matters only for readability; it is one transaction either way.
  update candidate_profile  set team_id = target_team where id = target_profile;
  update application        set team_id = target_team where profile_id = target_profile;
  update resume_document    set team_id = target_team where profile_id = target_profile;
  update profile_attachment set team_id = target_team where profile_id = target_profile;
  update ssn_access_log     set team_id = target_team where profile_id = target_profile;

  -- The old team's bidders lose it. See the note above.
  delete from profile_assignment where profile_id = target_profile;
end;
$$;

/**
 * Moves a whole team to another subadmin: the step before deleting a subadmin.
 *
 * Deleting a subadmin's auth user cascades through every `team_id` foreign
 * key, so without this, removing a subadmin silently deleted every profile,
 * resume and application their team had ever recorded. The users page calls
 * this first and only then deletes the account — by which point the team is
 * empty and the cascade has nothing to take.
 *
 * Everything moves, in one transaction:
 *
 *   - records       profiles, applications, resumes, attachments, the SSN
 *                   audit trail, and assignments (which stay valid: the
 *                   bidders they name move too)
 *   - people        bidders the old subadmin created now belong to the new one
 *   - blocklist     merged; a company both teams blocked is kept once, as the
 *                   inheritor's entry, since (team_id, normalized_name) is unique
 *   - calendar      events and calendars the old subadmin created in Trueward
 *                   Calendar, which shares this database — otherwise they
 *                   would be left with no creator, editable by the super admin
 *                   alone. Skipped when the calendar schema isn't installed.
 *
 * SECURITY DEFINER for the same reason as assign_profile_to_team(): a super
 * admin can read these rows but no policy lets them write them. The guard is
 * the explicit is_super_admin() check, which coalesces to false for a session
 * with no app_user row.
 */
create or replace function public.transfer_team(from_team uuid, to_team uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  from_role text;
  to_role   text;
begin
  if not is_super_admin() then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'Only a super admin can move a team to another subadmin.';
  end if;

  if from_team = to_team then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'A team cannot be handed to the subadmin who already runs it.';
  end if;

  select role::text into from_role from app_user where id = from_team;
  select role::text into to_role   from app_user where id = to_team;

  if from_role is distinct from 'subadmin' or to_role is distinct from 'subadmin' then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'A team can only move from one subadmin to another.';
  end if;

  perform set_config('app.moving_profile', 'on', true);

  -- The blocklist first: the merge has to happen before the unique index sees
  -- two rows for one company in one team.
  delete from blocked_company b
   where b.team_id = from_team
     and exists (
       select 1 from blocked_company keep
        where keep.team_id = to_team
          and keep.normalized_name = b.normalized_name
     );
  update blocked_company    set team_id = to_team where team_id = from_team;

  update candidate_profile  set team_id = to_team where team_id = from_team;
  update application        set team_id = to_team where team_id = from_team;
  update resume_document    set team_id = to_team where team_id = from_team;
  update profile_attachment set team_id = to_team where team_id = from_team;
  update ssn_access_log     set team_id = to_team where team_id = from_team;
  update profile_assignment set team_id = to_team where team_id = from_team;

  update app_user set created_by_id = to_team
   where created_by_id = from_team and role::text = 'bidder';

  -- Dynamic, because these tables belong to the calendar's schema and this
  -- function must still run on a database that doesn't have them — or has
  -- them from before events had creators.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'calendar_event'
       and column_name = 'created_by'
  ) then
    execute 'update calendar_event set created_by = $1 where created_by = $2'
      using to_team, from_team;
  end if;
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'calendar_source'
       and column_name = 'created_by'
  ) then
    execute 'update calendar_source set created_by = $1 where created_by = $2'
      using to_team, from_team;
  end if;
end;
$$;

/**
 * A profile changes team only through the two functions above.
 *
 * Both move the profile's applications, resumes and attachments with it, in
 * one transaction. A plain `update candidate_profile set team_id = …` would
 * move the profile alone, and the cooldown — which matches applications in
 * the profile's team — would stop knowing where this candidate has already
 * been sent. The super admin's update policy admits any team, so this is what
 * holds that shut; for a subadmin, in_own_team() already does.
 *
 * The functions set `app.moving_profile` for their own transaction only. A
 * client cannot set it: PostgREST runs nothing but exposed tables and
 * functions, and set_config is in pg_catalog.
 */
create or replace function public.guard_profile_team()
returns trigger
language plpgsql
as $$
begin
  if new.team_id is distinct from old.team_id
     and current_setting('app.moving_profile', true) is distinct from 'on' then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'Move a profile with the hand-over, which takes its applications and resumes with it.';
  end if;
  return new;
end;
$$;

drop trigger if exists candidate_profile_team_guard on candidate_profile;
create trigger candidate_profile_team_guard
  before update of team_id on candidate_profile
  for each row execute function public.guard_profile_team();

-- Reachable by a signed-in session, never by anon. The two moves decide inside
-- who may call them; profile_in_team() is needed by policies that run as the
-- signed-in caller.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.assign_profile_to_team(uuid, uuid)',
    'public.transfer_team(uuid, uuid)',
    'public.profile_in_team(uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public', fn);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', fn);
    end if;
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end
$$;
