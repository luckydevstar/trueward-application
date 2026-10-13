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
 * The team the caller belongs to, identified by an admin's id.
 *
 *   admin                    their own id
 *   bidder, resume_builder   the admin who created them
 *   super_admin              none — they manage accounts, not records
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
    when u.role::text in ('bidder', 'resume_builder') then u.created_by_id
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
  select app_role()::text in ('subadmin', 'super_admin')
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
  select app_role()::text = 'super_admin'
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
  select is_super_admin() or target = app_team_id()
$$;

create or replace function public.is_builder()
returns boolean
language sql
stable
as $$
  select app_role()::text = 'resume_builder'
$$;

/**
 * Which profiles the caller may work with.
 *
 *   admin           every profile on the team
 *   resume_builder  only the ones they created
 *   bidder          only the ones assigned to them
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
revoke all on function public.reveal_ssn(uuid, text) from public;
revoke all on function public.store_ssn(uuid, text, text) from public;
revoke all on function public.encrypt_ssn(text, text) from public;
revoke all on function public.decrypt_ssn(bytea, text) from public;

/**
 * Hands a candidate profile to a subadmin, with everything attached to it.
 *
 * A super admin's one structural power: deciding which tenant runs a
 * candidate. Everything else they do is reading and fixing.
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

  -- A team is a subadmin's id. Handing a profile to a bidder or a resume
  -- builder would create a team nobody administers, and app_team_id() would
  -- never resolve to it.
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

revoke all on function public.assign_profile_to_team(uuid, uuid) from public;
grant execute on function public.assign_profile_to_team(uuid, uuid) to authenticated;
