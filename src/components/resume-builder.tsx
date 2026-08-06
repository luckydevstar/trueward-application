"use client";

import { CopyOutlined, DownloadOutlined, SaveOutlined } from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Divider,
  Empty,
  Input,
  Row,
  Segmented,
  Select,
  Slider,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import {
  EXAMPLE_DOCUMENT,
  EXAMPLE_PROFILE_ID,
} from "@/lib/document/example";
import {
  contentSchema,
  fieldErrors,
  formatMonthYear,
  renderedExperiences,
  resumeDocumentSchema,
  type ResumeDocument,
  type ResumeProfile,
} from "@/lib/document/schema";
import { downloadResumePdf } from "@/lib/pdf/resume-pdf";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/status";
import type { ResumeStyle } from "@/lib/supabase/types";

type ProfileOption = {
  id: string;
  fullName: string;
  profile: ResumeProfile | null;
  error: string | null;
};

type DocumentRow = {
  id: string;
  title: string;
  profile_id: string;
  content: unknown;
  template: string;
  style: ResumeStyle;
  updated_at: string;
};

type Props = {
  profiles: ProfileOption[];
  documents: DocumentRow[];
  teamId: string;
  userId: string;
};

const TEMPLATES = ["classic", "modern", "compact"];
const ACCENTS = ["slate", "blue", "emerald"];

const DEFAULT_STYLE: ResumeStyle = {
  fontScale: 100,
  headerPosition: "center",
  accent: "slate",
  lineSpacing: 1.4,
};

/** Strips the ```json fence a model wraps its output in. */
function unfence(value: string) {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

/**
 * The demo option, always last in the dropdown.
 *
 * With nothing assigned it is the only option and is selected on load, so the
 * page is explorable — style controls, preview and download all work — rather
 * than being an empty state that explains what you're missing. It cannot be
 * saved: there is no candidate_profile row for it to reference.
 */
const EXAMPLE_OPTION: ProfileOption = {
  id: EXAMPLE_PROFILE_ID,
  fullName: "Example candidate (demo)",
  profile: EXAMPLE_DOCUMENT.profile,
  error: null,
};

export function ResumeBuilder({ profiles, documents, teamId, userId }: Props) {
  const router = useRouter();
  const { message } = App.useApp();

  const options = useMemo(() => [...profiles, EXAMPLE_OPTION], [profiles]);

  // A real profile wins when one exists; the demo is the fallback, not the
  // default.
  const [profileId, setProfileId] = useState(
    profiles[0]?.id ?? EXAMPLE_PROFILE_ID,
  );
  const [documentId, setDocumentId] = useState("");
  const [title, setTitle] = useState("");
  const [json, setJson] = useState(() =>
    profiles.length ? "" : JSON.stringify(EXAMPLE_DOCUMENT.content, null, 2),
  );
  const [template, setTemplate] = useState("classic");
  const [style, setStyle] = useState<ResumeStyle>(DEFAULT_STYLE);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const selectedProfile = options.find((p) => p.id === profileId);
  const isExample = profileId === EXAMPLE_PROFILE_ID;
  const profileDocuments = documents.filter((d) => d.profile_id === profileId);

  const pickProfile = (id: string) => {
    setProfileId(id);
    // Documents belong to one profile; keeping a selection across a switch
    // would show content whose employmentIds can't resolve.
    setDocumentId("");
    setTitle("");
    // Switching *to* the demo prefills its content so it renders immediately;
    // switching to a real candidate clears it, because example bullets under
    // someone's real name is the wrong default.
    setJson(id === EXAMPLE_PROFILE_ID ? JSON.stringify(EXAMPLE_DOCUMENT.content, null, 2) : "");
  };

  const pickDocument = (id: string) => {
    const doc = profileDocuments.find((d) => d.id === id);
    setDocumentId(id);
    setTitle(doc?.title ?? "");
    setJson(doc ? JSON.stringify(doc.content, null, 2) : "");
    setTemplate(doc?.template ?? "classic");
    setStyle({ ...DEFAULT_STYLE, ...(doc?.style ?? {}) });
  };

  /**
   * Validation runs on every keystroke against the same schema the write path
   * uses, so Download can never be enabled for a document that wouldn't survive
   * being saved.
   */
  const parsed = useMemo(() => {
    if (!selectedProfile?.profile) {
      return { kind: "noprofile" as const };
    }

    const raw = unfence(json);
    if (!raw) return { kind: "empty" as const };

    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch (error) {
      return {
        kind: "syntax" as const,
        message: error instanceof Error ? error.message : "Invalid JSON",
      };
    }

    const content = contentSchema.safeParse(value);
    if (!content.success) {
      return { kind: "invalid" as const, errors: fieldErrors(content.error) };
    }

    // The document-level parse is the one that matters: it checks every
    // employmentId against the profile and rejects experiences that aren't
    // most-recent-first. contentSchema alone cannot see the profile.
    const doc = resumeDocumentSchema.safeParse({
      schemaVersion: 2,
      profile: selectedProfile.profile,
      content: content.data,
    });
    if (!doc.success) {
      return { kind: "invalid" as const, errors: fieldErrors(doc.error) };
    }
    return { kind: "ok" as const, document: doc.data };
  }, [json, selectedProfile]);

  const save = async () => {
    if (parsed.kind !== "ok") return;
    if (isExample) {
      message.info("The demo profile can't be saved. Pick a real candidate first.");
      return;
    }
    if (!title.trim()) {
      message.error("Give the resume a title.");
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const payload = {
      title: title.trim(),
      profile_id: profileId,
      content: parsed.document.content,
      template,
      style,
    };

    const { error } = documentId
      ? await supabase.from("resume_document").update(payload).eq("id", documentId)
      : await supabase
          .from("resume_document")
          .insert({ ...payload, team_id: teamId, created_by: userId });
    setSaving(false);

    if (error) {
      message.error(error.message);
      return;
    }
    message.success("Saved.");
    router.refresh();
  };

  const download = async () => {
    if (parsed.kind !== "ok") return;
    setDownloading(true);
    try {
      const saved = await downloadResumePdf(parsed.document, style, template);
      if (saved) message.success("Resume downloaded.");
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : "Could not create the PDF.",
      );
    } finally {
      setDownloading(false);
    }
  };

  const employmentIds = selectedProfile?.profile?.employments.map((e) => e.id) ?? [];

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
            Resume builder
          </Typography.Title>
          <Typography.Text type="secondary">
            Identity comes from the profile. Paste tailored content from your
            model, style it, download.
          </Typography.Text>
        </div>
        <Space>
          <Tooltip
            title={
              isExample
                ? "The demo profile has no database row to attach a resume to."
                : undefined
            }
          >
            <Button
              icon={<SaveOutlined />}
              onClick={save}
              loading={saving}
              disabled={parsed.kind !== "ok" || isExample}
            >
              {documentId ? "Save" : "Save as new"}
            </Button>
          </Tooltip>
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            onClick={download}
            loading={downloading}
            disabled={parsed.kind !== "ok"}
          >
            Download PDF
          </Button>
        </Space>
      </Space>

      <Row gutter={16}>
        <Col xs={24} lg={11}>
          <Card title="Content" size="small">
            <Space direction="vertical" style={{ width: "100%" }} size="middle">
              <div>
                <Typography.Text type="secondary">Profile</Typography.Text>
                <Select
                  style={{ width: "100%" }}
                  value={profileId || undefined}
                  onChange={pickProfile}
                  placeholder="Choose a candidate"
                  options={options.map((p) => ({
                    value: p.id,
                    label: p.error ? `${p.fullName} — unreadable` : p.fullName,
                    disabled: Boolean(p.error),
                  }))}
                />
              </div>

              {isExample && (
                <Alert
                  type="info"
                  showIcon
                  message="You're looking at the demo profile"
                  description={
                    profiles.length
                      ? "Pick a real candidate above to build something you can save."
                      : "No candidate has been assigned to you yet. Everything here works — style it, preview it, download the PDF — but saving needs a real profile. Ask an admin to assign one, or create one on the Profiles page."
                  }
                />
              )}

              {selectedProfile?.error && (
                <Alert
                  type="error"
                  showIcon
                  message="This profile can't be used"
                  description={selectedProfile.error}
                />
              )}

              {!isExample && (
                <>
                  <div>
                    <Typography.Text type="secondary">Saved resumes</Typography.Text>
                    <Select
                      style={{ width: "100%" }}
                      value={documentId || undefined}
                      placeholder="New resume"
                      onChange={pickDocument}
                      allowClear
                      onClear={() => pickDocument("")}
                      options={profileDocuments.map((d) => ({
                        value: d.id,
                        label: `${d.title} · ${formatDate(d.updated_at)}`,
                      }))}
                    />
                  </div>

                  <Input
                    placeholder="Title — e.g. “Acme, Staff Engineer”"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </>
              )}

              {employmentIds.length > 0 && (
                <Alert
                  type="info"
                  message={
                    <Space size={4} wrap>
                      <Typography.Text style={{ fontSize: 12 }}>
                        Reference employers by id:
                      </Typography.Text>
                      {employmentIds.map((id) => (
                        <Tag key={id} style={{ margin: 0 }}>
                          {id}
                        </Tag>
                      ))}
                      <Button
                        type="text"
                        size="small"
                        icon={<CopyOutlined />}
                        onClick={() => {
                          void navigator.clipboard.writeText(employmentIds.join(", "));
                          message.success("Ids copied.");
                        }}
                      />
                    </Space>
                  }
                />
              )}

              <Input.TextArea
                rows={16}
                value={json}
                onChange={(e) => setJson(e.target.value)}
                placeholder='{ "targetTitle": "…", "summary": "…", "skills": [], "experiences": [] }'
                style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}
              />

              {parsed.kind === "noprofile" && (
                <Alert type="info" showIcon message="Choose a profile to begin." />
              )}
              {parsed.kind === "empty" && (
                <Alert
                  type="info"
                  showIcon
                  message="Paste the tailored content JSON here."
                />
              )}
              {parsed.kind === "syntax" && (
                <Alert
                  type="error"
                  showIcon
                  message="Not valid JSON"
                  description={parsed.message}
                />
              )}
              {parsed.kind === "invalid" && (
                <Alert
                  type="error"
                  showIcon
                  message="Doesn't match the schema"
                  description={
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {parsed.errors.map((e) => (
                        <li key={`${e.path}-${e.message}`}>
                          <code>{e.path || "(root)"}</code> — {e.message}
                        </li>
                      ))}
                    </ul>
                  }
                />
              )}
              {parsed.kind === "ok" && (
                <Alert type="success" showIcon message="Valid — ready to download." />
              )}
            </Space>
          </Card>
        </Col>

        <Col xs={24} lg={13}>
          <Card title="Preview" size="small" style={{ marginBottom: 16 }}>
            {parsed.kind === "ok" ? (
              <Preview document={parsed.document} />
            ) : (
              <Empty description="A valid document renders here." />
            )}
          </Card>

          <Card title="Style" size="small">
            <Row gutter={[16, 12]}>
              <Col xs={24} sm={12}>
                <Typography.Text type="secondary">Template</Typography.Text>
                <Segmented
                  block
                  value={template}
                  onChange={(v) => setTemplate(String(v))}
                  options={TEMPLATES}
                />
              </Col>
              <Col xs={24} sm={12}>
                <Typography.Text type="secondary">Header</Typography.Text>
                <Segmented
                  block
                  value={style.headerPosition ?? "center"}
                  onChange={(v) =>
                    setStyle((s) => ({
                      ...s,
                      headerPosition: v as "left" | "center",
                    }))
                  }
                  options={["left", "center"]}
                />
              </Col>
              <Col xs={24} sm={12}>
                <Typography.Text type="secondary">Accent</Typography.Text>
                <Segmented
                  block
                  value={style.accent ?? "slate"}
                  onChange={(v) => setStyle((s) => ({ ...s, accent: String(v) }))}
                  options={ACCENTS}
                />
              </Col>
              <Col xs={24} sm={12}>
                <Typography.Text type="secondary">
                  Font size — {style.fontScale ?? 100}%
                </Typography.Text>
                <Slider
                  min={80}
                  max={120}
                  value={style.fontScale ?? 100}
                  onChange={(v) => setStyle((s) => ({ ...s, fontScale: v }))}
                />
              </Col>
              <Col xs={24} sm={12}>
                <Typography.Text type="secondary">
                  Line spacing — {style.lineSpacing ?? 1.4}
                </Typography.Text>
                <Slider
                  min={1.1}
                  max={1.8}
                  step={0.05}
                  value={style.lineSpacing ?? 1.4}
                  onChange={(v) => setStyle((s) => ({ ...s, lineSpacing: v }))}
                />
              </Col>
              <Col xs={24} sm={12}>
                <Button
                  size="small"
                  onClick={() => setStyle(DEFAULT_STYLE)}
                  style={{ marginTop: 22 }}
                >
                  Reset style
                </Button>
              </Col>
            </Row>
          </Card>
        </Col>
      </Row>
    </>
  );
}

/**
 * A readable rendering of the joined document — deliberately not a facsimile of
 * the PDF. Two renderers claiming to be pixel-identical drift, and the one that
 * matters is the one that produces the file.
 */
function Preview({ document }: { document: ResumeDocument }) {
  const experiences = renderedExperiences(document);
  const { profile, content } = document;

  return (
    <div style={{ maxHeight: "46vh", overflowY: "auto" }}>
      <Typography.Title level={4} style={{ marginBottom: 0 }}>
        {profile.fullName}
      </Typography.Title>
      <Typography.Text type="secondary">{content.targetTitle}</Typography.Text>

      <Divider style={{ margin: "12px 0" }} />
      <Typography.Paragraph>{content.summary}</Typography.Paragraph>

      {content.skills.length > 0 && (
        <>
          <Typography.Text strong>Skills</Typography.Text>
          {content.skills.map((group) => (
            <div key={group.name} style={{ margin: "6px 0" }}>
              <Typography.Text type="secondary">{group.name}: </Typography.Text>
              {group.items.map((item) => (
                <Tag key={item}>{item}</Tag>
              ))}
            </div>
          ))}
          <Divider style={{ margin: "12px 0" }} />
        </>
      )}

      {experiences.map(({ employment, title, bullets }) => (
        <div key={employment.id} style={{ marginBottom: 16 }}>
          <Typography.Text strong>{title}</Typography.Text>
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {employment.company}
              {employment.location ? ` · ${employment.location}` : ""} ·{" "}
              {formatMonthYear(employment.startDate)} –{" "}
              {formatMonthYear(employment.endDate ?? null, "Present")}
            </Typography.Text>
          </div>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {bullets.map((b, i) => (
              <li key={i}>{b.text}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
