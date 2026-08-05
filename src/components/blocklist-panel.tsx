"use client";

import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import {
  App,
  Button,
  Card,
  Empty,
  Input,
  List,
  Popconfirm,
  Space,
  Typography,
} from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { formatDate, normalizeCompany } from "@/lib/status";

type Row = { id: string; name: string; created_at: string };

type Props = {
  teamId: string;
  userId: string;
  canEdit: boolean;
  rows: Row[];
};

export function BlocklistPanel({ teamId, userId, canEdit, rows }: Props) {
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
      // Stored alongside the display name so matching survives punctuation and
      // case differences — "Acme, Inc." and "acme inc" collapse to one key,
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
    const { error } = await supabase
      .from("blocked_company")
      .delete()
      .eq("id", id);
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
      <Typography.Paragraph type="secondary">
        Companies that must never receive an application. The record form
        rejects a match before it can be saved.
      </Typography.Paragraph>

      <Card>
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

        {rows.length === 0 ? (
          <Empty description="Nothing blocked." />
        ) : (
          <List
            dataSource={rows}
            renderItem={(row) => (
              <List.Item
                actions={
                  canEdit
                    ? [
                        <Popconfirm
                          key="delete"
                          title="Unblock this company?"
                          onConfirm={() => remove(row.id)}
                        >
                          <Button type="text" danger icon={<DeleteOutlined />} />
                        </Popconfirm>,
                      ]
                    : []
                }
              >
                <List.Item.Meta
                  title={row.name}
                  description={`Blocked ${formatDate(row.created_at)}`}
                />
              </List.Item>
            )}
          />
        )}
      </Card>
    </>
  );
}
