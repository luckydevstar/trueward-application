"use client";

import { ArrowLeftOutlined } from "@ant-design/icons";
import { App, Button, Typography } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { createProfile, updateProfile } from "@/app/dashboard/profiles/actions";
import { setSsn } from "@/app/dashboard/profiles/ssn-actions";
import { ProfileForm, type ProfileFormValues, type ResearchPrompt } from "@/components/profile-editor";
import { toFormValues, toProfileRow } from "@/lib/profile-form";

type Props = { researchPrompt: ResearchPrompt } & (
  | { mode: "create"; canSeeSsn: boolean }
  | {
      mode: "edit";
      profileId: string;
      canSeeSsn: boolean;
      hasSsn: boolean;
      row: Parameters<typeof toFormValues>[0];
    }
);

/**
 * New and edit profile, each on its own page. Saving writes the row, then the
 * SSN through its own action — the plaintext has exactly one way in, never an
 * ordinary row write — and returns to the profile.
 */
export function ProfileFormPage(props: Props) {
  const router = useRouter();
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);

  const back = props.mode === "edit" ? `/dashboard/profiles/${props.profileId}` : "/dashboard/profiles";

  const submit = async (values: ProfileFormValues) => {
    let row;
    try {
      // Throws when the derived document is invalid — a bad employment date,
      // say — which is worth surfacing before anything is written.
      row = toProfileRow(values);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Invalid profile");
      return;
    }

    setBusy(true);
    let id: string;
    if (props.mode === "create") {
      const created = await createProfile(row);
      if (!created.ok) {
        setBusy(false);
        message.error(created.error);
        return;
      }
      id = created.data.id;
    } else {
      const updated = await updateProfile(props.profileId, row);
      if (!updated.ok) {
        setBusy(false);
        message.error(updated.error);
        return;
      }
      id = props.profileId;
    }

    // Blank means "leave the stored one alone".
    if (values.ssn?.trim()) {
      const result = await setSsn(id, values.ssn);
      if (!result.ok) message.warning(`Saved, but: ${result.error}`);
    }

    message.success(props.mode === "create" ? "Profile created." : "Saved.");
    router.push(`/dashboard/profiles/${id}`);
    router.refresh();
  };

  return (
    <>
      <Link href={back}>
        <Button type="link" icon={<ArrowLeftOutlined />} style={{ paddingInline: 0 }}>
          {props.mode === "edit" ? "Back to the profile" : "Profiles"}
        </Button>
      </Link>
      <Typography.Title level={3} style={{ margin: "0 0 16px", letterSpacing: "-0.02em" }}>
        {props.mode === "edit" ? `Edit ${props.row.full_name}` : "New profile"}
      </Typography.Title>
      <ProfileForm
        busy={busy}
        profileId={props.mode === "edit" ? props.profileId : undefined}
        canSeeSsn={props.canSeeSsn}
        hasSsn={props.mode === "edit" ? props.hasSsn : false}
        initialValues={props.mode === "edit" ? toFormValues(props.row) : undefined}
        researchPrompt={props.researchPrompt}
        onCancel={() => router.push(back)}
        onSubmit={submit}
      />
    </>
  );
}
