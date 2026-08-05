"use client";

import { DeleteOutlined, PlusOutlined, TeamOutlined } from "@ant-design/icons";
import {
  App,
  Button,
  Card,
  Empty,
  List,
  Popconfirm,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  ProfileEditor,
  type ProfileFormValues,
} from "@/components/profile-editor";
import { setSsn } from "@/app/dashboard/profiles/ssn-actions";
import { toProfileRow } from "@/lib/profile-form";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/status";

export type ProfileRow = {
  id: string;
  full_name: string;
  email: string | null;
  city: string | null;
  state: string | null;
  updated_at: string;
  has_ssn: boolean;
  assignee_ids: string[];
};

type Props = {
  teamId: string;
  userId: string;
  canEdit: boolean;
  rows: ProfileRow[];
  teamMembers: Array<{ id: string; label: string }>;
};

export function ProfilesList({
  teamId,
  userId,
  canEdit,
  rows,
  teamMembers,
}: Props) {
  const router = useRouter();
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const create = async (values: ProfileFormValues) => {
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
    const supabase = createClient();
    const { data, error } = await supabase
      .from("candidate_profile")
      .insert({ ...row, team_id: teamId, created_by: userId })
      .select("id")
      .single();

    if (error || !data) {
      setBusy(false);
      message.error(error?.message ?? "Could not create the profile.");
      return;
    }

    // Separate call: the plaintext has exactly one entry point into the system,
    // and it is never part of an ordinary row write.
    if (values.ssn?.trim()) {
      const result = await setSsn(data.id, values.ssn);
      if (!result.ok) message.warning(`Profile saved, but: ${result.error}`);
    }

    setBusy(false);
    message.success("Profile created.");
    setOpen(false);
    router.refresh();
  };

  const remove = async (id: string) => {
    const supabase = createClient();
    const { error } = await supabase
      .from("candidate_profile")
      .delete()
      .eq("id", id);
    if (error) {
      message.error(error.message);
      return;
    }
    message.success("Deleted.");
    router.refresh();
  };

  /**
   * Assignment is a set: the Select hands back the whole desired membership,
   * so this diffs against what's stored rather than trying to track individual
   * add and remove events.
   */
  const setAssignees = async (profileId: string, next: string[]) => {
    const supabase = createClient();
    const current = rows.find((r) => r.id === profileId)?.assignee_ids ?? [];

    const added = next.filter((id) => !current.includes(id));
    const removed = current.filter((id) => !next.includes(id));

    if (added.length) {
      const { error } = await supabase.from("profile_assignment").insert(
        added.map((id) => ({
          profile_id: profileId,
          user_id: id,
          team_id: teamId,
          assigned_by: userId,
        })),
      );
      if (error) {
        message.error(error.message);
        return;
      }
    }

    if (removed.length) {
      const { error } = await supabase
        .from("profile_assignment")
        .delete()
        .eq("profile_id", profileId)
        .in("user_id", removed);
      if (error) {
        message.error(error.message);
        return;
      }
    }

    router.refresh();
  };

  return (
    <>
      <Space
        style={{
          marginBottom: 16,
          width: "100%",
          justifyContent: "space-between",
        }}
      >
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            Profiles
          </Typography.Title>
          <Typography.Text type="secondary">
            The stable half of a resume — identity, employers, dates. Nothing
            here is rewritten when you tailor for a job.
          </Typography.Text>
        </div>
        {canEdit && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setOpen(true)}
          >
            New profile
          </Button>
        )}
      </Space>

      <Card>
        {rows.length === 0 ? (
          <Empty
            description={
              canEdit
                ? "No profiles yet. Create one to start building resumes."
                : "No profiles have been assigned to you yet."
            }
          />
        ) : (
          <List
            dataSource={rows}
            renderItem={(row) => (
              <List.Item
                actions={[
                  <Link key="open" href={`/dashboard/profiles/${row.id}`}>
                    Edit
                  </Link>,
                  ...(canEdit
                    ? [
                        <Popconfirm
                          key="delete"
                          title="Delete this profile?"
                          description="Its resume documents and attachments go too."
                          onConfirm={() => remove(row.id)}
                          okButtonProps={{ danger: true }}
                        >
                          <Button type="text" danger icon={<DeleteOutlined />} />
                        </Popconfirm>,
                      ]
                    : []),
                ]}
              >
                <List.Item.Meta
                  title={
                    <Space>
                      <Link href={`/dashboard/profiles/${row.id}`}>
                        {row.full_name}
                      </Link>
                      {row.has_ssn && <Tag color="orange">SSN on file</Tag>}
                    </Space>
                  }
                  description={
                    <Space direction="vertical" size={4} style={{ width: "100%" }}>
                      <span>
                        {[row.email, [row.city, row.state].filter(Boolean).join(", ")]
                          .filter(Boolean)
                          .join(" · ")}
                        {` · updated ${formatDate(row.updated_at)}`}
                      </span>
                      {canEdit && (
                        <Space size={6}>
                          <TeamOutlined style={{ color: "#94a3b8" }} />
                          <Select
                            mode="multiple"
                            allowClear
                            size="small"
                            placeholder="Assign to bidders"
                            style={{ minWidth: 260 }}
                            value={row.assignee_ids}
                            onChange={(next) => setAssignees(row.id, next)}
                            options={teamMembers.map((m) => ({
                              value: m.id,
                              label: m.label,
                            }))}
                          />
                        </Space>
                      )}
                    </Space>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Card>

      <ProfileEditor
        open={open}
        busy={busy}
        canSeeSsn={canEdit}
        onCancel={() => setOpen(false)}
        onSubmit={create}
      />
    </>
  );
}
