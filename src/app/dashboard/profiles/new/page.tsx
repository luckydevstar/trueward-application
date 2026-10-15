import { Alert } from "antd";

import { ProfileFormPage } from "@/components/profile-form-page";
import { requireActor } from "@/lib/actor";
import { canEditProfiles, teamIdFor } from "@/lib/scope";

export const metadata = { title: "New profile" };

/** Creating a profile is the team's subadmin's: a profile needs a team. */
export default async function NewProfilePage() {
  const actor = await requireActor();
  if (!canEditProfiles(actor.role) || !teamIdFor(actor)) {
    return (
      <Alert
        type="warning"
        showIcon
        title="Not available"
        description="Profiles are created by the team's subadmin."
      />
    );
  }
  return <ProfileFormPage mode="create" canSeeSsn />;
}
