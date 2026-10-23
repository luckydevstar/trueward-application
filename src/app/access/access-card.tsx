"use client";

import {
  ClockCircleFilled,
  CopyOutlined,
  LockFilled,
  ReloadOutlined,
  StopFilled,
  WarningFilled,
} from "@ant-design/icons";
import { Alert, App, Button, Card, Form, Input, Typography } from "antd";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import type { GateStatus } from "@/lib/gate";

import { requestAccess } from "./actions";

type Props = {
  site: string;
  status: Exclude<GateStatus, "allowed">;
  code: string | null;
  contact: string | null;
};

const LOOK: Record<Props["status"], { icon: ReactNode; tint: string; title: string; body: string }> = {
  unknown: {
    icon: <LockFilled />,
    tint: "#4f46e5",
    title: "This device isn't approved yet",
    body: "Trueward sites only open on devices the admin has approved. Ask for access below — once it's approved, this page lets you straight in.",
  },
  not_permitted: {
    icon: <LockFilled />,
    tint: "#4f46e5",
    title: "Not approved for this site",
    body: "This device is approved for other Trueward sites, but not this one. Ask for this one too.",
  },
  pending: {
    icon: <ClockCircleFilled />,
    tint: "#d97706",
    title: "Waiting for approval",
    body: "Your request is with the admin. As soon as it's approved, this page lets you in — check again any time.",
  },
  blocked: {
    icon: <StopFilled />,
    tint: "#dc2626",
    title: "This device has been blocked",
    body: "It can't open Trueward sites. If you think that's a mistake, contact the admin.",
  },
  unknown_app: {
    icon: <WarningFilled />,
    tint: "#d97706",
    title: "This site isn't set up yet",
    body: "The admin needs to register this site with the device gate.",
  },
  error: {
    icon: <WarningFilled />,
    tint: "#d97706",
    title: "Couldn't check this device",
    body: "Something went wrong on our side. Try again in a moment.",
  },
};

/**
 * The page a browser sees before it is approved. The same file lives in the
 * application, the calendar and finance.
 */
export function AccessCard({ site, status, code, contact }: Props) {
  const router = useRouter();
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const look = LOOK[status];
  const canAsk = status === "unknown" || status === "not_permitted";

  const submit = async (values: { name: string; note?: string }) => {
    setBusy(true);
    const result = await requestAccess({ name: values.name, note: values.note ?? "" });
    setBusy(false);
    if (!result.ok) {
      message.error(result.error);
      return;
    }
    message.success("Request sent.");
    router.refresh();
  };

  const checkAgain = () => {
    setChecking(true);
    router.refresh();
    // refresh() doesn't say when it's done; the spinner is only a nod.
    setTimeout(() => setChecking(false), 1200);
  };

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: `
          radial-gradient(60rem 40rem at 10% -10%, rgba(99, 102, 241, 0.18), transparent 60%),
          radial-gradient(50rem 36rem at 110% 110%, rgba(139, 92, 246, 0.16), transparent 60%),
          #f5f7fb`,
      }}
    >
      <Card
        variant="borderless"
        style={{
          width: "100%",
          maxWidth: 440,
          boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04), 0 24px 48px -24px rgba(15, 23, 42, 0.25)",
        }}
        styles={{ body: { padding: 32 } }}
      >
        <span
          aria-hidden
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            display: "grid",
            placeItems: "center",
            fontSize: 20,
            color: look.tint,
            background: `${look.tint}14`,
            marginBottom: 16,
          }}
        >
          {look.icon}
        </span>
        <Typography.Text type="secondary" style={{ fontSize: 12, letterSpacing: "0.04em" }}>
          {site.toUpperCase()}
        </Typography.Text>
        <Typography.Title level={3} style={{ margin: "2px 0 6px", letterSpacing: "-0.02em" }}>
          {look.title}
        </Typography.Title>
        <Typography.Paragraph type="secondary">{look.body}</Typography.Paragraph>

        {code && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "12px 14px",
              borderRadius: 10,
              background: "#f5f7ff",
              marginBottom: 20,
            }}
          >
            <div>
              <div style={{ fontSize: 11, color: "#64748b" }}>Device code</div>
              <div
                style={{
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontSize: 20,
                  fontWeight: 600,
                  letterSpacing: "0.08em",
                  color: "#0f172a",
                }}
              >
                {code}
              </div>
            </div>
            <Button
              type="text"
              icon={<CopyOutlined />}
              aria-label="Copy device code"
              onClick={() => {
                navigator.clipboard.writeText(code);
                message.success("Copied.");
              }}
            />
          </div>
        )}

        {canAsk && (
          <Form layout="vertical" onFinish={submit} requiredMark={false}>
            <Form.Item
              name="name"
              label="Your name"
              rules={[{ required: true, whitespace: true, message: "Enter your name." }]}
            >
              <Input placeholder="So the admin knows who's asking" maxLength={80} autoFocus />
            </Form.Item>
            <Form.Item name="note" label="Note (optional)">
              <Input.TextArea
                placeholder="e.g. which computer this is, or what you need"
                autoSize={{ minRows: 2, maxRows: 5 }}
                maxLength={500}
              />
            </Form.Item>
            <Button type="primary" htmlType="submit" block size="large" loading={busy}>
              Request access
            </Button>
          </Form>
        )}

        {(status === "pending" || status === "error") && (
          <Button block size="large" icon={<ReloadOutlined />} loading={checking} onClick={checkAgain}>
            Check again
          </Button>
        )}

        {contact && (
          <Alert
            type="info"
            showIcon={false}
            style={{ marginTop: 16 }}
            title={
              <Typography.Text style={{ fontSize: 13 }}>
                Questions? Contact {contact}
                {code ? ` and mention device ${code}` : ""}.
              </Typography.Text>
            }
          />
        )}
      </Card>
    </main>
  );
}
