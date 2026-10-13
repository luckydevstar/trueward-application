"use client";

import { Card, Skeleton, Typography } from "antd";
import { Suspense } from "react";

import { BRAND } from "@/lib/theme";

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
        // Two soft glows of the brand colours over the page tone: depth without
        // an image to load.
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
          maxWidth: 400,
          boxShadow:
            "0 1px 2px rgba(15, 23, 42, 0.04), 0 24px 48px -24px rgba(15, 23, 42, 0.25)",
        }}
        styles={{ body: { padding: 32 } }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 22,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 38,
              height: 38,
              borderRadius: 11,
              display: "grid",
              placeItems: "center",
              background: BRAND.gradient,
              boxShadow: "0 8px 20px -8px rgba(139, 92, 246, 0.7)",
              color: "#fff",
              fontWeight: 700,
              fontSize: 17,
            }}
          >
            T
          </span>
          <Typography.Title level={4} style={{ margin: 0, letterSpacing: "-0.02em" }}>
            Trueward <span style={{ opacity: 0.5, fontWeight: 500 }}>Guru</span>
          </Typography.Title>
        </div>
        <Typography.Title level={3} style={{ margin: "0 0 4px", letterSpacing: "-0.02em" }}>
          Welcome back
        </Typography.Title>
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
