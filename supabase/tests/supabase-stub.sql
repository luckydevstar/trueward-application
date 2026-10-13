-- Minimal stand-ins for the Supabase-managed objects the migration builds on.
-- Enough to apply the migration and exercise the policies; not a Supabase clone.

create schema if not exists auth;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

-- Supabase reads this from the request JWT. Here it comes from a GUC the test
-- sets, so "acting as" a user is just `set local test.uid = '…'`.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('test.uid', true), '')::uuid
$$;

-- The anon/authenticated role every client request runs as. Non-superuser, so
-- RLS is actually enforced (a superuser bypasses every policy).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end
$$;

-- What Supabase does to every function created in `public`: EXECUTE granted to
-- each API role *by name*. Reproduced here because it is the reason
-- `revoke ... from public` is not enough on its own — a test cluster without
-- these grants would pass a schema that leaves reveal_ssn callable in
-- production.
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;
