"use client";

import {
  ChromeOutlined,
  DeleteOutlined,
  ExportOutlined,
  InboxOutlined,
  PlusOutlined,
  RobotOutlined,
  RollbackOutlined,
  SearchOutlined,
  SnippetsOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Col,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Row,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  archiveJobs,
  deleteJob,
  generateForJobs,
  importJobs,
  jobDescription,
  saveJob,
} from "@/app/dashboard/jobs/actions";
import { PageHeader } from "@/components/page-header";
import { MAX_RUNNING_JOBS } from "@/lib/ai/defaults";
import { MAX_JOB_DESCRIPTION } from "@/lib/jobs/fields";
import { TEMPLATES } from "@/lib/pdf/templates";
import { useProfileStyle } from "@/lib/profile-style";

export type BoardJob = {
  id: string;
  /** "J007" */
  no: string;
  title: string;
  company: string | null;
  url: string | null;
  archived: boolean;
  createdAt: string;
  /** The newest resume for the chosen profile. */
  resume: {
    id: string;
    status: "queued" | "running" | "ready" | "failed";
    valid: boolean | null;
    error: string | null;
    tracked: boolean;
  } | null;
  /** Every application made from it — "mine" when for the chosen profile. */
  applications: Array<{ no: string; status: string; mine: boolean }>;
};

type Props = {
  /** Whose saved styles to use — they're kept per person and per profile. */
  userId: string;
  profiles: Array<{ id: string; name: string }>;
  profileId: string | null;
  openJobId: string | null;
  jobs: BoardJob[];
};

type Draft = { id: string | null; title: string; company: string; url: string; description: string };

const BLANK: Draft = { id: null, title: "", company: "", url: "", description: "" };

function ResumeTag({ resume }: { resume: BoardJob["resume"] }) {
  if (!resume) return <Typography.Text type="secondary">—</Typography.Text>;
  if (resume.tracked) return <Tag color="green" bordered={false}>Applied</Tag>;
  if (resume.status === "queued") return <Tag bordered={false}>Waiting</Tag>;
  if (resume.status === "running") {
    return (
      <Tag icon={<SyncOutlined spin />} color="processing" bordered={false}>
        Generating
      </Tag>
    );
  }
  if (resume.status === "failed") {
    return (
      <Tooltip title={resume.error}>
        <Tag color="red" bordered={false}>Failed</Tag>
      </Tooltip>
    );
  }
  return resume.valid ? (
    <Tag color="blue" bordered={false}>Ready</Tag>
  ) : (
    <Tooltip title="Open it in the builder to fix what didn't validate.">
      <Tag color="orange" bordered={false}>Needs a fix</Tag>
    </Tooltip>
  );
}

/**
 * Your jobs: the postings you apply to, numbered J001, J002… — an
 * application made from one carries the same number (A007 for J007).
 *
 * The list on the left, the job you're editing on the right: click a row to
 * open it, or start a new one and keep adding — the form clears after each.
 * Tick jobs to generate their resumes in a batch (six at once, the rest wait
 * their turn on the server) or to archive them.
 */
export function JobsBoard({ userId, profiles, profileId, openJobId, jobs }: Props) {
  const router = useRouter();
  const { message } = App.useApp();

  // Arriving with ?job=…: that one is open, in whichever list it's on.
  const [arrival] = useState(() => jobs.find((j) => j.id === openJobId) ?? null);
  const [filter, setFilter] = useState<"active" | "archived">(arrival?.archived ? "archived" : "active");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [regenerate, setRegenerate] = useState(false);
  const [generating, setGenerating] = useState(false);
  // The chosen profile's style from the builder — a batch renders in it, so
  // one setting rules both, profile by profile.
  const [preset] = useProfileStyle(userId, profileId);
  // A template picked here is for this profile's batch; another profile
  // starts from its own.
  const [picked, setPicked] = useState<{ profileId: string | null; template: string } | null>(null);
  const template = picked?.profileId === profileId ? picked.template : null;
  const setTemplate = (next: string) => setPicked({ profileId, template: next });
  const chosenTemplate = template ?? (TEMPLATES.some((t) => t.id === preset.template) ? preset.template : "banner");

  const [draft, setDraft] = useState<Draft>(() =>
    arrival
      ? { id: arrival.id, title: arrival.title, company: arrival.company ?? "", url: arrival.url ?? "", description: "" }
      : BLANK,
  );
  const [loadingDraft, setLoadingDraft] = useState(Boolean(arrival));
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement | null>(null);

  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasting, setPasting] = useState(false);
  const [pasteProblems, setPasteProblems] = useState<string[]>([]);

  const openJob = draft.id ? jobs.find((j) => j.id === draft.id) ?? null : null;
  const profileName = profiles.find((p) => p.id === profileId)?.name ?? null;
  const counts = { active: jobs.filter((j) => !j.archived).length, archived: jobs.filter((j) => j.archived).length };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase().replace(/^j0*/, "");
    return jobs.filter((j) => {
      if ((filter === "archived") !== j.archived) return false;
      if (!q) return true;
      return (
        j.no.toLowerCase().replace(/^j0*/, "").startsWith(q) ||
        j.title.toLowerCase().includes(q) ||
        (j.company ?? "").toLowerCase().includes(q) ||
        j.applications.some((a) => a.no.toLowerCase().replace(/^a0*/, "").startsWith(q))
      );
    });
  }, [jobs, filter, search]);

  const busy = jobs.filter((j) => j.resume && (j.resume.status === "queued" || j.resume.status === "running")).length;

  // Follow a running batch: re-read the list every few seconds until it's done.
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [busy, router]);

  /** Fills in a job's description, which the list doesn't carry. */
  const loadDescription = (id: string) =>
    jobDescription(id).then((description) => {
      setLoadingDraft(false);
      setDraft((d) => (d.id === id ? { ...d, description: description ?? "" } : d));
    });

  const open = (job: BoardJob) => {
    setDraft({ id: job.id, title: job.title, company: job.company ?? "", url: job.url ?? "", description: "" });
    setLoadingDraft(true);
    void loadDescription(job.id);
  };

  // Once, for the job the page was opened on.
  const arrivalId = arrival?.id ?? null;
  useEffect(() => {
    if (!arrivalId) return;
    jobDescription(arrivalId).then((description) => {
      setLoadingDraft(false);
      setDraft((d) => (d.id === arrivalId ? { ...d, description: description ?? "" } : d));
    });
  }, [arrivalId]);

  const startNew = () => {
    setDraft(BLANK);
    setTimeout(() => titleRef.current?.focus(), 0);
  };

  const save = async () => {
    setSaving(true);
    const result = await saveJob(draft);
    setSaving(false);
    if (!result.ok) {
      message.error(result.error);
      return;
    }
    if (draft.id) {
      message.success(`${result.no} saved.`);
    } else if (result.existed) {
      message.info(`That description is already on your list as ${result.no}.`);
      setDraft({ ...draft, id: result.id });
    } else {
      message.success(`${result.no} added — add the next one.`);
      startNew();
    }
    router.refresh();
  };

  const generate = async () => {
    if (!profileId) return;
    setGenerating(true);
    const result = await generateForJobs({
      profileId,
      jobIds: selected,
      template: chosenTemplate,
      style: preset.style,
      regenerate,
    });
    setGenerating(false);
    if (!result.ok) {
      message.error(result.error);
      return;
    }
    const parts = [
      result.started ? `${result.started} generating` : null,
      result.queued ? `${result.queued} waiting their turn` : null,
      result.skipped ? `${result.skipped} already done (tick "Regenerate" to redo)` : null,
    ].filter(Boolean);
    message.success(parts.join(", ") + ".");
    setSelected([]);
    router.refresh();
  };

  const archive = async (ids: string[], archived: boolean) => {
    const result = await archiveJobs(ids, archived);
    if (!result.ok) {
      message.error(result.error);
      return;
    }
    message.success(`${result.count} ${result.count === 1 ? "job" : "jobs"} ${archived ? "archived" : "restored"}.`);
    setSelected([]);
    router.refresh();
  };

  const remove = async (job: BoardJob) => {
    const result = await deleteJob(job.id);
    if (!result.ok) {
      message.error(result.error);
      return;
    }
    message.success(`${job.no} deleted.`);
    startNew();
    router.refresh();
  };

  const paste = async () => {
    setPasting(true);
    const result = await importJobs(pasteText);
    setPasting(false);
    if (!result.ok) {
      message.error(result.error);
      return;
    }
    const said = [
      result.added ? `${result.added} added` : null,
      result.existing ? `${result.existing} already on your list` : null,
    ].filter(Boolean);
    if (said.length) message.success(said.join(", ") + ".");
    setPasteProblems(result.problems);
    if (!result.problems.length) {
      setPasteOpen(false);
      setPasteText("");
    }
    router.refresh();
  };

  const selectedJobs = jobs.filter((j) => selected.includes(j.id));

  return (
    <>
      <PageHeader
        title="Jobs"
        description="The postings you apply to. Each gets a number — J007 — that its application shares (A007)."
        extra={
          <>
            <Tooltip title="The side panel for applying: this list, beside any job site">
              <Button icon={<ChromeOutlined />} href="https://extension.trueward.guru" target="_blank" rel="noreferrer">
                Chrome extension
              </Button>
            </Tooltip>
            <Button icon={<SnippetsOutlined />} onClick={() => setPasteOpen(true)}>
              Paste from a spreadsheet
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={startNew}>
              New job
            </Button>
          </>
        }
      />

      <Row gutter={[16, 16]}>
        <Col xs={{ span: 24, order: 2 }} xl={{ span: 15, order: 1 }}>
          <Card variant="borderless" styles={{ body: { padding: 0 } }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", padding: 16 }}>
              <Input
                allowClear
                prefix={<SearchOutlined />}
                placeholder="J007, A007, title or company"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ width: 240 }}
              />
              <Segmented
                value={filter}
                onChange={(v) => {
                  setFilter(v as "active" | "archived");
                  setSelected([]);
                }}
                options={[
                  { value: "active", label: `To apply · ${counts.active}` },
                  { value: "archived", label: `Archived · ${counts.archived}` },
                ]}
              />
              <div style={{ flex: 1 }} />
              <Space size={6}>
                <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                  Resumes for
                </Typography.Text>
                <Select
                  style={{ minWidth: 190 }}
                  placeholder="Profile"
                  value={profileId ?? undefined}
                  options={profiles.map((p) => ({ value: p.id, label: p.name }))}
                  onChange={(id) => router.push(`/dashboard/jobs?profile=${id}`)}
                  showSearch
                  optionFilterProp="label"
                />
              </Space>
            </div>

            {selected.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 10,
                  margin: "0 16px 12px",
                  padding: "10px 12px",
                  borderRadius: 10,
                  background: "#eef2ff",
                }}
              >
                <Typography.Text strong>{selected.length} selected</Typography.Text>
                {filter === "active" ? (
                  <>
                    <Select
                      style={{ width: 140 }}
                      value={chosenTemplate}
                      onChange={setTemplate}
                      options={TEMPLATES.map((t) => ({ value: t.id, label: t.label }))}
                    />
                    <Checkbox checked={regenerate} onChange={(e) => setRegenerate(e.target.checked)}>
                      Regenerate
                    </Checkbox>
                    <Tooltip title={profileName ? `For ${profileName}, ${MAX_RUNNING_JOBS} at a time` : "Choose a profile"}>
                      <Button type="primary" icon={<RobotOutlined />} loading={generating} disabled={!profileId} onClick={generate}>
                        Generate resumes
                      </Button>
                    </Tooltip>
                    <Button icon={<InboxOutlined />} onClick={() => archive(selected, true)}>
                      Archive
                    </Button>
                  </>
                ) : (
                  <Button icon={<RollbackOutlined />} onClick={() => archive(selected, false)}>
                    Restore
                  </Button>
                )}
                <Button type="text" onClick={() => setSelected([])}>
                  Clear
                </Button>
                {selectedJobs.some((j) => !j.company || !j.url) && (
                  <Typography.Text type="warning" style={{ fontSize: 12 }}>
                    Some have no company or link — add them before applying.
                  </Typography.Text>
                )}
              </div>
            )}

            {busy > 0 && (
              <Typography.Paragraph type="secondary" style={{ margin: "0 16px 12px", fontSize: 13 }}>
                <SyncOutlined spin /> {busy} {busy === 1 ? "resume" : "resumes"} in progress — this list follows along.
              </Typography.Paragraph>
            )}
            {!profiles.length && (
              <Alert
                type="info"
                showIcon
                style={{ margin: "0 16px 12px" }}
                title="No profile to generate for"
                description="Resumes are generated for a profile assigned to you."
              />
            )}

            <Table<BoardJob>
              rowKey="id"
              size="middle"
              dataSource={visible}
              pagination={visible.length > 50 ? { pageSize: 50, showSizeChanger: false } : false}
              rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as string[]) }}
              onRow={(job) => ({ onClick: () => open(job), style: { cursor: "pointer" } })}
              rowClassName={(job) => (job.id === draft.id ? "ant-table-row-selected" : "")}
              locale={{
                emptyText: (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                      search
                        ? "Nothing matches that."
                        : filter === "archived"
                          ? "Nothing archived."
                          : "No jobs yet — add one on the right, or paste rows from a spreadsheet."
                    }
                  />
                ),
              }}
              scroll={{ x: 640 }}
              columns={[
                {
                  title: "No.",
                  dataIndex: "no",
                  width: 76,
                  render: (no: string) => <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{no}</span>,
                },
                {
                  title: "Job",
                  key: "job",
                  render: (_, j) => (
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 500 }}>{j.title}</div>
                      <Typography.Text type={j.company ? "secondary" : "warning"} style={{ fontSize: 12 }}>
                        {j.company ?? "No company yet"}
                      </Typography.Text>
                    </div>
                  ),
                },
                { title: "Resume", key: "resume", width: 120, render: (_, j) => <ResumeTag resume={j.resume} /> },
                {
                  title: "Applied",
                  key: "applications",
                  width: 140,
                  render: (_, j) =>
                    j.applications.length ? (
                      <Space size={4} wrap>
                        {j.applications.map((a) => (
                          <Tooltip key={a.no} title={`${a.status}${a.mine ? "" : " · another profile"} — open in Applications`}>
                            <Link href={`/dashboard/applications?q=${a.no}`} onClick={(e) => e.stopPropagation()}>
                              <Tag color={a.mine ? "green" : undefined} bordered={false} style={{ marginInlineEnd: 0 }}>
                                {a.no}
                              </Tag>
                            </Link>
                          </Tooltip>
                        ))}
                      </Space>
                    ) : (
                      <Typography.Text type="secondary">—</Typography.Text>
                    ),
                },
                {
                  title: "",
                  key: "link",
                  width: 44,
                  render: (_, j) =>
                    j.url ? (
                      <Tooltip title="Open the posting">
                        <a href={j.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                          <ExportOutlined />
                        </a>
                      </Tooltip>
                    ) : null,
                },
              ]}
            />
          </Card>
        </Col>

        <Col xs={{ span: 24, order: 1 }} xl={{ span: 9, order: 2 }}>
          <div style={{ position: "sticky", top: 76 }}>
            <Card
              variant="borderless"
              title={openJob ? `${openJob.no} · ${openJob.title}` : draft.id ? "Job" : "New job"}
              extra={
                draft.id ? (
                  <Button size="small" icon={<PlusOutlined />} onClick={startNew}>
                    New
                  </Button>
                ) : null
              }
              styles={{ title: { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }}
            >
              <div
                style={{ display: "flex", flexDirection: "column", gap: 10 }}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void save();
                }}
              >
                <Input
                  ref={(el) => {
                    titleRef.current = el?.input ?? null;
                  }}
                  placeholder="Job title"
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                />
                <Input
                  placeholder="Company"
                  value={draft.company}
                  onChange={(e) => setDraft({ ...draft, company: e.target.value })}
                />
                <Input
                  placeholder="Link to the posting — https://…"
                  value={draft.url}
                  onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                />
                <Input.TextArea
                  placeholder={loadingDraft ? "Loading…" : "Paste the job description"}
                  disabled={loadingDraft}
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  autoSize={{ minRows: 8, maxRows: 16 }}
                  maxLength={MAX_JOB_DESCRIPTION}
                  showCount={draft.description.length > MAX_JOB_DESCRIPTION * 0.8}
                />
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <Tooltip title="Ctrl + Enter">
                    <Button type="primary" loading={saving} disabled={loadingDraft} onClick={save}>
                      {draft.id ? "Save" : "Add job"}
                    </Button>
                  </Tooltip>
                  {openJob?.url && (
                    <Button icon={<ExportOutlined />} href={openJob.url} target="_blank" rel="noreferrer">
                      Posting
                    </Button>
                  )}
                  {openJob && (
                    <Button
                      icon={openJob.archived ? <RollbackOutlined /> : <InboxOutlined />}
                      onClick={() => archive([openJob.id], !openJob.archived)}
                    >
                      {openJob.archived ? "Restore" : "Archive"}
                    </Button>
                  )}
                  {openJob && (
                    <Popconfirm
                      title={`Delete ${openJob.no}?`}
                      description="Its drafts go with it."
                      okText="Delete"
                      okButtonProps={{ danger: true }}
                      disabled={openJob.applications.length > 0}
                      onConfirm={() => remove(openJob)}
                    >
                      <Tooltip title={openJob.applications.length ? "It has applications — archive it instead." : undefined}>
                        <Button danger icon={<DeleteOutlined />} disabled={openJob.applications.length > 0} />
                      </Tooltip>
                    </Popconfirm>
                  )}
                </div>

                {openJob && (
                  <div
                    style={{
                      marginTop: 6,
                      padding: "12px 14px",
                      borderRadius: 10,
                      background: "#f8fafc",
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      fontSize: 13,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <span>
                        Resume{profileName ? ` for ${profileName}` : ""}: <ResumeTag resume={openJob.resume} />
                      </span>
                      {openJob.resume?.status === "ready" && (
                        <Link href={`/dashboard/resumes?job=${openJob.resume.id}`}>Open in builder</Link>
                      )}
                    </div>
                    <div>
                      Applications:{" "}
                      {openJob.applications.length ? (
                        openJob.applications.map((a) => (
                          <Tag key={a.no} color={a.mine ? "green" : undefined} bordered={false}>
                            {a.no} · {a.status}
                          </Tag>
                        ))
                      ) : (
                        <Typography.Text type="secondary">none yet — it becomes A{openJob.no.slice(1)}</Typography.Text>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </Card>
          </div>
        </Col>
      </Row>

      <Modal
        title="Paste jobs from a spreadsheet"
        open={pasteOpen}
        onCancel={() => setPasteOpen(false)}
        onOk={paste}
        okText="Add jobs"
        confirmLoading={pasting}
        okButtonProps={{ disabled: !pasteText.trim() }}
        width={640}
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
          Select the rows in Google Sheets or Excel, copy, and paste them here. With a header row, columns are
          found by name — <b>Title</b>, <b>Company</b>, <b>URL</b>, <b>JD</b>; without one they&apos;re read in that
          order. A No column is ignored: jobs are numbered for you.
        </Typography.Paragraph>
        <Input.TextArea
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          autoSize={{ minRows: 8, maxRows: 16 }}
          placeholder={"Title\tCompany\tURL\tJD\nBackend Engineer\tAcme\thttps://…\tWe're looking for…"}
          style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}
        />
        {pasteProblems.length > 0 && (
          <Alert
            type="warning"
            showIcon
            style={{ marginTop: 12 }}
            title="Some rows weren't added"
            description={
              <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                {pasteProblems.slice(0, 12).map((p) => (
                  <li key={p}>{p}</li>
                ))}
                {pasteProblems.length > 12 && <li>…and {pasteProblems.length - 12} more</li>}
              </ul>
            }
          />
        )}
      </Modal>
    </>
  );
}
