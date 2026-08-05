"use client";

import { Card, Skeleton, Typography } from "antd";
import { Suspense } from "react";

import { LoginForm } from "./login-form";

/**
 * Client, not server, because of `Typography.Title` — see the note in
 * CLAUDE.md. antd's compound subcomponents are undefined when antd is imported
 * from a Server Component, and the failure mode is an opaque "Element type is
 * invalid" at render time rather than a type error.
 */
export function LoginCard() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "#f6f7f9",
      }}
    >
      <Card style={{ width: "100%", maxWidth: 400 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 20,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 32,
              height: 32,
              borderRadius: 9,
              display: "grid",
              placeItems: "center",
              background: "linear-gradient(135deg, #2f5bea, #7c3aed)",
              color: "#fff",
              fontWeight: 700,
            }}
          >
            T
          </span>
          <Typography.Title level={4} style={{ margin: 0 }}>
            Trueward <span style={{ opacity: 0.55 }}>Guru</span>
          </Typography.Title>
        </div>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 24 }}>
          Track applications and build tailored resumes.
        </Typography.Paragraph>
        {/*
          LoginForm reads `next` via useSearchParams, which opts the subtree
          into client-side rendering. Without this boundary Next refuses to
          prerender the page at all.
        */}
        <Suspense fallback={<Skeleton active paragraph={{ rows: 4 }} />}>
          <LoginForm />
        </Suspense>
      </Card>
    </main>
  );
}
