"use client";

import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  FileOutlined,
  FileTextOutlined,
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
  Typography,
} from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import {
  addProfileAttachments,
  deleteProfileAttachment,
} from "@/app/dashboard/profiles/actions";
import { PageHeader } from "@/components/page-header";
import { displayUrl } from "@/lib/profile";
import { toFormValues } from "@/lib/profile-form";
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
  canEdit: boolean;
  /** Narrower than canEdit: the team's subadmin only, never the super admin. */
  canSeeSsn: boolean;
  row: Parameters<typeof toFormValues>[0] & { has_ssn: boolean };
  attachments: Attachment[];
};

export function ProfileDetail({
  profileId,
  canEdit,
  canSeeSsn,
  row,
  attachments,
}: Props) {
  const router = useRouter();
  const { message } = App.useApp();
  const [progress, setProgress] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const [uploading, setUploading] = useState(false);

  const { startUpload } = useUploadThing("profileAttachment", {
    onUploadProgress: setProgress,
    onUploadError: (error) => {
      setProgress(null);
      message.error(error.message);
    },
  });

  /**
   * Awaits the upload rather than reacting to onClientUploadComplete.
   *
   * The route sets `awaitServerData: false`, so `serverData` is null and the
   * file's details come off the upload result itself. That is the whole point:
   * nothing here waits on UploadThing calling back into this app, which is a
   * leg that cannot complete against a dev server on localhost.
   */
  const upload = async (files: File[]) => {
    setUploading(true);
    try {
      const uploaded = await startUpload(files);
      if (!uploaded?.length) return;

      const result = await addProfileAttachments(
        profileId,
        uploaded.map((file) => ({
          label: file.name.replace(/\.[^.]+$/, ""),
          file_key: file.key,
          file_url: file.ufsUrl,
          file_name: file.name,
          file_type: file.type,
          file_size: file.size,
        })),
      );

      if (!result.ok) {
        message.error(result.error);
        return;
      }
      message.success("Attached.");
      router.refresh();
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : "Could not upload the files.",
      );
    } finally {
      setProgress(null);
      setUploading(false);
    }
  };

  const removeAttachment = async (id: string) => {
    const result = await deleteProfileAttachment(id);
    if (!result.ok) {
      message.error(result.error);
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
      <PageHeader
        title={row.full_name}
        description={row.email}
        extra={
          <>
            <Link href={`/dashboard/resumes?profile=${profileId}`}>
              <Button icon={<FileTextOutlined />}>Build resume</Button>
            </Link>
            {/*
              The profile as the resume document stores it, for keeping or for
              pasting into another tool. Built from the page's own row, so it
              downloads exactly what generation reads.
            */}
            <Button
              icon={<DownloadOutlined />}
              onClick={() => {
                const blob = new Blob([JSON.stringify(row.profile, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${row.full_name.replace(/[^\w.-]+/g, "_")}.json`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              Download JSON
            </Button>
            {canEdit && (
              <Link href={`/dashboard/profiles/${profileId}/edit`}>
                <Button type="primary" icon={<EditOutlined />}>
                  Edit profile
                </Button>
              </Link>
            )}
          </>
        }
      />

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
                {row.has_ssn
                  ? canSeeSsn
                    ? "On file — reveal from Edit profile"
                    : "On file"
                  : "—"}
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
                      title={e.company}
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
                    loading={uploading}
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
                      if (files.length) void upload(files);
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
                          {e.startYear
                            ? ` · ${e.startYear.format("YYYY")} – ${e.year ? e.year.format("YYYY") : "Present"}`
                            : e.year
                              ? ` · ${e.year.format("YYYY")}`
                              : ""}
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

          <Card size="small" title="Company context" style={{ marginTop: 16 }}>
            {row.company_context?.trim() ? (
              <Typography.Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 0, fontSize: 13 }}>
                {row.company_context}
              </Typography.Paragraph>
            ) : (
              <Empty
                description={
                  canEdit
                    ? "None yet. Add it in Edit profile — the research prompt is there."
                    : "None recorded."
                }
              />
            )}
          </Card>
        </Col>
      </Row>

    </>
  );
}
