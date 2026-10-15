"use client";

import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DollarOutlined,
  EyeOutlined,
  MessageOutlined,
  SendOutlined,
} from "@ant-design/icons";
import { Card, Col, Empty, Row, Statistic, Typography } from "antd";
import Link from "next/link";
import type { ReactNode } from "react";

import { WorkflowGuide } from "@/components/workflow-guide";
import type { UserRole } from "@/lib/roles";
import { APPLICATION_STATUSES, STATUS_META, type ApplicationStatus } from "@/lib/status";

type Props = {
  total: number;
  byStatus: Record<string, number>;
  unbilled: number;
  role: UserRole;
};

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
}: {
  title: string;
  value: number;
  icon: ReactNode;
  tint: string;
  ink: string;
}) {
  return (
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
  );
}

export function OverviewCards({ total, byStatus, unbilled, role }: Props) {
  return (
    <>
      <Typography.Title level={3} style={{ marginTop: 0, letterSpacing: "-0.02em" }}>
        Overview
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginTop: -4, marginBottom: 20 }}>
        Where every application stands right now.
      </Typography.Paragraph>

      <WorkflowGuide role={role} />

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Stat title="Applications" value={total} {...STATUS_LOOK.applied} />
        </Col>
        {APPLICATION_STATUSES.filter((s) => s !== "applied").map((status) => (
          <Col xs={24} sm={12} lg={6} key={status}>
            <Stat
              title={STATUS_META[status].label}
              value={byStatus[status] ?? 0}
              {...STATUS_LOOK[status]}
            />
          </Col>
        ))}
        <Col xs={24} sm={12} lg={6}>
          <Stat
            title="Unbilled"
            value={unbilled}
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
                <Link href="/dashboard/applications" style={{ color: "#4f46e5" }}>
                  Add an application
                </Link>
                .
              </>
            }
          />
        </Card>
      )}
    </>
  );
}
