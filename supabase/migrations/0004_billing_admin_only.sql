-- ===========================================================================
-- Billing status is an admin decision
--
-- Whether work is billable, unbilled or billed is a commercial call about
-- someone else's output. A bidder records the application; an admin decides
-- what it is worth.
--
-- Enforced with a trigger rather than a policy because RLS is row-level: a
-- policy can say whether this row may be updated at all, not which of its
-- columns may change. Postgres does have column privileges, but they are
-- granted to *database* roles, and every signed-in caller here shares the one
-- `authenticated` role — the distinction that matters lives in app_user.
-- ===========================================================================

create or replace function public.enforce_billing_authority()
returns trigger
language plpgsql
-- Not SECURITY DEFINER: app_role() already is, and this function reads nothing
-- else. Leaving it as invoker keeps the privilege where it is needed and
-- nowhere wider.
set search_path = public
as $$
begin
  -- Admins and super admins pass straight through.
  if app_role() is distinct from 'bidder'::user_role then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- A new application is always 'unbilled'. Rejecting rather than silently
    -- coercing, so a client sending something else finds out it was ignored.
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

-- Fires on every insert and update rather than `update of billing`: a column
-- listed in the trigger definition still fires when set to its current value,
-- but one *omitted* from it never fires at all, and the comparison above is
-- what decides. Firing broadly and comparing precisely is the safer pairing.
create trigger application_billing_authority
  before insert or update on application
  for each row execute function public.enforce_billing_authority();
