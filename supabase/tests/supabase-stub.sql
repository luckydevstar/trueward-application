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
end
$$;
