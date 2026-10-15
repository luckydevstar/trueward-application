"use client";

import { Alert, Card, Col, Empty, Row, Segmented, Statistic, Table, Tabs, Typography } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { formatDate } from "@/lib/status";

export type UsageGroup = {
  id: string;
  label: string;
  runs: number;
  valid: number;
  /** US dollars. */
  spend: number;
  last: string;
};

type Props = {
  everyTeam: boolean;
  period: "7d" | "30d" | "90d" | "month";
  source: "builder" | "lab" | "all";
  credit: number | null;
  totals: { spend: number; runs: number; valid: number; people: number };
  daily: Array<{ day: string; spend: number; runs: number }>;
  bySubadmin: UsageGroup[];
  byPerson: UsageGroup[];
  byProfile: UsageGroup[];
  truncated: boolean;
};

/*
 * One series throughout — spend — so one hue: the brand accent for marks, a
 * lighter step of it for bar tracks. Text stays in text colours; the mark
 * beside a number carries the magnitude, not the number's colour.
 */
const ACCENT = "#4f46e5";
const TRACK = "#eef0ff";
const GRID = "#edf0f5";

/** Dollars at the precision the amount needs: cents once it's real money. */
const money = (v: number) => (v >= 1 ? `$${v.toFixed(2)}` : v === 0 ? "$0" : `$${v.toFixed(4)}`);

const PERIOD_OPTIONS = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "month", label: "This month" },
  { value: "90d", label: "90 days" },
];
const SOURCE_OPTIONS = [
  { value: "builder", label: "Real usage" },
  { value: "lab", label: "Model lab" },
  { value: "all", label: "Both" },
];

export function UsageDashboard({
  everyTeam,
  period,
  source,
  credit,
  totals,
  daily,
  bySubadmin,
  byPerson,
  byProfile,
  truncated,
}: Props) {
  const router = useRouter();
  const go = (next: { period?: string; source?: string }) => {
    const query = new URLSearchParams({
      period: next.period ?? period,
      ...(everyTeam ? { source: next.source ?? source } : {}),
    });
    router.push(`/dashboard/usage?${query}`);
  };

  const avg = totals.runs ? totals.spend / totals.runs : null;

  const groupColumns = (title: string) => {
    const max = Math.max(...[...bySubadmin, ...byPerson, ...byProfile].map((g) => g.spend), 0);
    return [
      { title, dataIndex: "label", key: "label", ellipsis: true },
      {
        title: "Requests",
        dataIndex: "runs",
        key: "runs",
        align: "right" as const,
        width: 100,
        render: (v: number) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{v.toLocaleString()}</span>,
      },
      {
        title: "Valid",
        key: "valid",
        align: "right" as const,
        width: 80,
        render: (_: unknown, g: UsageGroup) => (
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{Math.round((g.valid / g.runs) * 100)}%</span>
        ),
      },
      {
        title: "Spend",
        dataIndex: "spend",
        key: "spend",
        width: 260,
        render: (v: number) => (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              aria-hidden
              style={{ flex: 1, height: 8, borderRadius: 4, background: TRACK, overflow: "hidden" }}
            >
              <div
                style={{
                  width: `${max ? Math.max((v / max) * 100, v > 0 ? 2 : 0) : 0}%`,
                  height: "100%",
                  borderRadius: 4,
                  background: ACCENT,
                }}
              />
            </div>
            <span style={{ fontVariantNumeric: "tabular-nums", minWidth: 64, textAlign: "right" }}>
              {money(v)}
            </span>
          </div>
        ),
      },
      {
        title: "Per request",
        key: "avg",
        align: "right" as const,
        width: 110,
        render: (_: unknown, g: UsageGroup) => (
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{money(g.spend / g.runs)}</span>
        ),
      },
      {
        title: "Share",
        key: "share",
        align: "right" as const,
        width: 80,
        render: (_: unknown, g: UsageGroup) => (
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {totals.spend ? `${Math.round((g.spend / totals.spend) * 100)}%` : "—"}
          </span>
        ),
      },
      {
        title: "Last used",
        dataIndex: "last",
        key: "last",
        width: 120,
        render: (v: string) => formatDate(v),
      },
    ];
  };

  const table = (rows: UsageGroup[], title: string) =>
    rows.length ? (
      <Table<UsageGroup>
        rowKey="id"
        size="middle"
        dataSource={rows}
        columns={groupColumns(title)}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        scroll={{ x: 820 }}
      />
    ) : (
      <Empty description="Nothing generated in this period." />
    );

  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 20,
        }}
      >
        <div>
          <Typography.Title level={3} style={{ margin: 0, letterSpacing: "-0.02em" }}>
            Usage
          </Typography.Title>
          <Typography.Text type="secondary">
            {everyTeam
              ? "What resume generation has cost across every team, and who spent it."
              : "What resume generation has cost your team, by person and by profile."}
          </Typography.Text>
        </div>
        {/* Filters in one row above everything they filter. */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {everyTeam && (
            <Segmented value={source} options={SOURCE_OPTIONS} onChange={(v) => go({ source: String(v) })} />
          )}
          <Segmented value={period} options={PERIOD_OPTIONS} onChange={(v) => go({ period: String(v) })} />
        </div>
      </div>

      {truncated && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          title="Not every row could be read"
          description="The totals below may be incomplete. Reload to try again."
        />
      )}

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} lg={everyTeam ? 5 : 6}>
          <Card variant="borderless">
            <Statistic title="Spend" value={money(totals.spend)} />
          </Card>
        </Col>
        <Col xs={12} lg={everyTeam ? 5 : 6}>
          <Card variant="borderless">
            <Statistic title="Requests" value={totals.runs} />
          </Card>
        </Col>
        <Col xs={12} lg={everyTeam ? 5 : 6}>
          <Card variant="borderless">
            <Statistic title="Average per request" value={avg === null ? "—" : money(avg)} />
          </Card>
        </Col>
        <Col xs={12} lg={everyTeam ? 4 : 6}>
          <Card variant="borderless">
            <Statistic
              title="Valid first time or after one repair"
              value={totals.runs ? `${Math.round((totals.valid / totals.runs) * 100)}%` : "—"}
            />
          </Card>
        </Col>
        {everyTeam && (
          <Col xs={24} lg={5}>
            <Card variant="borderless">
              <Statistic title="OpenRouter credit left" value={credit === null ? "—" : `$${credit.toFixed(2)}`} />
            </Card>
          </Col>
        )}
      </Row>

      <Card variant="borderless" title="Spend per day" style={{ marginBottom: 16 }}>
        <DailyColumns daily={daily} />
      </Card>

      <Card variant="borderless">
        <Tabs
          items={[
            ...(everyTeam
              ? [{ key: "subadmin", label: "By subadmin", children: table(bySubadmin, "Subadmin's team") }]
              : []),
            {
              key: "person",
              label: everyTeam ? "By end user" : "By person",
              children: table(byPerson, "Person"),
            },
            { key: "profile", label: "By profile", children: table(byProfile, "Profile") },
          ]}
        />
      </Card>
    </>
  );
}

/**
 * Daily spend as columns — one series, so one hue and no legend; the card
 * title names it.
 *
 * Built from divs rather than SVG so the bars and their labels lay out like
 * the rest of the page at any width. Each day's whole column is the hover
 * target, not just its bar, so a day with a tiny spend is still easy to read.
 */
function DailyColumns({ daily }: { daily: Array<{ day: string; spend: number; runs: number }> }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...daily.map((d) => d.spend), 0);

  if (max === 0) {
    return <Empty description="No spend in this period." />;
  }

  const label = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  const ticks = new Set([0, Math.floor((daily.length - 1) / 2), daily.length - 1]);
  const h = hover === null ? null : daily[hover];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Peak {money(max)}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12, minHeight: 18 }}>
          {h ? `${label(h.day)} · ${money(h.spend)} · ${h.runs} request${h.runs === 1 ? "" : "s"}` : ""}
        </Typography.Text>
      </div>
      <div
        role="img"
        aria-label={`Spend per day, peaking at ${money(max)}`}
        style={{
          position: "relative",
          height: 160,
          display: "flex",
          alignItems: "flex-end",
          gap: 2,
          borderBottom: `1px solid ${GRID}`,
          backgroundImage: `linear-gradient(${GRID} 1px, transparent 1px)`,
          backgroundSize: "100% 50%",
        }}
        onMouseLeave={() => setHover(null)}
      >
        {daily.map((d, i) => (
          <div
            key={d.day}
            onMouseEnter={() => setHover(i)}
            style={{
              flex: 1,
              height: "100%",
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "center",
              cursor: "default",
              background: hover === i ? "rgba(79, 70, 229, 0.06)" : "transparent",
              borderRadius: 4,
            }}
          >
            <div
              style={{
                width: "100%",
                maxWidth: 24,
                height: `${(d.spend / max) * 100}%`,
                minHeight: d.spend > 0 ? 2 : 0,
                background: ACCENT,
                // Rounded at the data end, square at the baseline.
                borderRadius: "4px 4px 0 0",
              }}
            />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 2, marginTop: 6 }}>
        {daily.map((d, i) => (
          <div key={d.day} style={{ flex: 1, textAlign: "center", fontSize: 11, color: "#64748b", whiteSpace: "nowrap" }}>
            {ticks.has(i) ? label(d.day) : ""}
          </div>
        ))}
      </div>
    </div>
  );
}
