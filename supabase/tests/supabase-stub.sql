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

-- --------------------------------------------------------------------------
-- Storage
--
-- Enough of Supabase Storage for the resume bucket's policies to be created and
-- exercised. foldername() splits on "/" here; the real one drops the filename,
-- but both agree on segment [1], which is all the policies read.
-- --------------------------------------------------------------------------

create schema if not exists storage;

create table storage.buckets (
  id     text primary key,
  name   text not null,
  public boolean not null default false
);

create table storage.objects (
  id        uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name      text not null,
  owner     uuid
);

alter table storage.objects enable row level security;

create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select string_to_array(name, '/')
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
