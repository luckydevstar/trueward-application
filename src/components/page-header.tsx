"use client";

import { Typography } from "antd";
import type { ReactNode } from "react";

/**
 * A page's title, its one-line description, and its actions — the same on
 * every dashboard page. Wraps instead of colliding: on a laptop or a phone
 * the actions drop under the title rather than squeezing it.
 */
export function PageHeader({
  title,
  description,
  extra,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Buttons, filters, search — laid out in a row that wraps too. */
  extra?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: "12px 16px",
        marginBottom: 20,
      }}
    >
      <div style={{ minWidth: 0, flex: "1 1 320px" }}>
        <Typography.Title level={3} style={{ margin: 0, letterSpacing: "-0.02em" }}>
          {title}
        </Typography.Title>
        {description && <Typography.Text type="secondary">{description}</Typography.Text>}
      </div>
      {extra && <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>{extra}</div>}
    </div>
  );
}
