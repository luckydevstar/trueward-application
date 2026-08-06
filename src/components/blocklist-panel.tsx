"use client";

import { ClockCircleOutlined, DeleteOutlined, PlusOutlined, StopOutlined } from "@ant-design/icons";
import {
  App,
  Button,
  Card,
  Input,
  Popconfirm,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { formatDate, normalizeCompany } from "@/lib/status";

type Row = { id: string; name: string; created_at: string };

type CoolingRow = {
  profile_id: string;
  profile_name: string;
  company: string;
  applied_at: string;
  reopens_at: string;
};

type Props = {
  teamId: string;
  userId: string;
  canEdit: boolean;
  rows: Row[];
  cooling: CoolingRow[];
};

/** Whole days from now until `when`, floored at zero. */
function daysUntil(when: string) {
  const ms = new Date(when).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

export function BlocklistPanel({
  teamId,
  userId,
  canEdit,
  rows,
  cooling,
}: Props) {
  const router = useRouter();
  const { message } = App.useApp();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;

    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("blocked_company").insert({
      name: trimmed,
      // Stored alongside the display name so matching survives punctuation,
      // case, and legal suffixes — "Acme, Inc." and "acme" collapse to one key,
      // which the unique index then enforces.
      normalized_name: normalizeCompany(trimmed),
      team_id: teamId,
      created_by: userId,
    });
    setBusy(false);

    if (error) {
      // 23505 is unique_violation — already blocked, which isn't a failure
      // worth alarming about.
      message[error.code === "23505" ? "info" : "error"](
        error.code === "23505" ? `${trimmed} is already blocked.` : error.message,
      );
      return;
    }
    setName("");
    router.refresh();
  };

  const remove = async (id: string) => {
    const supabase = createClient();
    const { error } = await supabase.from("blocked_company").delete().eq("id", id);
    if (error) {
      message.error(error.message);
      return;
    }
    router.refresh();
  };

  return (
    <>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        Blocklist
      </Typography.Title>

      <Card styles={{ body: { paddingTop: 8 } }}>
        <Tabs
          items={[
            {
              key: "permanent",
              label: (
                <Space size={6}>
                  <StopOutlined />
                  Blocked
                  <Tag>{rows.length}</Tag>
                </Space>
              ),
              children: (
                <>
                  <Typography.Paragraph type="secondary">
                    Companies that must never receive an application, from any
                    profile. The entry row on the applications grid rejects a
                    match before it can be saved.
                  </Typography.Paragraph>

                  {canEdit && (
                    <Space.Compact style={{ width: "100%", marginBottom: 16 }}>
                      <Input
                        value={name}
                        placeholder="Company name"
                        onChange={(e) => setName(e.target.value)}
                        onPressEnter={add}
                      />
                      <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        loading={busy}
                        onClick={add}
                      >
                        Block
                      </Button>
                    </Space.Compact>
                  )}

                  <Table<Row>
                    rowKey="id"
                    size="small"
                    dataSource={rows}
                    pagination={{ pageSize: 25, hideOnSinglePage: true }}
                    locale={{ emptyText: "Nothing blocked." }}
                    columns={[
                      {
                        title: "Company",
                        dataIndex: "name",
                        sorter: (a, b) => a.name.localeCompare(b.name),
                      },
                      {
                        title: "Blocked",
                        dataIndex: "created_at",
                        width: 160,
                        render: (value: string) => formatDate(value),
                      },
                      ...(canEdit
                        ? [
                            {
                              title: "",
                              width: 56,
                              render: (_: unknown, row: Row) => (
                                <Popconfirm
                                  title="Unblock this company?"
                                  onConfirm={() => remove(row.id)}
                                >
                                  <Button
                                    type="text"
                                    danger
                                    icon={<DeleteOutlined />}
                                  />
                                </Popconfirm>
                              ),
                            },
                          ]
                        : []),
                    ]}
                  />
                </>
              ),
            },
            {
              key: "cooling",
              label: (
                <Space size={6}>
                  <ClockCircleOutlined />
                  Cooling off
                  <Tag>{cooling.length}</Tag>
                </Space>
              ),
              children: (
                <>
                  <Typography.Paragraph type="secondary">
                    A profile can&apos;t be sent to the same company twice within
                    14 days. This list is derived from recent applications rather
                    than maintained — entries appear when someone applies and
                    disappear on their own, so there is nothing here to edit.
                  </Typography.Paragraph>

                  <Table<CoolingRow>
                    rowKey={(row) => `${row.profile_id}-${row.company}`}
                    size="small"
                    dataSource={cooling}
                    pagination={{ pageSize: 25, hideOnSinglePage: true }}
                    locale={{
                      emptyText: "No company is cooling off right now.",
                    }}
                    columns={[
                      {
                        title: "Profile",
                        dataIndex: "profile_name",
                        sorter: (a, b) =>
                          a.profile_name.localeCompare(b.profile_name),
                      },
                      {
                        title: "Company",
                        dataIndex: "company",
                        sorter: (a, b) => a.company.localeCompare(b.company),
                      },
                      {
                        title: "Applied",
                        dataIndex: "applied_at",
                        width: 150,
                        render: (value: string) => formatDate(value),
                      },
                      {
                        title: "Reopens",
                        dataIndex: "reopens_at",
                        width: 200,
                        defaultSortOrder: "ascend",
                        sorter: (a, b) =>
                          a.reopens_at.localeCompare(b.reopens_at),
                        render: (value: string) => {
                          const days = daysUntil(value);
                          return (
                            <Space size={6}>
                              <Tag color={days <= 3 ? "green" : "gold"}>
                                {days === 0
                                  ? "today"
                                  : `${days} day${days === 1 ? "" : "s"}`}
                              </Tag>
                              <Typography.Text type="secondary">
                                {formatDate(value)}
                              </Typography.Text>
                            </Space>
                          );
                        },
                      },
                    ]}
                  />
                </>
              ),
            },
          ]}
        />
      </Card>
    </>
  );
}
