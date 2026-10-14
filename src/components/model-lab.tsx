"use client";

import {
  ArrowLeftOutlined,
  CopyOutlined,
  ExperimentOutlined,
  FilePdfOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Empty,
  Input,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Tag,
  Typography,
} from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { loadLabRun } from "@/app/dashboard/generation/lab/actions";
import { DEFAULT_STYLE } from "@/components/resume-style-toolbar";
import { resumeDocumentSchema, type ResumeProfile } from "@/lib/document/schema";
import { renderResumePdfUrl } from "@/lib/pdf/resume-pdf";
import { usePersistentState } from "@/lib/persistent-state";
import { formatDate } from "@/lib/status";

/** What the API route returns for one model — GenerationOutcome, as JSON. */
type Outcome = {
  content: unknown;
  valid: boolean;
  problems: Array<{ path: string; message: string }>;
  error: string | null;
  attempts: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  costUsd: number | null;
  latencyMs: number;
};

type Slot =
  | { status: "running" }
  | { status: "done"; outcome: Outcome }
  | { status: "failed"; error: string };

export type LabHistoryRow = {
  run_id: string | null;
  model: string;
  ok: boolean;
  attempts: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cached_tokens: number | null;
  reasoning_tokens: number | null;
  cost_usd: number | null;
  latency_ms: number | null;
  prompt_label: string | null;
  reasoning: string | null;
  created_at: string;
};

type ModelOption = {
  id: string;
  price: { input: number; output: number; cacheRead: number; cacheWrite: number };
  reasoningMandatory: boolean;
  efforts: string[];
};

type Props = {
  configured: boolean;
  profiles: Array<{ id: string; fullName: string; profile: ResumeProfile }>;
  models: ModelOption[];
  savedPrompt: string;
  savedModel: string;
  savedReasoning: string;
  history: LabHistoryRow[];
  credit: { total: number; used: number } | null;
};

/** A sensible first comparison across the three families asked about. */
const STARTER_MODELS = [
  "anthropic/claude-haiku-5.5",
  "anthropic/claude-sonnet-5.5",
  "openai/gpt-6-luna",
  "openai/gpt-6.1-sol",
  "deepseek/deepseek-v4-flash",
  "deepseek/deepseek-v4-pro",
];
const NO_MODELS: string[] = [];

/** More than this at once is a mistake more often than a plan. */
const MAX_MODELS = 8;

const MONTHLY_VOLUME = 5000;

const REASONING_OPTIONS = [
  { value: "lowest", label: "Lowest each model allows" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "default", label: "Model default" },
];

const usd = (v: number | null | undefined, digits = 4) =>
  v === null || v === undefined ? "—" : `$${v.toFixed(digits)}`;
const n = (v: number | null | undefined) => (v ? v.toLocaleString() : "—");

/** Rough tokens for text: about four characters each. Good enough to estimate. */
const tokensOf = (text: string) => Math.ceil(text.length / 4);

export function ModelLab({
  configured,
  profiles,
  models,
  savedPrompt,
  savedModel,
  savedReasoning,
  history,
  credit,
}: Props) {
  const router = useRouter();
  const { message } = App.useApp();

  const [profileId, setProfileId] = useState(profiles[0]?.id ?? "");
  const [jobDescription, setJobDescription] = useState("");
  const [additionalPrompt, setAdditionalPrompt] = usePersistentState<string>(
    "tw.lab.additionalPrompt",
    "",
  );
  const [promptMode, setPromptMode] = useState<"saved" | "custom">("saved");
  const [customPrompt, setCustomPrompt] = useState(savedPrompt);
  const [reasoning, setReasoning] = useState(savedReasoning);
  const [storedModels, setSelectedModels] = usePersistentState<string[]>(
    "tw.lab.models",
    NO_MODELS,
  );
  const [slots, setSlots] = useState<Record<string, Slot>>({});
  const [running, setRunning] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);

  const byId = useMemo(() => new Map(models.map((m) => [m.id, m])), [models]);
  // First visit: the starter set, plus the saved model, limited to what exists.
  const selectedModels = (
    storedModels.length ? storedModels : [...new Set([savedModel, ...STARTER_MODELS])]
  ).filter((id) => byId.has(id));

  const profile = profiles.find((p) => p.id === profileId)?.profile ?? null;

  // A pre-run estimate, from list prices and typical answer length.
  const estimate = (id: string) => {
    const m = byId.get(id);
    if (!m) return null;
    const system = tokensOf(promptMode === "custom" ? customPrompt : savedPrompt) + 400;
    const input = system + tokensOf(jobDescription) + tokensOf(additionalPrompt) + 300;
    return (input * m.price.input + 1350 * m.price.output) / 1e6;
  };
  const totalEstimate = selectedModels.reduce((sum, id) => sum + (estimate(id) ?? 0), 0);

  const run = async () => {
    if (!profileId || !jobDescription.trim() || !selectedModels.length) return;
    const runId = crypto.randomUUID();
    setRunning(true);
    setViewing(runId);
    setSlots(Object.fromEntries(selectedModels.map((id) => [id, { status: "running" }])));

    await Promise.allSettled(
      selectedModels.map(async (model) => {
        try {
          const response = await fetch("/api/generation-lab", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              runId,
              model,
              profileId,
              jobDescription,
              additionalPrompt,
              systemPrompt: promptMode === "custom" ? customPrompt : null,
              reasoning,
            }),
          });
          const payload = await response.json().catch(() => null);
          if (!response.ok || !payload?.outcome) {
            throw new Error(payload?.error ?? `Request failed (${response.status})`);
          }
          setSlots((all) => ({ ...all, [model]: { status: "done", outcome: payload.outcome } }));
        } catch (error) {
          setSlots((all) => ({
            ...all,
            [model]: { status: "failed", error: error instanceof Error ? error.message : "Failed" },
          }));
        }
      }),
    );

    setRunning(false);
    router.refresh(); // history and the credit balance
  };

  const reopen = async (runId: string) => {
    const result = await loadLabRun(runId);
    if (!result.ok) {
      message.error(result.error);
      return;
    }
    if (result.rows[0]?.profile_id) setProfileId(result.rows[0].profile_id);
    setViewing(runId);
    setSlots(
      Object.fromEntries(
        result.rows.map((r) => [
          r.model,
          {
            status: "done",
            outcome: {
              content: r.output,
              valid: r.ok,
              problems: r.ok || !r.error ? [] : [{ path: "", message: r.error }],
              error: r.output === null ? r.error : null,
              attempts: r.attempts,
              promptTokens: r.prompt_tokens ?? 0,
              completionTokens: r.completion_tokens ?? 0,
              cachedTokens: r.cached_tokens ?? 0,
              reasoningTokens: r.reasoning_tokens ?? 0,
              costUsd: r.cost_usd === null ? null : Number(r.cost_usd),
              latencyMs: r.latency_ms ?? 0,
            },
          } satisfies Slot,
        ]),
      ),
    );
  };

  const openPdf = async (content: unknown) => {
    if (!profile) return;
    const doc = resumeDocumentSchema.safeParse({ schemaVersion: 2, profile, content });
    if (!doc.success) {
      message.error("This answer doesn't validate, so it can't be rendered.");
      return;
    }
    const url = await renderResumePdfUrl(doc.data, DEFAULT_STYLE, "classic");
    window.open(url, "_blank", "noopener");
  };

  const done = Object.entries(slots).flatMap(([model, slot]) =>
    slot.status === "done" ? [{ model, ...slot.outcome }] : [],
  );
  const runCost = done.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);

  // History: per-model averages across every lab run, and the runs themselves.
  const perModel = useMemo(() => {
    const groups = new Map<string, LabHistoryRow[]>();
    for (const row of history) groups.set(row.model, [...(groups.get(row.model) ?? []), row]);
    const mean = (xs: Array<number | null>) => {
      const known = xs.filter((x): x is number => typeof x === "number").map(Number);
      return known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
    };
    return [...groups.entries()]
      .map(([model, rows]) => ({
        model,
        runs: rows.length,
        valid: rows.filter((r) => r.ok).length / rows.length,
        avgCost: mean(rows.map((r) => (r.cost_usd === null ? null : Number(r.cost_usd)))),
        totalCost: rows.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0),
        avgLatency: mean(rows.map((r) => r.latency_ms)),
        avgIn: mean(rows.map((r) => r.prompt_tokens)),
        avgCached: mean(rows.map((r) => r.cached_tokens)),
        avgOut: mean(rows.map((r) => r.completion_tokens)),
        avgReasoning: mean(rows.map((r) => r.reasoning_tokens)),
      }))
      .sort((a, b) => b.runs - a.runs);
  }, [history]);

  const runs = useMemo(() => {
    const groups = new Map<string, LabHistoryRow[]>();
    for (const row of history) {
      if (!row.run_id) continue;
      groups.set(row.run_id, [...(groups.get(row.run_id) ?? []), row]);
    }
    return [...groups.entries()].map(([runId, rows]) => ({
      runId,
      at: rows[rows.length - 1].created_at,
      models: rows.length,
      valid: rows.filter((r) => r.ok).length,
      cost: rows.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0),
      prompt: rows[0].prompt_label ?? "saved",
      reasoning: rows[0].reasoning ?? "—",
    }));
  }, [history]);

  const labSpend = history.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);

  return (
    <>
      <Space style={{ marginBottom: 20, width: "100%", justifyContent: "space-between" }} align="start">
        <div>
          <Link href="/dashboard/generation">
            <Button type="link" icon={<ArrowLeftOutlined />} style={{ paddingInline: 0 }}>
              Generation settings
            </Button>
          </Link>
          <Typography.Title level={3} style={{ margin: 0, letterSpacing: "-0.02em" }}>
            Model lab
          </Typography.Title>
          <Typography.Text type="secondary">
            One candidate, one job, several models side by side — with what each
            cost. Uses the same generation code as the builder.
          </Typography.Text>
        </div>
        <Space size={28}>
          {credit && (
            <Statistic
              title="OpenRouter credit left"
              value={credit.total - credit.used}
              precision={2}
              prefix="$"
            />
          )}
          <Statistic title="Lab spend, 30 days" value={labSpend} precision={4} prefix="$" />
        </Space>
      </Space>

      {!configured && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          title="OPENROUTER_API_KEY is not set"
          description="Add it to the deployment's environment variables and redeploy, then come back."
        />
      )}

      <Card variant="borderless" style={{ marginBottom: 16 }}>
        <Row gutter={[16, 12]}>
          <Col xs={24} lg={8}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>Profile</Typography.Text>
            <Select
              style={{ width: "100%" }}
              value={profileId || undefined}
              onChange={setProfileId}
              showSearch
              optionFilterProp="label"
              options={profiles.map((p) => ({ value: p.id, label: p.fullName }))}
              placeholder="Choose a candidate"
            />
          </Col>
          <Col xs={24} lg={8}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>Reasoning</Typography.Text>
            <Select style={{ width: "100%" }} value={reasoning} onChange={setReasoning} options={REASONING_OPTIONS} />
          </Col>
          <Col xs={24} lg={8}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>System prompt</Typography.Text>
            <Segmented<"saved" | "custom">
              block
              value={promptMode}
              onChange={setPromptMode}
              options={[
                { value: "saved", label: "Saved prompt" },
                { value: "custom", label: "Custom for this test" },
              ]}
            />
          </Col>

          {promptMode === "custom" && (
            <Col span={24}>
              <Input.TextArea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                autoSize={{ minRows: 6, maxRows: 18 }}
                placeholder="A prompt to try without changing the saved one."
              />
            </Col>
          )}

          <Col xs={24} lg={14}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>Job description</Typography.Text>
            <Input.TextArea
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              autoSize={{ minRows: 6, maxRows: 14 }}
              placeholder="Paste the job posting."
            />
          </Col>
          <Col xs={24} lg={10}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Additional prompt <span style={{ opacity: 0.7 }}>— optional</span>
            </Typography.Text>
            <Input.TextArea
              value={additionalPrompt}
              onChange={(e) => setAdditionalPrompt(e.target.value)}
              autoSize={{ minRows: 6, maxRows: 14 }}
              placeholder="Anything extra for this resume."
            />
          </Col>

          <Col span={24}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Models — up to {MAX_MODELS}, all run at once
            </Typography.Text>
            <Select
              mode="multiple"
              style={{ width: "100%" }}
              value={selectedModels}
              onChange={(next: string[]) => setSelectedModels(next.slice(0, MAX_MODELS))}
              showSearch
              optionFilterProp="value"
              options={models.map((m) => ({
                value: m.id,
                label: (
                  <span>
                    {m.id}{" "}
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      ${m.price.input.toFixed(2)} / ${m.price.output.toFixed(2)}
                      {m.reasoningMandatory ? " · always reasons" : ""}
                    </Typography.Text>
                  </span>
                ),
              }))}
            />
          </Col>

          <Col span={24}>
            <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Estimated ≈ {usd(totalEstimate)} for this run, before reasoning tokens.
              </Typography.Text>
              <Button
                type="primary"
                size="large"
                icon={<ExperimentOutlined />}
                loading={running}
                disabled={!configured || !profileId || !jobDescription.trim() || !selectedModels.length}
                onClick={run}
              >
                Run {selectedModels.length} model{selectedModels.length === 1 ? "" : "s"}
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      {Object.keys(slots).length > 0 && (
        <>
          <Card
            variant="borderless"
            title="This run"
            style={{ marginBottom: 16 }}
            extra={<Typography.Text strong>{usd(runCost)} total</Typography.Text>}
          >
            <Table
              rowKey="model"
              size="small"
              pagination={false}
              dataSource={done}
              locale={{ emptyText: running ? "Waiting for the first model…" : "No results." }}
              columns={[
                { title: "Model", dataIndex: "model" },
                {
                  title: "Result",
                  key: "result",
                  render: (_, r) =>
                    r.error && r.content === null ? (
                      <Tag color="red">failed</Tag>
                    ) : r.valid ? (
                      <Tag color="green">valid{r.attempts > 1 ? " · repaired" : ""}</Tag>
                    ) : (
                      <Tag color="orange">invalid</Tag>
                    ),
                },
                { title: "In", dataIndex: "promptTokens", align: "right", render: n },
                { title: "Cached", dataIndex: "cachedTokens", align: "right", render: n },
                { title: "Out", dataIndex: "completionTokens", align: "right", render: n },
                { title: "Reasoning", dataIndex: "reasoningTokens", align: "right", render: n },
                { title: "Cost", dataIndex: "costUsd", align: "right", render: (v: number | null) => usd(v) },
                {
                  title: `× ${MONTHLY_VOLUME.toLocaleString()}/mo`,
                  key: "monthly",
                  align: "right",
                  render: (_, r) => (r.costUsd === null ? "—" : `$${(r.costUsd * MONTHLY_VOLUME).toFixed(0)}`),
                },
                {
                  title: "Time",
                  dataIndex: "latencyMs",
                  align: "right",
                  render: (v: number) => `${(v / 1000).toFixed(1)}s`,
                },
              ]}
            />
          </Card>

          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            {Object.entries(slots).map(([model, slot]) => (
              <Col xs={24} lg={12} xxl={8} key={`${viewing}-${model}`}>
                <Card
                  variant="borderless"
                  size="small"
                  title={<span style={{ fontSize: 13 }}>{model}</span>}
                  extra={
                    slot.status === "done" && slot.outcome.content !== null ? (
                      <Space size={0}>
                        <Button
                          size="small"
                          type="text"
                          icon={<FilePdfOutlined />}
                          disabled={!slot.outcome.valid}
                          onClick={() => openPdf(slot.outcome.content)}
                        >
                          PDF
                        </Button>
                        <Button
                          size="small"
                          type="text"
                          icon={<CopyOutlined />}
                          onClick={() => {
                            navigator.clipboard.writeText(JSON.stringify(slot.outcome.content, null, 2));
                            message.success("JSON copied.");
                          }}
                        />
                      </Space>
                    ) : null
                  }
                  styles={{ body: { height: 560, overflowY: "auto" } }}
                >
                  {slot.status === "running" ? (
                    <div style={{ height: "100%", display: "grid", placeItems: "center" }}>
                      <Spin description="Generating…" />
                    </div>
                  ) : slot.status === "failed" ? (
                    <Alert type="error" showIcon title="Failed" description={slot.error} />
                  ) : (
                    <>
                      <Space size={4} wrap style={{ marginBottom: 10 }}>
                        <Tag>{usd(slot.outcome.costUsd)}</Tag>
                        <Tag>{(slot.outcome.latencyMs / 1000).toFixed(1)}s</Tag>
                        <Tag>
                          {n(slot.outcome.promptTokens)} in
                          {slot.outcome.cachedTokens ? ` (${n(slot.outcome.cachedTokens)} cached)` : ""}
                        </Tag>
                        <Tag>
                          {n(slot.outcome.completionTokens)} out
                          {slot.outcome.reasoningTokens ? ` (${n(slot.outcome.reasoningTokens)} reasoning)` : ""}
                        </Tag>
                        {slot.outcome.valid ? (
                          <Tag color="green">valid{slot.outcome.attempts > 1 ? " · repaired" : ""}</Tag>
                        ) : (
                          <Tag color="orange">needs a fix</Tag>
                        )}
                      </Space>
                      {slot.outcome.error && slot.outcome.content === null ? (
                        <Alert type="error" showIcon title="Failed" description={slot.outcome.error} />
                      ) : (
                        <>
                          {!slot.outcome.valid && slot.outcome.problems.length > 0 && (
                            <Alert
                              type="warning"
                              showIcon
                              style={{ marginBottom: 10 }}
                              title="Doesn't validate"
                              description={
                                <ul style={{ margin: 0, paddingLeft: 18 }}>
                                  {slot.outcome.problems.slice(0, 5).map((p, i) => (
                                    <li key={i}>
                                      <code>{p.path || "(root)"}</code> — {p.message}
                                    </li>
                                  ))}
                                </ul>
                              }
                            />
                          )}
                          <ResumeView content={slot.outcome.content} profile={profile} />
                        </>
                      )}
                    </>
                  )}
                </Card>
              </Col>
            ))}
          </Row>
        </>
      )}

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={15}>
          <Card variant="borderless" title="Every lab run, per model — last 30 days">
            {perModel.length === 0 ? (
              <Empty description="No lab runs yet." />
            ) : (
              <Table
                rowKey="model"
                size="small"
                pagination={false}
                dataSource={perModel}
                scroll={{ x: 900 }}
                columns={[
                  { title: "Model", dataIndex: "model" },
                  { title: "Runs", dataIndex: "runs", align: "right" },
                  { title: "Valid", dataIndex: "valid", align: "right", render: (v: number) => `${Math.round(v * 100)}%` },
                  { title: "Avg in", dataIndex: "avgIn", align: "right", render: (v: number | null) => n(v && Math.round(v)) },
                  { title: "Avg cached", dataIndex: "avgCached", align: "right", render: (v: number | null) => n(v && Math.round(v)) },
                  { title: "Avg out", dataIndex: "avgOut", align: "right", render: (v: number | null) => n(v && Math.round(v)) },
                  { title: "Avg reasoning", dataIndex: "avgReasoning", align: "right", render: (v: number | null) => n(v && Math.round(v)) },
                  { title: "Avg cost", dataIndex: "avgCost", align: "right", render: (v: number | null) => usd(v) },
                  {
                    title: `At ${MONTHLY_VOLUME.toLocaleString()}/mo`,
                    key: "monthly",
                    align: "right",
                    render: (_, r) => (r.avgCost === null ? "—" : `$${(r.avgCost * MONTHLY_VOLUME).toFixed(0)}`),
                  },
                  { title: "Avg time", dataIndex: "avgLatency", align: "right", render: (v: number | null) => (v === null ? "—" : `${(v / 1000).toFixed(1)}s`) },
                  { title: "Spent", dataIndex: "totalCost", align: "right", render: (v: number) => usd(v) },
                ]}
              />
            )}
          </Card>
        </Col>
        <Col xs={24} xl={9}>
          <Card variant="borderless" title="Recent runs">
            {runs.length === 0 ? (
              <Empty description="Runs appear here." />
            ) : (
              <Table
                rowKey="runId"
                size="small"
                pagination={{ pageSize: 10, hideOnSinglePage: true }}
                dataSource={runs}
                columns={[
                  { title: "When", dataIndex: "at", render: (v: string) => formatDate(v) },
                  { title: "Models", key: "m", render: (_, r) => `${r.valid}/${r.models} valid` },
                  { title: "Prompt", dataIndex: "prompt" },
                  { title: "Cost", dataIndex: "cost", align: "right", render: (v: number) => usd(v) },
                  {
                    title: "",
                    key: "open",
                    render: (_, r) => (
                      <Button size="small" type="link" onClick={() => reopen(r.runId)}>
                        Open
                      </Button>
                    ),
                  },
                ]}
              />
            )}
          </Card>
        </Col>
      </Row>
    </>
  );
}

/**
 * A model's answer as a reader sees it: title, summary, skills, then each role
 * under its real employer, joined from the profile the way the PDF does.
 */
function ResumeView({ content, profile }: { content: unknown; profile: ResumeProfile | null }) {
  const c = (content ?? {}) as {
    targetTitle?: string;
    summary?: string;
    skills?: Array<{ name?: string; items?: string[] }>;
    experiences?: Array<{ employmentId?: string; title?: string; bullets?: Array<{ text?: string }> }>;
  };
  const employer = new Map((profile?.employments ?? []).map((e) => [e.id, e.company]));
  const words = (s: string | undefined) => (s ? s.split(/\s+/).filter(Boolean).length : 0);

  return (
    <div style={{ fontSize: 13, lineHeight: 1.5 }}>
      <Typography.Title level={5} style={{ margin: "0 0 6px" }}>
        {c.targetTitle ?? "—"}
      </Typography.Title>
      <Typography.Paragraph style={{ marginBottom: 4 }}>{c.summary}</Typography.Paragraph>
      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
        Summary {words(c.summary)} words · Skills{" "}
        {(c.skills ?? []).reduce((s, k) => s + (k.items?.length ?? 0), 0)} items in{" "}
        {(c.skills ?? []).length} groups
      </Typography.Text>

      <div style={{ margin: "10px 0" }}>
        {(c.skills ?? []).map((k, i) => (
          <div key={i}>
            <Typography.Text strong style={{ fontSize: 12 }}>{k.name}: </Typography.Text>
            <Typography.Text style={{ fontSize: 12 }}>{(k.items ?? []).join(", ")}</Typography.Text>
          </div>
        ))}
      </div>

      {(c.experiences ?? []).map((x, i) => (
        <div key={i} style={{ marginBottom: 10 }}>
          <Typography.Text strong>{x.title}</Typography.Text>
          <Typography.Text type="secondary"> · {employer.get(x.employmentId ?? "") ?? x.employmentId}</Typography.Text>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {(x.bullets ?? []).map((b, j) => (
              <li key={j}>
                {b.text}{" "}
                <Typography.Text type="secondary" style={{ fontSize: 10 }}>
                  {words(b.text)}w
                </Typography.Text>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
