"use client";

import { LockOutlined, MailOutlined } from "@ant-design/icons";
import { App, Button, Form, Input, Tabs } from "antd";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { createClient } from "@/lib/supabase/client";

type Values = { email: string; password: string; name?: string };

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { message } = App.useApp();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [busy, setBusy] = useState(false);

  // Only ever a same-origin path. Taking `next` straight from the query string
  // would let a crafted link bounce a freshly signed-in user to another origin.
  const raw = params.get("next");
  const next = raw?.startsWith("/") && !raw.startsWith("//") ? raw : "/dashboard";

  const submit = async ({ email, password, name }: Values) => {
    setBusy(true);
    const supabase = createClient();
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          // Read by the handle_new_user trigger to populate app_user.name.
          options: { data: { name: name ?? "" } },
        });
        if (error) throw error;
        message.success("Account created. Check your email to confirm.");
        setMode("signin");
        return;
      }

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
      <Tabs
        activeKey={mode}
        onChange={(key) => setMode(key as typeof mode)}
        items={[
          { key: "signin", label: "Sign in" },
          { key: "signup", label: "Create account" },
        ]}
      />
      <Form<Values> layout="vertical" onFinish={submit} requiredMark={false}>
        {mode === "signup" && (
          <Form.Item
            name="name"
            label="Name"
            rules={[{ required: true, message: "Enter your name" }]}
          >
            <Input placeholder="Jane Doe" autoComplete="name" />
          </Form.Item>
        )}
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
          rules={[
            { required: true, message: "Enter your password" },
            { min: 8, message: "At least 8 characters" },
          ]}
        >
          <Input.Password
            prefix={<LockOutlined />}
            autoComplete={
              mode === "signup" ? "new-password" : "current-password"
            }
          />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={busy}>
          {mode === "signup" ? "Create account" : "Sign in"}
        </Button>
      </Form>
    </>
  );
}
