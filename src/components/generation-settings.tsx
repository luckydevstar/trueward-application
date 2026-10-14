"use client";

import { ExperimentOutlined, SaveOutlined } from "@ant-design/icons";
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
  Row,
  Select,
  Space,
  Table,
  Typography,
} from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { saveGenerationSettings } from "@/app/dashboard/generation/actions";
import { DEFAULT_SYSTEM_PROMPT, OUTPUT_CONTRACT } from "@/lib/ai/resume-prompt";
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

type Props = {
  systemPrompt: string;
  model: string;
  reasoning: string;
  updatedAt: string | null;
  configured: boolean;
  /** Price per million tokens, from OpenRouter's model list. */
  models: Array<{ id: string; input: number; output: number }>;
  stats: ModelStats[];
  days: number;
};

const REASONING_OPTIONS = [
  { value: "lowest", label: "Lowest the model allows (recommended)" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "default", label: "Model default" },
];

/** The volume the projections are for — the target the user gave. */
const MONTHLY_VOLUME = 5000;

/**
 * Token counts to estimate with before there is any history: a system prompt,
 * a profile with several roles and a job description in; one resume's worth of
 * JSON out. Replaced by the observed averages once a model has run.
 */
const TYPICAL = { prompt: 7000, completion: 1800 };

const usd = (value: number | null, digits = 4) =>
  value === null ? "—" : `$${value.toFixed(digits)}`;

export function GenerationSettings({
  systemPrompt: savedPrompt,
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
  const [systemPrompt, setSystemPrompt] = useState(savedPrompt);
  const [model, setModel] = useState(savedModel);
  const [reasoning, setReasoning] = useState(savedReasoning);
  const [saving, setSaving] = useState(false);

  const dirty =
    systemPrompt !== savedPrompt || model.trim() !== savedModel || reasoning !== savedReasoning;
  const pricing = models.find((m) => m.id === model.trim());
  const observed = stats.find((s) => s.model === model.trim());

  /*
   * What one resume costs on the chosen model: observed if it has run, else
   * estimated from its list price and typical token counts.
   */
  const perResume = observed?.avgCostUsd ?? (pricing
    ? (TYPICAL.prompt * pricing.input + TYPICAL.completion * pricing.output) / 1e6
    : null);

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

  const save = async () => {
    setSaving(true);
    const result = await saveGenerationSettings({ systemPrompt, model, reasoning });
    setSaving(false);
    if (!result.ok) {
      message.error(result.error);
      return;
    }
    message.success("Saved. The next generation uses these settings.");
    router.refresh();
  };

  return (
    <>
      <Space
        style={{ marginBottom: 20, width: "100%", justifyContent: "space-between" }}
        align="start"
      >
        <div>
          <Typography.Title level={3} style={{ margin: 0, letterSpacing: "-0.02em" }}>
            Generation
          </Typography.Title>
          <Typography.Text type="secondary">
            The model and system prompt the resume builder writes with, and how
            each model has done.
            {updatedAt ? ` Last changed ${formatDate(updatedAt)}.` : ""}
          </Typography.Text>
        </div>
        <Space>
          <Link href="/dashboard/generation/lab">
            <Button icon={<ExperimentOutlined />}>Model lab</Button>
          </Link>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={saving}
            disabled={!dirty}
            onClick={save}
          >
            Save
          </Button>
        </Space>
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
          <Card variant="borderless" title="Model">
            <AutoComplete
              style={{ width: "100%" }}
              value={model}
              onChange={setModel}
              options={options}
              placeholder="anthropic/claude-sonnet-5.5"
              popupMatchSelectWidth={460}
            />
            <Typography.Paragraph type="secondary" style={{ marginTop: 10, marginBottom: 16 }}>
              Any OpenRouter model id. The list shows models that support
              structured output, with prices per million input / output tokens.
            </Typography.Paragraph>

            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Reasoning
            </Typography.Text>
            <Select
              style={{ width: "100%" }}
              value={reasoning}
              onChange={setReasoning}
              options={REASONING_OPTIONS}
            />
            <Typography.Paragraph type="secondary" style={{ marginTop: 6, marginBottom: 0, fontSize: 12 }}>
              Hidden reasoning is billed as output and can triple a resume&apos;s
              cost. Some models can&apos;t turn it off (Claude Sonnet 5.5, GPT-6.1
              Sol); &ldquo;lowest&rdquo; then uses their cheapest effort.
            </Typography.Paragraph>

            <div
              style={{
                marginTop: 16,
                padding: 14,
                borderRadius: 10,
                background: "#f5f7ff",
              }}
            >
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
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    per resume
                  </Typography.Text>
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
            title="System prompt"
            extra={
              <Button size="small" type="text" onClick={() => setSystemPrompt(DEFAULT_SYSTEM_PROMPT)}>
                Use the default
              </Button>
            }
          >
            <Input.TextArea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              autoSize={{ minRows: 12, maxRows: 28 }}
              placeholder="Paste your resume-generation prompt. Left empty, the built-in default is used."
              style={{ fontSize: 13 }}
            />
            <Collapse
              ghost
              size="small"
              style={{ marginTop: 8 }}
              items={[
                {
                  key: "contract",
                  label: "Always appended after your prompt",
                  children: (
                    <>
                      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                        The resume&apos;s shape is fixed by the builder, so this part
                        isn&apos;t editable. The candidate&apos;s employments, the job
                        description and the per-resume additional prompt follow as
                        the user message. Names and contact details are not sent.
                      </Typography.Paragraph>
                      <pre
                        style={{
                          whiteSpace: "pre-wrap",
                          fontSize: 12,
                          background: "#f8fafc",
                          padding: 12,
                          borderRadius: 8,
                          margin: 0,
                        }}
                      >
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
          <Card variant="borderless" title={`How each model has done — last ${days} days`}>
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
                  {
                    title: "Valid",
                    dataIndex: "validRate",
                    align: "right",
                    render: (v: number) => `${Math.round(v * 100)}%`,
                  },
                  {
                    title: "Needed a repair",
                    dataIndex: "repairRate",
                    align: "right",
                    render: (v: number) => `${Math.round(v * 100)}%`,
                  },
                  {
                    title: "Tokens in / out",
                    key: "tokens",
                    align: "right",
                    render: (_, s) =>
                      s.avgPromptTokens === null
                        ? "—"
                        : `${Math.round(s.avgPromptTokens).toLocaleString()} / ${Math.round(s.avgCompletionTokens ?? 0).toLocaleString()}`,
                  },
                  {
                    title: "Avg cost",
                    dataIndex: "avgCostUsd",
                    align: "right",
                    render: (v: number | null) => usd(v),
                  },
                  {
                    title: `At ${MONTHLY_VOLUME.toLocaleString()}/month`,
                    key: "monthly",
                    align: "right",
                    render: (_, s) =>
                      s.avgCostUsd === null ? "—" : `$${(s.avgCostUsd * MONTHLY_VOLUME).toFixed(0)}`,
                  },
                  {
                    title: "Avg time",
                    dataIndex: "avgLatencyMs",
                    align: "right",
                    render: (v: number | null) => (v === null ? "—" : `${(v / 1000).toFixed(1)}s`),
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
