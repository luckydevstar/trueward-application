"use client";

import { LockOutlined, MailOutlined } from "@ant-design/icons";
import { App, Button, Form, Input, Typography } from "antd";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { createClient } from "@/lib/supabase/client";

type Values = { email: string; password: string };

/**
 * Sign-in only.
 *
 * There was a "Create account" tab. Every account here is created by the layer
 * above it — the super admin adds subadmins, a subadmin adds bidders — so a
 * self-registered account never belonged to anyone, and while it existed the
 * database had to be right about a stranger's every write. Turn sign-ups off
 * in Supabase as well (Authentication → Sign In / Providers → "Allow new users
 * to sign up"): removing the form does not stop someone calling the Auth API
 * directly with the public anon key.
 */
export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);

  // Only ever a same-origin path. Taking `next` straight from the query string
  // would let a crafted link bounce a freshly signed-in user to another origin.
  const raw = params.get("next");
  const next = raw?.startsWith("/") && !raw.startsWith("//") ? raw : "/dashboard";

  const submit = async ({ email, password }: Values) => {
    setBusy(true);
    const supabase = createClient();
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;

      router.replace(next);
      // The dashboard is a Server Component tree, so its data was rendered
      // before this session existed. Without the refresh it would show the
      // signed-out render from the router cache.
      router.refresh();
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : "Could not sign in.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Form<Values> layout="vertical" onFinish={submit} requiredMark={false}>
        <Form.Item
          name="email"
          label="Email"
          rules={[
            { required: true, message: "Enter your email" },
            { type: "email", message: "That doesn't look like an email" },
          ]}
        >
          <Input
            prefix={<MailOutlined />}
            placeholder="you@example.com"
            autoComplete="email"
          />
        </Form.Item>
        <Form.Item
          name="password"
          label="Password"
          rules={[{ required: true, message: "Enter your password" }]}
        >
          <Input.Password prefix={<LockOutlined />} autoComplete="current-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={busy}>
          Sign in
        </Button>
      </Form>
      <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>
        Accounts are created by your team&apos;s subadmin.
      </Typography.Paragraph>
    </>
  );
}
