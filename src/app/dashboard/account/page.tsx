import { AccountPanel } from "@/components/account-panel";
import { requireActor } from "@/lib/actor";
import { ROLE_META } from "@/lib/roles";

export const metadata = { title: "Account · Application" };

/**
 * Your own account: name and password. Every role has one — a bidder never
 * reaches the Users page, so this is the only place they can change their
 * password. The change goes through updateUser(), which asks for the current
 * password first.
 */
export default async function AccountPage() {
  const actor = await requireActor();
  return (
    <AccountPanel
      id={actor.id}
      name={actor.name ?? ""}
      email={actor.email}
      role={ROLE_META[actor.role].label}
    />
  );
}
