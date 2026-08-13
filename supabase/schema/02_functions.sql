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
    when u.role::text = 'admin' then u.id
    when u.role::text in ('bidder', 'resume_builder') then u.created_by_id
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
  select app_role()::text in ('admin', 'super_admin')
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
