"use client";

import {
  ArrowRightOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  DollarOutlined,
  EyeOutlined,
  FileDoneOutlined,
  MessageOutlined,
  SendOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { Card, Col, Empty, Row, Statistic, Typography } from "antd";
import Link from "next/link";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/page-header";
import { WorkflowGuide } from "@/components/workflow-guide";
import type { UserRole } from "@/lib/roles";
import { APPLICATION_STATUSES, STATUS_META, type ApplicationStatus } from "@/lib/status";

type Props = {
  total: number;
  byStatus: Record<string, number>;
  unbilled: number;
  role: UserRole;
  /** What's waiting on you — null for a role with nothing of its own to work. */
  next: {
    /** Generated resumes, ready and not yet sent. */
    ready: number;
    /** Jobs on your list that nobody has applied to yet. */
    toApply: number;
    /** Interviews in the next seven days, soonest first. */
    interviews: Array<{ title: string; startsAt: string }>;
  } | null;
};

/** A card that goes where its number is: the work, filtered. */
function NextCard({
  href,
  icon,
  title,
  value,
  note,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  value: ReactNode;
  note: ReactNode;
}) {
  return (
    <Link href={href} style={{ display: "block", height: "100%" }}>
      <Card variant="borderless" className="tw-lift" style={{ height: "100%" }} styles={{ body: { padding: 20 } }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#4f46e5", fontWeight: 600 }}>
          {icon}
          <span>{title}</span>
          <ArrowRightOutlined style={{ marginLeft: "auto", fontSize: 12 }} />
        </div>
        <div style={{ fontSize: 28, fontWeight: 650, color: "#0f172a", margin: "6px 0 2px", letterSpacing: "-0.02em" }}>
          {value}
        </div>
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          {note}
        </Typography.Text>
      </Card>
    </Link>
  );
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });

/** An icon and a tint per card, so the row reads at a glance before the numbers. */
const STATUS_LOOK: Record<ApplicationStatus, { icon: ReactNode; tint: string; ink: string }> = {
  applied: { icon: <SendOutlined />, tint: "#eef2ff", ink: "#4f46e5" },
  viewed: { icon: <EyeOutlined />, tint: "#fef9c3", ink: "#a16207" },
  interviewing: { icon: <MessageOutlined />, tint: "#f3e8ff", ink: "#7e22ce" },
  offer: { icon: <CheckCircleOutlined />, tint: "#dcfce7", ink: "#15803d" },
  rejected: { icon: <CloseCircleOutlined />, tint: "#fee2e2", ink: "#b91c1c" },
};

function Stat({
  title,
  value,
  icon,
  tint,
  ink,
  href,
}: {
  title: string;
  value: number;
  icon: ReactNode;
  tint: string;
  ink: string;
  /** The applications this counts, filtered. */
  href: string;
}) {
  return (
    <Link href={href} aria-label={`${title}: ${value} — show them`} style={{ display: "block" }}>
    <Card variant="borderless" className="tw-lift" styles={{ body: { padding: 20 } }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <Statistic title={title} value={value} />
        <span
          aria-hidden
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            display: "grid",
            placeItems: "center",
            background: tint,
            color: ink,
            fontSize: 16,
          }}
        >
          {icon}
        </span>
      </div>
    </Card>
    </Link>
  );
}

export function OverviewCards({ total, byStatus, unbilled, role, next }: Props) {
  return (
    <>
      <PageHeader title="Overview" description="What's waiting on you, and where every application stands." />

      {next && (
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={24} md={8}>
            <NextCard
              href="/dashboard/resumes"
              icon={<FileDoneOutlined />}
              title="Ready to send"
              value={next.ready}
              note={next.ready ? "Generated resumes not yet downloaded & tracked." : "Nothing generated is waiting."}
            />
          </Col>
          <Col xs={24} md={8}>
            <NextCard
              href="/dashboard/jobs"
              icon={<UnorderedListOutlined />}
              title="Jobs to apply"
              value={next.toApply}
              note={next.toApply ? "On your list, with no application yet." : "Add the next postings on Jobs."}
            />
          </Col>
          <Col xs={24} md={8}>
            <NextCard
              href="/dashboard/applications?status=interviewing"
              icon={<CalendarOutlined />}
              title="Interviews this week"
              value={next.interviews.length}
              note={
                next.interviews.length
                  ? next.interviews
                      .slice(0, 2)
                      .map((i) => `${when(i.startsAt)} · ${i.title}`)
                      .join("  ·  ")
                  : "None on the calendar for the next seven days."
              }
            />
          </Col>
        </Row>
      )}

      <Row gutter={[16, 16]}>
        <Col xs={12} sm={8} lg={4}>
          <Stat title="Applications" value={total} href="/dashboard/applications" {...STATUS_LOOK.applied} />
        </Col>
        {APPLICATION_STATUSES.filter((s) => s !== "applied").map((status) => (
          <Col xs={12} sm={8} lg={4} key={status}>
            <Stat
              title={STATUS_META[status].label}
              value={byStatus[status] ?? 0}
              href={`/dashboard/applications?status=${status}`}
              {...STATUS_LOOK[status]}
            />
          </Col>
        ))}
        <Col xs={12} sm={8} lg={4}>
          <Stat
            title="Unbilled"
            value={unbilled}
            href="/dashboard/applications?billing=unbilled"
            icon={<DollarOutlined />}
            tint="#ffedd5"
            ink="#c2410c"
          />
        </Col>
      </Row>

      {total === 0 && (
        <Card variant="borderless" style={{ marginTop: 16 }}>
          <Empty
            description={
              <>
                Nothing recorded yet.{" "}
                <Link href="/dashboard/jobs" style={{ color: "#4f46e5" }}>
                  Add your first jobs
                </Link>
                , or{" "}
                <Link href="/dashboard/applications" style={{ color: "#4f46e5" }}>
                  record an application
                </Link>
                .
              </>
            }
          />
        </Card>
      )}

      <div style={{ marginTop: 24 }}>
        <WorkflowGuide role={role} />
      </div>
    </>
  );
}
