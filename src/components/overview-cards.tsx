"use client";

import { Card, Col, Empty, Row, Statistic, Typography } from "antd";
import Link from "next/link";

import { APPLICATION_STATUSES, STATUS_META } from "@/lib/status";

type Props = {
  total: number;
  byStatus: Record<string, number>;
  unbilled: number;
};

export function OverviewCards({ total, byStatus, unbilled }: Props) {
  return (
    <>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        Overview
      </Typography.Title>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="Applications" value={total} />
          </Card>
        </Col>
        {APPLICATION_STATUSES.filter((s) => s !== "applied").map((status) => (
          <Col xs={24} sm={12} lg={6} key={status}>
            <Card>
              <Statistic
                title={STATUS_META[status].label}
                value={byStatus[status] ?? 0}
              />
            </Card>
          </Col>
        ))}
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="Unbilled" value={unbilled} />
          </Card>
        </Col>
      </Row>

      {total === 0 && (
        <Card style={{ marginTop: 16 }}>
          <Empty
            description={
              <>
                Nothing recorded yet.{" "}
                <Link href="/dashboard/applications">Add an application</Link>.
              </>
            }
          />
        </Card>
      )}
    </>
  );
}
