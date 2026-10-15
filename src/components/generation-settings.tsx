"use client";

import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  ExperimentOutlined,
  PlusOutlined,
  SaveOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App,
  AutoComplete,
  Button,
  Card,
  Col,
  Collapse,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import {
  deletePrompt,
  saveGenerationSettings,
  savePrompt,
  setActivePrompt,
} from "@/app/dashboard/generation/actions";
import { OUTPUT_CONTRACT } from "@/lib/ai/resume-prompt";
import { formatDate } from "@/lib/status";

export type ModelStats = {
  model: string;
  runs: number;
  validRate: number;
  repairRate: number;
  avgPromptTokens: number | null;
  avgCompletionTokens: number | null;
  avgCostUsd: number | null;
  avgLatencyMs: number | null;
};

type LibraryPrompt = { id: string; name: string; body: string; updated_at: string };

type Props = {
  /** The built-in base prompt, shown read-only. */
  builtInPrompt: string;
  prompts: LibraryPrompt[];
  /** Null means the built-in prompt is the active one. */
  activePromptId: string | null;
  model: string;
  reasoning: string;
  updatedAt: string | null;
  configured: boolean;
  /** Price per million tokens, from OpenRouter's model list. */
  models: Array<{ id: string; input: number; output: number }>;
  stats: ModelStats[];
  days: number;
};

/** The volume the projections are for — the target the user gave. */
const MONTHLY_VOLUME = 5000;

/**
 * Token counts to estimate with before there is any history: a base prompt, a
 * profile with several roles and a job description in; one resume's worth of
 * JSON out. Replaced by the observed averages once a model has run.
 */
const TYPICAL = { prompt: 7000, completion: 1800 };

const REASONING_OPTIONS = [
  { value: "default", label: "Model default" },
  { value: "lowest", label: "Lowest the model allows" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const BUILT_IN = "__built_in__";

const usd = (value: number | null, digits = 4) =>
  value === null ? "—" : `$${value.toFixed(digits)}`;
const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

type Editing = { id?: string; name: string; body: string } | null;

export function GenerationSettings({
  builtInPrompt,
  prompts,
  activePromptId,
  model: savedModel,
  reasoning: savedReasoning,
  updatedAt,
  configured,
  models,
  stats,
  days,
}: Props) {
  const router = useRouter();
  const { message } = App.useApp();
  const [model, setModel] = useState(savedModel);
  const [reasoning, setReasoning] = useState(savedReasoning);
  const [saving, setSaving] = useState(false);
  const [viewing, setViewing] = useState<{ name: string; body: string } | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState(false);

  const dirty = model.trim() !== savedModel || reasoning !== savedReasoning;
  const pricing = models.find((m) => m.id === model.trim());
  const observed = stats.find((s) => s.model === model.trim());
  const perResume =
    observed?.avgCostUsd ??
    (pricing ? (TYPICAL.prompt * pricing.input + TYPICAL.completion * pricing.output) / 1e6 : null);

  const options = useMemo(
    () =>
      models
        .filter((m) => m.id.toLowerCase().includes(model.trim().toLowerCase()))
        .slice(0, 50)
        .map((m) => ({
          value: m.id,
          label: (
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span>{m.id}</span>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                ${m.input.toFixed(2)} / ${m.output.toFixed(2)} per 1M
              </Typography.Text>
            </div>
          ),
        })),
    [models, model],
  );

  const saveModel = async () => {
    setSaving(true);
    const result = await saveGenerationSettings({ model, reasoning });
    setSaving(false);
    if (!result.ok) {
      message.error(result.error);
      return;
    }
    message.success("Saved. The next generation uses this model.");
    router.refresh();
  };

  const activate = async (value: string) => {
    const result = await setActivePrompt(value === BUILT_IN ? null : value);
    if (!result.ok) {
      message.error(result.error);
      return;
    }
    message.success("Active prompt changed. Every Generate now uses it.");
    router.refresh();
  };

  const submitPrompt = async () => {
    if (!editing) return;
    setBusy(true);
    const result = await savePrompt(editing);
    setBusy(false);
    if (!result.ok) {
      message.error(result.error);
      return;
    }
    message.success(editing.id ? "Prompt updated." : "Prompt added.");
    setEditing(null);
    router.refresh();
  };

  const remove = async (id: string) => {
    const result = await deletePrompt(id);
    if (!result.ok) {
      message.error(result.error);
      return;
    }
    message.success(
      id === activePromptId ? "Deleted. The built-in prompt is active again." : "Prompt deleted.",
    );
    router.refresh();
  };

  const rows = [
    { id: BUILT_IN, name: "Built-in default", body: builtInPrompt, updated_at: null as string | null, builtIn: true },
    ...prompts.map((p) => ({ ...p, builtIn: false })),
  ];
  const active = activePromptId ?? BUILT_IN;

  return (
    <>
      <Space style={{ marginBottom: 20, width: "100%", justifyContent: "space-between" }} align="start">
        <div>
          <Typography.Title level={3} style={{ margin: 0, letterSpacing: "-0.02em" }}>
            Generation
          </Typography.Title>
          <Typography.Text type="secondary">
            The model, reasoning and base prompt every Generate uses. People in
            the builder only pick a profile and paste a job.
            {updatedAt ? ` Last changed ${formatDate(updatedAt)}.` : ""}
          </Typography.Text>
        </div>
        <Link href="/dashboard/generation/lab">
          <Button icon={<ExperimentOutlined />}>Model lab</Button>
        </Link>
      </Space>

      {!configured && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          title="Generation is off"
          description="Set OPENROUTER_API_KEY in the deployment's environment variables (and in .env locally), then redeploy. Settings can be saved in the meantime."
        />
      )}

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={9}>
          <Card
            variant="borderless"
            title="Model"
            extra={
              <Button type="primary" size="small" icon={<SaveOutlined />} loading={saving} disabled={!dirty} onClick={saveModel}>
                Save
              </Button>
            }
          >
            <AutoComplete
              style={{ width: "100%" }}
              value={model}
              onChange={setModel}
              options={options}
              placeholder="openai/gpt-6-luna"
              popupMatchSelectWidth={460}
            />
            <Typography.Paragraph type="secondary" style={{ marginTop: 10, marginBottom: 16 }}>
              Any OpenRouter model id with structured output. Prices are per
              million input / output tokens.
            </Typography.Paragraph>

            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Reasoning
            </Typography.Text>
            <Select style={{ width: "100%" }} value={reasoning} onChange={setReasoning} options={REASONING_OPTIONS} />
            <Typography.Paragraph type="secondary" style={{ marginTop: 6, marginBottom: 0, fontSize: 12 }}>
              Hidden reasoning is billed as output. &ldquo;Lowest&rdquo; turns it
              off where the model allows, which can cut the cost of models that
              reason by default.
            </Typography.Paragraph>

            <div style={{ marginTop: 16, padding: 14, borderRadius: 10, background: "#f5f7ff" }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {observed?.avgCostUsd != null
                  ? `Observed over ${observed.runs} run${observed.runs === 1 ? "" : "s"}`
                  : pricing
                    ? `Estimated at ~${TYPICAL.prompt.toLocaleString()} in / ${TYPICAL.completion.toLocaleString()} out tokens`
                    : "No price known for this id"}
              </Typography.Text>
              <div style={{ display: "flex", gap: 24, marginTop: 4 }}>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 600 }}>{usd(perResume)}</div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>per resume</Typography.Text>
                </div>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 600 }}>
                    {perResume === null ? "—" : `$${(perResume * MONTHLY_VOLUME).toFixed(0)}`}
                  </div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    per {MONTHLY_VOLUME.toLocaleString()} a month
                  </Typography.Text>
                </div>
              </div>
            </div>
          </Card>
        </Col>

        <Col xs={24} xl={15}>
          <Card
            variant="borderless"
            title="Base prompts"
            extra={
              <Button size="small" icon={<PlusOutlined />} onClick={() => setEditing({ name: "", body: "" })}>
                Add prompt
              </Button>
            }
          >
            <Radio.Group value={active} onChange={(e) => activate(e.target.value)} style={{ width: "100%" }}>
              <Space orientation="vertical" style={{ width: "100%" }} size={0}>
                {rows.map((p) => (
                  <div
                    key={p.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "10px 4px",
                      borderBottom: "1px solid #edf0f5",
                    }}
                  >
                    <Radio value={p.id} aria-label={`Use ${p.name}`} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Space size={6} wrap>
                        <Typography.Text strong>{p.name}</Typography.Text>
                        {p.id === active && <Tag color="blue">Active</Tag>}
                        {p.builtIn && <Tag>read-only</Tag>}
                      </Space>
                      <div>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {words(p.body).toLocaleString()} words
                          {p.updated_at ? ` · updated ${formatDate(p.updated_at)}` : ""}
                        </Typography.Text>
                      </div>
                    </div>
                    <Space size={0}>
                      <Button
                        type="text"
                        size="small"
                        icon={<EyeOutlined />}
                        aria-label={`View ${p.name}`}
                        onClick={() => setViewing({ name: p.name, body: p.body })}
                      />
                      {p.builtIn ? (
                        <Button
                          type="text"
                          size="small"
                          icon={<CopyOutlined />}
                          onClick={() => setEditing({ name: "Copy of built-in default", body: p.body })}
                        >
                          Copy to library
                        </Button>
                      ) : (
                        <>
                          <Button
                            type="text"
                            size="small"
                            icon={<EditOutlined />}
                            aria-label={`Edit ${p.name}`}
                            onClick={() => setEditing({ id: p.id, name: p.name, body: p.body })}
                          />
                          <Popconfirm
                            title="Delete this prompt?"
                            description={
                              p.id === active ? "It's active — the built-in prompt takes over." : undefined
                            }
                            okButtonProps={{ danger: true }}
                            onConfirm={() => remove(p.id)}
                          >
                            <Button type="text" size="small" danger icon={<DeleteOutlined />} aria-label={`Delete ${p.name}`} />
                          </Popconfirm>
                        </>
                      )}
                    </Space>
                  </div>
                ))}
              </Space>
            </Radio.Group>

            <Collapse
              ghost
              size="small"
              style={{ marginTop: 8 }}
              items={[
                {
                  key: "contract",
                  label: "What the app adds — the response format",
                  children: (
                    <>
                      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                        The active prompt is the system message. The user message is
                        the selected profile&apos;s employments and education, its
                        company context if recorded, and the job description. The app
                        appends only this, so the answer comes back as resume JSON the
                        builder can render, with the profile&apos;s employment ids as
                        the only allowed values. Names and contact details are not sent.
                      </Typography.Paragraph>
                      <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, background: "#f8fafc", padding: 12, borderRadius: 8, margin: 0 }}>
                        {OUTPUT_CONTRACT}
                      </pre>
                    </>
                  ),
                },
              ]}
            />
          </Card>
        </Col>

        <Col span={24}>
          <Card variant="borderless" title={`How each model has done — real resumes, last ${days} days`}>
            {stats.length === 0 ? (
              <Empty description="No generations yet. Averages appear here as the builder is used." />
            ) : (
              <Table<ModelStats>
                rowKey="model"
                dataSource={stats}
                pagination={false}
                size="middle"
                columns={[
                  { title: "Model", dataIndex: "model" },
                  { title: "Runs", dataIndex: "runs", align: "right" },
                  { title: "Valid", dataIndex: "validRate", align: "right", render: (v: number) => `${Math.round(v * 100)}%` },
                  { title: "Needed a repair", dataIndex: "repairRate", align: "right", render: (v: number) => `${Math.round(v * 100)}%` },
                  {
                    title: "Tokens in / out",
                    key: "tokens",
                    align: "right",
                    render: (_, s) =>
                      s.avgPromptTokens === null
                        ? "—"
                        : `${Math.round(s.avgPromptTokens).toLocaleString()} / ${Math.round(s.avgCompletionTokens ?? 0).toLocaleString()}`,
                  },
                  { title: "Avg cost", dataIndex: "avgCostUsd", align: "right", render: (v: number | null) => usd(v) },
                  {
                    title: `At ${MONTHLY_VOLUME.toLocaleString()}/month`,
                    key: "monthly",
                    align: "right",
                    render: (_, s) => (s.avgCostUsd === null ? "—" : `$${(s.avgCostUsd * MONTHLY_VOLUME).toFixed(0)}`),
                  },
                  { title: "Avg time", dataIndex: "avgLatencyMs", align: "right", render: (v: number | null) => (v === null ? "—" : `${(v / 1000).toFixed(1)}s`) },
                ]}
              />
            )}
          </Card>
        </Col>
      </Row>

      <Modal
        title={viewing?.name}
        open={viewing !== null}
        onCancel={() => setViewing(null)}
        footer={<Button onClick={() => setViewing(null)}>Close</Button>}
        width={760}
      >
        <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, maxHeight: "65vh", overflowY: "auto", margin: 0 }}>
          {viewing?.body}
        </pre>
      </Modal>

      <Modal
        title={editing?.id ? "Edit prompt" : "Add a base prompt"}
        open={editing !== null}
        onCancel={() => setEditing(null)}
        onOk={submitPrompt}
        okText={editing?.id ? "Save" : "Add"}
        confirmLoading={busy}
        width={760}
        destroyOnHidden
      >
        <Space orientation="vertical" style={{ width: "100%" }}>
          <Input
            placeholder="Name, e.g. “Frontend v2”"
            value={editing?.name}
            onChange={(e) => setEditing((p) => (p ? { ...p, name: e.target.value } : p))}
          />
          <Input.TextArea
            placeholder="The base prompt — the instructions every resume is written by."
            value={editing?.body}
            onChange={(e) => setEditing((p) => (p ? { ...p, body: e.target.value } : p))}
            autoSize={{ minRows: 14, maxRows: 28 }}
            style={{ fontSize: 12 }}
          />
          {editing?.id === activePromptId && editing?.id && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              This is the active prompt; saving changes what every Generate uses.
            </Typography.Text>
          )}
        </Space>
      </Modal>
    </>
  );
}
