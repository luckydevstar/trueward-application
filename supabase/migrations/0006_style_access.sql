-- ===========================================================================
-- Per-account template and accent allowances
--
-- Which resume styles someone may use is a presentation decision, not a
-- security one — nothing here guards data. It exists so an admin can keep a
-- house style: give a builder two templates and one accent rather than the
-- whole set, and every resume they produce looks like it came from the same
-- place.
--
-- Both columns are nullable, and null means "whatever this role gets by
-- default" rather than "none". A default of the empty array would leave a new
-- account unable to render anything, and an account created before this
-- migration is exactly that case.
-- ===========================================================================

alter table app_user
  add column if not exists allowed_templates text[],
  add column if not exists allowed_accents   text[];

comment on column app_user.allowed_templates is
  'Template ids this account may use. Null falls back to the role default in src/lib/style-access.ts.';
comment on column app_user.allowed_accents is
  'Accent names this account may use. Null falls back to the role default.';

-- Readable through the existing app_user select policies — a person needs to
-- read their own allowance to render the picker. Writing is an admin action,
-- and goes through the service-role path in
-- src/app/dashboard/users/actions.ts, so no policy change is needed here.
--
-- One consequence worth stating: this is enforced in the UI, not the database.
-- Someone posting a resume_document with a template they weren't offered would
-- succeed. That is deliberate — it is a style guideline, and treating it as a
-- boundary would mean validating a cosmetic field on every write.
