-- ===========================================================================
-- Application resumes move to Supabase Storage
--
-- The upload previously went client → our server (authorize) → UploadThing's
-- API → client → UploadThing's callback → our server, before the browser could
-- record the row. Five hops for one file, and in local development the callback
-- leg has to reach localhost, which is slower still.
--
-- Storage is one authenticated PUT from the browser straight to Supabase, with
-- the policies below as the check. No round trip through this app at all.
--
-- The bucket is public: the stored URL has to keep working for as long as the
-- application row references it, and a signed URL expires. That makes a resume
-- URL a capability — anyone holding it can fetch it — which is exactly what the
-- UploadThing URLs it replaces already were, so nothing is given up here. The
-- uuid in the path is what keeps it unguessable. If resumes ever need to be
-- properly access-controlled, make the bucket private and serve them through a
-- route handler that re-checks the row before streaming.
-- ===========================================================================

insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', true)
on conflict (id) do update set public = true;

-- Objects are keyed `<team_id>/<uuid>-<filename>`, so the first path segment is
-- the team — which is what these check.

-- Fetching a file needs no policy, because a public bucket serves it straight
-- from the storage endpoint. This one governs the *authenticated* API: listing
-- a folder, and reading an object's metadata. Without it RLS denies both, and
-- an upload that plainly succeeded reads back as though it never happened.
drop policy if exists resumes_select on storage.objects;
create policy resumes_select on storage.objects
  for select to authenticated using (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = app_team_id()::text
  );

drop policy if exists resumes_insert on storage.objects;
create policy resumes_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = app_team_id()::text
  );

drop policy if exists resumes_update on storage.objects;
create policy resumes_update on storage.objects
  for update to authenticated using (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = app_team_id()::text
  );

drop policy if exists resumes_delete on storage.objects;
create policy resumes_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = app_team_id()::text
  );

-- resume_key now holds the object's storage path rather than an UploadThing
-- handle. Same column, same purpose — the value needed to delete the object —
-- so no data migration is required; existing rows keep pointing at their
-- UploadThing files and continue to resolve.
comment on column application.resume_key is
  'Supabase Storage object path. Older rows may hold a legacy UploadThing key.';
