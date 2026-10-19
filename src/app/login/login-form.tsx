"use client";

import { LockOutlined, MailOutlined } from "@ant-design/icons";
import { Alert, Button, Form, Input, Typography } from "antd";
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
  const [busy, setBusy] = useState(false);
  // Shown in the form, where the eye already is, and kept until the next try.
  const [error, setError] = useState<string | null>(null);

  // Only ever a same-origin path. Taking `next` straight from the query string
  // would let a crafted link bounce a freshly signed-in user to another origin.
  const raw = params.get("next");
  const next = raw?.startsWith("/") && !raw.startsWith("//") ? raw : "/dashboard";

  const submit = async ({ email, password }: Values) => {
    setBusy(true);
    setError(null);
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
    } catch (caught) {
      setError(signInProblem(caught));
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
        {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} />}
        <Button type="primary" htmlType="submit" block loading={busy}>
          Sign in
        </Button>
      </Form>
      <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>
        Accounts are created by your team&apos;s subadmin. Forgotten your password? Ask them to set a new one
        — then change it under Account.
      </Typography.Paragraph>
    </>
  );
}

/** Supabase's wording, said for a person signing in. */
function signInProblem(error: unknown): string {
  const raw = error instanceof Error ? error.message : "";
  if (/invalid login credentials/i.test(raw)) return "That email and password don't match an account.";
  if (/email not confirmed/i.test(raw)) return "This account hasn't been confirmed yet — ask your subadmin.";
  if (/rate limit|too many/i.test(raw)) return "Too many tries. Wait a minute, then try again.";
  if (/fetch|network/i.test(raw)) return "Couldn't reach the server. Check your connection and try again.";
  return raw || "Couldn't sign you in.";
}
