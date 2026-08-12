"use client";

import {
  DownloadOutlined,
  SaveOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
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
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  DEFAULT_STYLE,
  ResumeStyleToolbar,
} from "@/components/resume-style-toolbar";
import {
  EXAMPLE_DOCUMENT,
  EXAMPLE_PROFILE_ID,
} from "@/lib/document/example";
import {
  contentSchema,
  fieldErrors,
  formatMonthYear,
  monthYearKey,
  resumeDocumentSchema,
  type ResumeProfile,
} from "@/lib/document/schema";
import { downloadResumePdf, renderResumePdfUrl } from "@/lib/pdf/resume-pdf";
import { headerSegments, resolveHeaderFields } from "@/lib/resume-header";
import type { TemplateSpec } from "@/lib/pdf/templates";
import { usePersistentState } from "@/lib/persistent-state";
import { coerceChoice } from "@/lib/style-access";
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
  templates: TemplateSpec[];
  accents: string[];
};

/**
 * Both panels are pinned to the viewport rather than growing with content.
 *
 * The editor and the preview are read against each other, so a page that grows
 * downwards means scrolling to compare the two. Fixed height, scroll inside.
 * The offset covers the dashboard's padding, the page header and the toolbar.
 */
const PANEL_HEIGHT = "calc(100dvh - 236px)";

/** Template and styling, remembered together so they can't fall out of step. */
type Preset = { template: string; style: ResumeStyle };

const STYLE_STORAGE_KEY = "tw.resume.style";

const DEFAULT_PRESET: Preset = { template: "classic", style: DEFAULT_STYLE };

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

export function ResumeBuilder({
  profiles,
  documents,
  teamId,
  userId,
  templates,
  accents,
}: Props) {
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
  /**
   * Styling survives navigation.
   *
   * It is a working preference, not a property of any one resume — you settle
   * on a template and a leading you like and then produce several documents
   * with it. Resetting to defaults on every visit meant redoing that each time.
   *
   * Opening a saved resume still overrides this with that document's own style,
   * and doing so updates the remembered preference, which is the behaviour you
   * want: the last thing you looked at is where you carry on from.
   */
  const [preset, setPreset] = usePersistentState<Preset>(
    STYLE_STORAGE_KEY,
    DEFAULT_PRESET,
  );
  /**
   * Snapped inside the allowance before use. The preset is remembered in
   * localStorage and a saved resume carries its own, so either can name a
   * template or accent this account is no longer offered — rendering the old
   * one would show something the picker cannot represent.
   */
  const template = useMemo(
    () =>
      coerceChoice(
        preset.template,
        templates.map((t) => t.id),
        DEFAULT_PRESET.template,
      ),
    [preset.template, templates],
  );

  /**
   * Memoised, not just computed. The preview effect below depends on this
   * object, so a fresh one each render would reset its debounce timer on every
   * render — including renders that had nothing to do with styling — and the
   * PDF would only ever appear during a lull.
   */
  const style: ResumeStyle = useMemo(
    () => ({
      ...preset.style,
      accent: coerceChoice(preset.style.accent, accents, accents[0]),
    }),
    [preset.style, accents],
  );
  const setTemplate = (next: string) => setPreset((p) => ({ ...p, template: next }));
  const setStyle = (next: ResumeStyle | ((previous: ResumeStyle) => ResumeStyle)) =>
    setPreset((p) => ({
      ...p,
      style: typeof next === "function" ? next(p.style) : next,
    }));

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
    // One write rather than two, so the persisted preset never briefly holds a
    // document's template against the previous style.
    setPreset({
      template: doc?.template ?? DEFAULT_PRESET.template,
      style: { ...DEFAULT_STYLE, ...(doc?.style ?? {}) },
    });
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

    /**
     * Unresolvable employmentIds get their own branch rather than joining the
     * generic error list.
     *
     * It is by far the most common failure — a model writes whatever id it
     * likes unless told the profile's — and it is the one with an obvious fix,
     * so it earns a specific message and a remap action instead of four
     * identical "unknown employmentId" lines.
     */
    const known = new Set(selectedProfile.profile.employments.map((e) => e.id));
    const unknown = content.data.experiences
      .map((x) => x.employmentId)
      .filter((id) => !known.has(id));

    if (unknown.length) {
      return {
        kind: "idmismatch" as const,
        unknown,
        expected: [...known],
        // Positional remap is only meaningful when the two lists line up.
        remappable: content.data.experiences.length === known.size,
      };
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

  /**
   * The preview is the real PDF, re-rendered as you type.
   *
   * Debounced because each render allocates a document and a blob URL; 250ms
   * keeps typing smooth while still feeling live for a slider drag. The
   * setState happens inside the timer rather than in the effect body, which is
   * both what makes the debounce work and what keeps this out of a cascading
   * render.
   *
   * Every URL is revoked — on replacement and on unmount — or a long editing
   * session leaks one document per keystroke.
   */
  const [preview, setPreview] = useState<{ url: string; sig: string } | null>(
    null,
  );

  const validDocument = parsed.kind === "ok" ? parsed.document : null;

  // Everything that changes the output. Comparing against the signature the
  // current blob was rendered from is what tells us whether it is still
  // current — derived rather than cleared from inside the effect, which would
  // be a setState cascade on every keystroke.
  const sig = validDocument ? `${template}|${JSON.stringify(style)}|${json}` : "";
  const previewUrl = preview?.sig === sig ? preview.url : null;

  useEffect(() => {
    if (!validDocument) return;

    let stale = false;

    const timer = setTimeout(() => {
      renderResumePdfUrl(validDocument, style, template)
        .then((url) => {
          // The inputs changed while this render was in flight.
          if (stale) {
            URL.revokeObjectURL(url);
            return;
          }
          setPreview((previous) => {
            if (previous) URL.revokeObjectURL(previous.url);
            return { url, sig };
          });
        })
        .catch(() => {
          // A document that validated should always render; if it somehow
          // doesn't, the panel shows its spinner rather than breaking.
        });
    }, 250);

    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [validDocument, style, template, sig]);

  // Release the last blob when the page goes away; the effect above only
  // revokes on replacement, so without this the final one outlives the view.
  useEffect(
    () => () => {
      setPreview((previous) => {
        if (previous) URL.revokeObjectURL(previous.url);
        return null;
      });
    },
    [],
  );

  const employmentIds = selectedProfile?.profile?.employments.map((e) => e.id) ?? [];

  /**
   * Seeds the editor with a content skeleton for the selected profile.
   *
   * The employmentIds are the part worth generating: they must match the
   * profile exactly and be ordered most-recent-first, and getting either wrong
   * is the most common reason a pasted document won't validate. Everything else
   * is obvious placeholder prose to be replaced or pasted over.
   */
  /** Profile employments, newest first — the order experiences must follow. */
  const orderedEmployments = useMemo(
    () =>
      [...(selectedProfile?.profile?.employments ?? [])].sort(
        (a, b) => monthYearKey(b.startDate) - monthYearKey(a.startDate),
      ),
    [selectedProfile],
  );

  /**
   * Rewrites the pasted experiences' ids onto the profile's, by position.
   *
   * Positional, because that is the only correspondence available — the ids
   * don't match, so there is nothing to match *on*. It is offered only when the
   * counts are equal, and the mapping is shown before it is applied, because
   * getting it wrong attaches someone's bullets to the wrong employer.
   */
  const remapIds = () => {
    try {
      const value = JSON.parse(unfence(json));
      value.experiences = (value.experiences ?? []).map(
        (x: { employmentId: string }, i: number) => ({
          ...x,
          employmentId: orderedEmployments[i]?.id ?? x.employmentId,
        }),
      );
      setJson(JSON.stringify(value, null, 2));
      message.success("Ids remapped to this profile.");
    } catch {
      message.error("Couldn't rewrite the JSON.");
    }
  };

  const startFromProfile = () => {
    if (!selectedProfile?.profile) return;

    setJson(
      JSON.stringify(
        {
          targetTitle: "Target role",
          summary: "One paragraph on how this candidate fits the role.",
          skills: [{ name: "Category", items: ["Skill"] }],
          experiences: orderedEmployments.map((e) => ({
            employmentId: e.id,
            title: "Role title",
            bullets: [{ text: `What they did at ${e.company}, with a metric.` }],
          })),
        },
        null,
        2,
      ),
    );
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

      <ResumeStyleToolbar
        template={template}
        style={style}
        templates={templates}
        accents={accents}
        onTemplateChange={setTemplate}
        onStyleChange={setStyle}
      />

      <Row gutter={16}>
        <Col xs={24} lg={10}>
          <Card
            title="Content"
            size="small"
            styles={{
              body: { height: PANEL_HEIGHT, overflowY: "auto" },
            }}
          >
            <Space orientation="vertical" style={{ width: "100%" }} size="middle">
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
                  title="You're looking at the demo profile"
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
                  title="This profile can't be used"
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
                  title={
                    <Space size={4} wrap>
                      <Typography.Text style={{ fontSize: 12 }}>
                        Your model must use these employment ids:
                      </Typography.Text>
                      {employmentIds.map((id) => (
                        <Tag key={id} style={{ margin: 0 }}>
                          {id}
                        </Tag>
                      ))}
                    </Space>
                  }
                />
              )}

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Tailored content
                </Typography.Text>
                <Space size={4}>
                  <Tooltip title="Fill in the skeleton — employment ids in the right order, ready to edit or paste over">
                    <Button
                      size="small"
                      type="text"
                      icon={<ThunderboltOutlined />}
                      disabled={!selectedProfile?.profile}
                      onClick={startFromProfile}
                    >
                      Start from profile
                    </Button>
                  </Tooltip>
                  {json && (
                    <Button size="small" type="text" onClick={() => setJson("")}>
                      Clear
                    </Button>
                  )}
                </Space>
              </div>

              <Input.TextArea
                rows={14}
                value={json}
                onChange={(e) => setJson(e.target.value)}
                placeholder='{ "targetTitle": "…", "summary": "…", "skills": [], "experiences": [] }'
                style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}
              />

              {parsed.kind === "noprofile" && (
                <Alert type="info" showIcon title="Choose a profile to begin." />
              )}
              {parsed.kind === "empty" && (
                <Alert
                  type="info"
                  showIcon
                  title="Paste your model's content JSON, or press “Start from profile”."
                  description="Until then the preview shows what the profile already knows — identity, employers and dates."
                />
              )}
              {parsed.kind === "syntax" && (
                <Alert
                  type="error"
                  showIcon
                  title="Not valid JSON"
                  description={parsed.message}
                />
              )}
              {parsed.kind === "idmismatch" && (
                <Alert
                  type="warning"
                  showIcon
                  title="These employment ids aren't on this profile"
                  description={
                    <>
                      <Typography.Paragraph style={{ marginBottom: 8 }}>
                        Your JSON is otherwise fine. Experiences are linked to
                        employers by id, and these don&apos;t resolve:
                      </Typography.Paragraph>
                      <div style={{ marginBottom: 8 }}>
                        {parsed.unknown.map((id) => (
                          <Tag key={id} color="red">
                            {id}
                          </Tag>
                        ))}
                      </div>
                      <Typography.Paragraph style={{ marginBottom: 8 }}>
                        This profile defines:
                      </Typography.Paragraph>
                      <div style={{ marginBottom: 12 }}>
                        {parsed.expected.length ? (
                          parsed.expected.map((id) => (
                            <Tag key={id} color="blue">
                              {id}
                            </Tag>
                          ))
                        ) : (
                          <Typography.Text type="secondary">
                            none — this profile has no employment recorded yet
                          </Typography.Text>
                        )}
                      </div>
                      {parsed.remappable ? (
                        <Tooltip
                          title={orderedEmployments
                            .map((e, i) => `${i + 1}. → ${e.id} (${e.company})`)
                            .join("   ")}
                        >
                          <Button size="small" type="primary" onClick={remapIds}>
                            Remap in order
                          </Button>
                        </Tooltip>
                      ) : (
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          Edit the ids above to match, or fix the profile&apos;s
                          employment entries.
                        </Typography.Text>
                      )}
                    </>
                  }
                />
              )}
              {parsed.kind === "invalid" && (
                <Alert
                  type="error"
                  showIcon
                  title="Doesn't match the schema"
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
                <Alert type="success" showIcon title="Valid — ready to download." />
              )}
            </Space>
          </Card>
        </Col>

        <Col xs={24} lg={14}>
          <Card
            title="Preview"
            size="small"
            extra={
              parsed.kind === "ok" && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {template} · {style.accent ?? "slate"} ·{" "}
                  {style.fontScale ?? 100}%
                </Typography.Text>
              )
            }
            styles={{
              body: {
                height: PANEL_HEIGHT,
                overflowY: "auto",
                // The sheet reads as paper against the dashboard's grey.
                background: "#fafafa",
              },
            }}
          >
            {parsed.kind === "ok" ? (
              previewUrl ? (
                <iframe
                  // Keyed on the URL so the viewer reloads rather than caching
                  // the previous document.
                  key={previewUrl}
                  src={`${previewUrl}#toolbar=0&navpanes=0&view=FitH`}
                  title="Resume preview"
                  style={{ width: "100%", height: "100%", border: 0 }}
                />
              ) : (
                <div
                  style={{ height: "100%", display: "grid", placeItems: "center" }}
                >
                  <Spin description="Rendering…" />
                </div>
              )
            ) : selectedProfile?.profile ? (
              /*
               * Identity and employment history come from the profile, so they
               * can be shown the moment one is picked. Waiting for valid
               * content to render anything at all made a correctly-working page
               * look broken — you pick a candidate and stare at an empty box.
               */
              <ProfileOnlyPreview
                profile={selectedProfile.profile}
                style={style}
              />
            ) : (
              <div
                style={{ height: "100%", display: "grid", placeItems: "center" }}
              >
                <Empty description="Choose a profile to see it here." />
              </div>
            )}
          </Card>
        </Col>
      </Row>
    </>
  );
}

const SHEET: React.CSSProperties = {
  background: "#fff",
  padding: "24px 28px",
  border: "1px solid #eef0f2",
  borderRadius: 6,
};

/**
 * The resume before any content exists: everything the profile already knows.
 *
 * The greyed placeholders are the shape of what's missing, which is more useful
 * than a blank panel — you can see at a glance that the identity and dates are
 * right before spending a model call on the positioning.
 */
function ProfileOnlyPreview({
  profile,
  style,
}: {
  profile: ResumeProfile;
  style: ResumeStyle;
}) {
  const employments = [...profile.employments].sort(
    (a, b) => monthYearKey(b.startDate) - monthYearKey(a.startDate),
  );

  return (
    <div style={SHEET}>
      <Typography.Title level={4} style={{ marginBottom: 0 }}>
        {profile.fullName}
      </Typography.Title>
      <Typography.Text type="secondary" italic>
        Target role — from your content JSON
      </Typography.Text>

      <div style={{ marginTop: 4 }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {/* Same builder the PDF uses, so the header settings behave
              identically here and in the rendered document. */}
          {headerSegments(profile.contact, resolveHeaderFields(style.header))
            .map((s) => s.text)
            .join("  ·  ")}
        </Typography.Text>
      </div>

      <Divider style={{ margin: "12px 0" }} />
      <Typography.Paragraph type="secondary" italic style={{ marginBottom: 8 }}>
        Summary, skills and bullet points come from the content JSON on the
        left. Everything below is already on file.
      </Typography.Paragraph>

      {employments.length > 0 && (
        <>
          <Typography.Text strong>Experience</Typography.Text>
          {employments.map((e) => (
            <div key={e.id} style={{ margin: "8px 0 12px" }}>
              <Typography.Text>{e.company}</Typography.Text>
              <Tag style={{ marginLeft: 6 }}>{e.id}</Tag>
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {e.location ? `${e.location} · ` : ""}
                  {formatMonthYear(e.startDate)} –{" "}
                  {formatMonthYear(e.endDate ?? null, "Present")}
                </Typography.Text>
              </div>
            </div>
          ))}
        </>
      )}

      {profile.education.length > 0 && (
        <>
          <Divider style={{ margin: "12px 0" }} />
          <Typography.Text strong>Education</Typography.Text>
          {profile.education.map((e) => (
            <div key={`${e.school}-${e.degree}`} style={{ marginTop: 6 }}>
              <Typography.Text>{e.degree}</Typography.Text>
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {e.school}
                  {e.year ? ` · ${formatMonthYear(e.year)}` : ""}
                </Typography.Text>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

