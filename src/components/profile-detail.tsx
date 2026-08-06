"use client";

import {
  DeleteOutlined,
  EditOutlined,
  FileOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Image,
  List,
  Popconfirm,
  Progress,
  Row,
  Space,
  Typography,
} from "antd";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { setSsn } from "@/app/dashboard/profiles/ssn-actions";
import {
  ProfileEditor,
  type ProfileFormValues,
} from "@/components/profile-editor";
import { displayUrl } from "@/lib/profile";
import { toFormValues, toProfileRow } from "@/lib/profile-form";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/status";
import { useUploadThing } from "@/lib/uploadthing";

type Attachment = {
  id: string;
  label: string;
  file_url: string;
  file_key: string;
  file_name: string | null;
  file_type: string | null;
  created_at: string;
};

type Props = {
  profileId: string;
  teamId: string;
  userId: string;
  canEdit: boolean;
  row: Parameters<typeof toFormValues>[0] & { has_ssn: boolean };
  attachments: Attachment[];
};

export function ProfileDetail({
  profileId,
  teamId,
  userId,
  canEdit,
  row,
  attachments,
}: Props) {
  const router = useRouter();
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const { startUpload, isUploading } = useUploadThing("profileAttachment", {
    onUploadProgress: setProgress,
    onClientUploadComplete: async (res) => {
      setProgress(null);
      const supabase = createClient();

      const { error } = await supabase.from("profile_attachment").insert(
        (res ?? []).map((r) => ({
          profile_id: profileId,
          label: r.serverData.name.replace(/\.[^.]+$/, ""),
          file_key: r.serverData.key,
          file_url: r.serverData.url,
          file_name: r.serverData.name,
          file_type: r.serverData.type,
          file_size: r.serverData.size,
          team_id: teamId,
          created_by: userId,
        })),
      );

      if (error) {
        message.error(error.message);
        return;
      }
      message.success("Attached.");
      router.refresh();
    },
    onUploadError: (error) => {
      setProgress(null);
      message.error(error.message);
    },
  });

  const save = async (values: ProfileFormValues) => {
    let next;
    try {
      next = toProfileRow(values);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Invalid profile");
      return;
    }

    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("candidate_profile")
      .update(next)
      .eq("id", profileId);

    if (error) {
      setBusy(false);
      message.error(error.message);
      return;
    }

    // Blank means "leave the stored one alone", so only call through when the
    // admin actually typed a replacement.
    if (values.ssn?.trim()) {
      const result = await setSsn(profileId, values.ssn);
      if (!result.ok) message.warning(`Saved, but: ${result.error}`);
    }

    setBusy(false);
    message.success("Saved.");
    setOpen(false);
    router.refresh();
  };

  const removeAttachment = async (id: string) => {
    const supabase = createClient();
    const { error } = await supabase
      .from("profile_attachment")
      .delete()
      .eq("id", id);
    if (error) {
      message.error(error.message);
      return;
    }
    router.refresh();
  };

  const values = toFormValues(row);
  const location = [row.city, row.state, row.postal_code, row.country]
    .filter(Boolean)
    .join(", ");

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
            {row.full_name}
          </Typography.Title>
          <Typography.Text type="secondary">{row.email}</Typography.Text>
        </div>
        {canEdit && (
          <Button
            type="primary"
            icon={<EditOutlined />}
            onClick={() => setOpen(true)}
          >
            Edit profile
          </Button>
        )}
      </Space>

      <Row gutter={16}>
        <Col xs={24} lg={14}>
          <Card size="small" title="Details" style={{ marginBottom: 16 }}>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="Phone">{row.phone || "—"}</Descriptions.Item>
              <Descriptions.Item label="Address">
                {[row.address, location].filter(Boolean).join(" · ") || "—"}
              </Descriptions.Item>
              <Descriptions.Item label="Birthday">
                {row.birthday ? formatDate(row.birthday) : "—"}
              </Descriptions.Item>
              <Descriptions.Item label="GitHub">
                {row.github_url ? (
                  <a href={row.github_url} target="_blank" rel="noopener noreferrer">
                    {displayUrl(row.github_url)}
                  </a>
                ) : (
                  "—"
                )}
              </Descriptions.Item>
              <Descriptions.Item label="LinkedIn">
                {row.linkedin_url ? (
                  <a href={row.linkedin_url} target="_blank" rel="noopener noreferrer">
                    {displayUrl(row.linkedin_url)}
                  </a>
                ) : (
                  "—"
                )}
              </Descriptions.Item>
              <Descriptions.Item label="SSN">
                {/* Never the value, only whether one exists. Revealing is a
                    logged action inside the editor. */}
                {row.has_ssn ? "On file — reveal from Edit profile" : "—"}
              </Descriptions.Item>
            </Descriptions>
          </Card>

          <Card size="small" title="Employment">
            {values.employments?.length ? (
              <List
                size="small"
                dataSource={values.employments}
                renderItem={(e) => (
                  <List.Item>
                    <List.Item.Meta
                      title={`${e.company} · ${e.id}`}
                      description={
                        <>
                          {e.startDate?.format("MMMM YYYY")} –{" "}
                          {e.endDate ? e.endDate.format("MMMM YYYY") : "Present"}
                          {e.location ? ` · ${e.location}` : ""}
                          {e.additionalInfo && (
                            <div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>
                              <Typography.Text type="secondary">
                                {e.additionalInfo}
                              </Typography.Text>
                            </div>
                          )}
                        </>
                      }
                    />
                  </List.Item>
                )}
              />
            ) : (
              <Empty description="No employment recorded." />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card
            size="small"
            title="Attachments"
            extra={
              canEdit && (
                <>
                  <Button
                    size="small"
                    icon={<UploadOutlined />}
                    loading={isUploading}
                    onClick={() => fileInput.current?.click()}
                  >
                    Upload
                  </Button>
                  <input
                    ref={fileInput}
                    type="file"
                    multiple
                    accept="image/*,.pdf,.doc,.docx,.txt,.csv,.xls"
                    hidden
                    onChange={(event) => {
                      const files = Array.from(event.target.files ?? []);
                      if (files.length) void startUpload(files);
                      event.target.value = "";
                    }}
                  />
                </>
              )
            }
          >
            {progress !== null && (
              <Progress percent={progress} status="active" style={{ marginBottom: 12 }} />
            )}
            {attachments.length === 0 ? (
              <Empty description="Photos, certificates, anything else worth keeping." />
            ) : (
              <List
                size="small"
                dataSource={attachments}
                renderItem={(a) => (
                  <List.Item
                    actions={
                      canEdit
                        ? [
                            <Popconfirm
                              key="del"
                              title="Remove this attachment?"
                              onConfirm={() => removeAttachment(a.id)}
                            >
                              <Button type="text" danger icon={<DeleteOutlined />} />
                            </Popconfirm>,
                          ]
                        : []
                    }
                  >
                    <List.Item.Meta
                      avatar={
                        a.file_type?.startsWith("image/") ? (
                          <Image
                            src={a.file_url}
                            alt={a.label}
                            width={40}
                            height={40}
                            style={{ objectFit: "cover", borderRadius: 4 }}
                          />
                        ) : (
                          <FileOutlined style={{ fontSize: 22, color: "#64748b" }} />
                        )
                      }
                      title={
                        <a href={a.file_url} target="_blank" rel="noopener noreferrer">
                          {a.label}
                        </a>
                      }
                      description={formatDate(a.created_at)}
                    />
                  </List.Item>
                )}
              />
            )}
          </Card>

          <Card size="small" title="Education" style={{ marginTop: 16 }}>
            {values.education?.length ? (
              <List
                size="small"
                dataSource={values.education}
                renderItem={(e) => (
                  <List.Item>
                    <List.Item.Meta
                      title={e.degree}
                      description={
                        <>
                          {e.school}
                          {e.year ? ` · ${e.year.format("YYYY")}` : ""}
                          {e.additionalInfo && (
                            <div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>
                              <Typography.Text type="secondary">
                                {e.additionalInfo}
                              </Typography.Text>
                            </div>
                          )}
                        </>
                      }
                    />
                  </List.Item>
                )}
              />
            ) : (
              <Empty description="No education recorded." />
            )}
          </Card>
        </Col>
      </Row>

      <ProfileEditor
        open={open}
        busy={busy}
        profileId={profileId}
        canSeeSsn={canEdit}
        hasSsn={row.has_ssn}
        initialValues={values}
        onCancel={() => setOpen(false)}
        onSubmit={save}
      />
    </>
  );
}
