"use client";

import {
  ChromeOutlined,
  CloudDownloadOutlined,
  LinkOutlined,
  RobotOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import { Alert, App, Button, Card, Checkbox, Col, Input, Row, Select, Space, Table, Tag, Tooltip, Typography } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { generateForJobs, syncJobSheet } from "@/app/dashboard/jobs/actions";
import { DEFAULT_STYLE } from "@/components/resume-style-toolbar";
import { MAX_RUNNING_JOBS } from "@/lib/ai/defaults";
import { TEMPLATES } from "@/lib/pdf/templates";
import { usePersistentState } from "@/lib/persistent-state";
import type { ResumeStyle } from "@/lib/supabase/types";

export type JobRow = {
  id: string;
  no: string;
  title: string;
  company: string | null;
  url: string | null;
  resume: {
    id: string;
    status: "queued" | "running" | "ready" | "failed";
    valid: boolean | null;
    error: string | null;
    tracked: boolean;
    startedAt: string;
  } | null;
};

type Props = {
  sheet: { url: string; last_synced_at: string | null; last_error: string | null } | null;
  profiles: Array<{ id: string; name: string }>;
  profileId: string | null;
  jobs: JobRow[];
};

/** The builder's remembered style — the batch renders in it, so one setting rules both. */
type Preset = { template: string; style: ResumeStyle };

function StatusTag({ resume }: { resume: JobRow["resume"] }) {
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
 * The Google Sheet of jobs, and a resume for each.
 *
 * Connect the sheet once, sync it whenever it changes, tick the jobs, and
 * generate: six run at once, the rest wait their turn on the server, and the
 * list follows along. The Chrome extension shows the same list and downloads
 * the results.
 */
export function JobSheet({ sheet, profiles, profileId, jobs }: Props) {
  const router = useRouter();
  const { message } = App.useApp();
  const [url, setUrl] = useState(sheet?.url ?? "");
  const [syncing, setSyncing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [regenerate, setRegenerate] = useState(false);
  const [preset] = usePersistentState<Preset>("tw.resume.style", { template: "banner", style: DEFAULT_STYLE });
  const [template, setTemplate] = useState<string | null>(null);
  const chosenTemplate = template ?? (TEMPLATES.some((t) => t.id === preset.template) ? preset.template : "banner");

  const busy = jobs.filter((j) => j.resume && (j.resume.status === "queued" || j.resume.status === "running")).length;

  // Follow a running batch: re-read the list every few seconds until it's done.
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [busy, router]);

  const sync = async (connect: boolean) => {
    setSyncing(true);
    const result = await syncJobSheet(connect ? url : undefined);
    setSyncing(false);
    if (!result.ok) {
      message.error(result.error);
      return;
    }
    message.success(
      `${result.total} job${result.total === 1 ? "" : "s"} in the sheet` +
        (result.added ? ` — ${result.added} new` : "") +
        (result.removed ? `, ${result.removed} removed` : "") +
        ".",
    );
    router.refresh();
  };

  const generate = async () => {
    if (!profileId) return;
    setGenerating(true);
    const result = await generateForJobs({
      profileId,
      sheetJobIds: selected,
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

  return (
    <>
      <Typography.Title level={3} style={{ margin: 0, letterSpacing: "-0.02em" }}>
        Job sheet
      </Typography.Title>
      <Typography.Text type="secondary">
        Your Google Sheet of jobs, with a resume generated for each — in the background, {MAX_RUNNING_JOBS} at a
        time.
      </Typography.Text>

      <Row gutter={[16, 16]} style={{ marginTop: 20 }}>
        <Col xs={24} xl={16}>
          <Card variant="borderless" title="Your sheet">
            <Space.Compact style={{ width: "100%" }}>
              <Input
                placeholder="https://docs.google.com/spreadsheets/d/…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                prefix={<LinkOutlined />}
              />
              <Button type="primary" loading={syncing} onClick={() => sync(url.trim() !== (sheet?.url ?? ""))}>
                {sheet && url.trim() === sheet.url ? "Sync" : "Connect"}
              </Button>
            </Space.Compact>
            <Typography.Paragraph type="secondary" style={{ margin: "10px 0 0", fontSize: 13 }}>
              First row as headers: <b>No</b>, <b>Title</b>, <b>Company</b>, <b>URL</b>, <b>JD</b>. In Google
              Sheets, <i>Share → General access → Anyone with the link → Viewer</i>.
              {sheet?.last_synced_at ? ` Last synced ${new Date(sheet.last_synced_at).toLocaleString()}.` : ""}
            </Typography.Paragraph>
            {sheet?.last_error && (
              <Alert type="warning" showIcon style={{ marginTop: 12 }} title={sheet.last_error} />
            )}
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card
            variant="borderless"
            title={
              <span>
                <ChromeOutlined style={{ marginRight: 8, color: "#4f46e5" }} />
                Chrome extension
              </span>
            }
          >
            <Typography.Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 12 }}>
              Pick a job, download its resume (tracked automatically), copy contact details into the form, and
              answer screening questions — beside any job site.
            </Typography.Paragraph>
            <Button icon={<CloudDownloadOutlined />} href="/trueward-extension.zip" download block>
              Download the extension
            </Button>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: "10px 0 0" }}>
              Unzip it, open <code>chrome://extensions</code>, turn on Developer mode, choose <b>Load unpacked</b> and
              pick the folder. Sign in with your Trueward account.
            </Typography.Paragraph>
          </Card>
        </Col>
      </Row>

      <Card variant="borderless" style={{ marginTop: 16 }} styles={{ body: { padding: 0 } }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", padding: 16 }}>
          <Select
            style={{ minWidth: 220 }}
            placeholder="Profile"
            value={profileId ?? undefined}
            options={profiles.map((p) => ({ value: p.id, label: p.name }))}
            onChange={(id) => router.push(`/dashboard/jobs?profile=${id}`)}
            showSearch
            optionFilterProp="label"
          />
          <Select
            style={{ width: 150 }}
            value={chosenTemplate}
            onChange={setTemplate}
            options={TEMPLATES.map((t) => ({ value: t.id, label: t.label }))}
          />
          <Checkbox checked={regenerate} onChange={(e) => setRegenerate(e.target.checked)}>
            Regenerate
          </Checkbox>
          <div style={{ flex: 1 }} />
          {busy > 0 && (
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              <SyncOutlined spin /> {busy} in progress
            </Typography.Text>
          )}
          <Button
            type="primary"
            icon={<RobotOutlined />}
            loading={generating}
            disabled={!selected.length || !profileId}
            onClick={generate}
          >
            Generate {selected.length ? `(${selected.length})` : ""}
          </Button>
        </div>
        {!profiles.length ? (
          <Alert
            type="info"
            showIcon
            style={{ margin: "0 16px 16px" }}
            title="No profile to generate for"
            description="Resumes are generated for a profile assigned to you."
          />
        ) : null}
        <Table<JobRow>
          rowKey="id"
          size="middle"
          dataSource={jobs}
          pagination={jobs.length > 50 ? { pageSize: 50, showSizeChanger: false } : false}
          rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as string[]) }}
          locale={{ emptyText: sheet ? "No jobs in the sheet yet — add rows and Sync." : "Connect your sheet to see its jobs." }}
          scroll={{ x: 760 }}
          columns={[
            { title: "No", dataIndex: "no", width: 70 },
            {
              title: "Job",
              key: "job",
              render: (_, j) => (
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 500 }}>{j.title}</div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {j.company ?? "—"}
                  </Typography.Text>
                </div>
              ),
            },
            {
              title: "Posting",
              dataIndex: "url",
              width: 90,
              render: (u: string | null) =>
                u ? (
                  <a href={u} target="_blank" rel="noreferrer">
                    Open <LinkOutlined />
                  </a>
                ) : (
                  <Typography.Text type="secondary">—</Typography.Text>
                ),
            },
            { title: "Resume", key: "status", width: 130, render: (_, j) => <StatusTag resume={j.resume} /> },
            {
              title: "",
              key: "open",
              width: 90,
              render: (_, j) =>
                j.resume?.status === "ready" ? (
                  <Link href={`/dashboard/resumes?job=${j.resume.id}`}>Open</Link>
                ) : null,
            },
          ]}
        />
      </Card>
    </>
  );
}
