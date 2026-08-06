"use client";

import {
  AlignLeftOutlined,
  MenuOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import { Button, Divider, Segmented, Slider, Tooltip, Typography } from "antd";

import type { ResumeStyle } from "@/lib/supabase/types";

export const TEMPLATES = ["classic", "modern", "compact"];
export const ACCENTS = ["slate", "blue", "emerald"];

export const DEFAULT_STYLE: ResumeStyle = {
  fontScale: 100,
  headerPosition: "center",
  accent: "slate",
  lineSpacing: 1.4,
  justify: false,
};

type Props = {
  template: string;
  style: ResumeStyle;
  onTemplateChange: (template: string) => void;
  onStyleChange: (next: ResumeStyle) => void;
};

/**
 * A single horizontal control strip rather than a panel.
 *
 * These controls are adjusted while watching the preview, so they belong on one
 * line next to it — a stacked card pushed the preview down and made every
 * adjustment a scroll. `flexWrap` keeps it honest on narrow screens instead of
 * overflowing.
 */
export function ResumeStyleToolbar({
  template,
  style,
  onTemplateChange,
  onStyleChange,
}: Props) {
  const patch = (values: Partial<ResumeStyle>) =>
    onStyleChange({ ...style, ...values });

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 5,
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 4,
        rowGap: 8,
        padding: "8px 12px",
        marginBottom: 12,
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
      }}
    >
      <Field label="Template">
        <Segmented
          size="small"
          value={template}
          onChange={(v) => onTemplateChange(String(v))}
          options={TEMPLATES}
        />
      </Field>

      <Bar />

      <Field label="Header">
        <Segmented
          size="small"
          value={style.headerPosition ?? "center"}
          onChange={(v) =>
            patch({ headerPosition: v as "left" | "center" })
          }
          options={["left", "center"]}
        />
      </Field>

      <Bar />

      <Field label="Accent">
        <Segmented
          size="small"
          value={style.accent ?? "slate"}
          onChange={(v) => patch({ accent: String(v) })}
          options={ACCENTS}
        />
      </Field>

      <Bar />

      <Field label="Body text">
        <Segmented
          size="small"
          value={style.justify ? "justify" : "left"}
          onChange={(v) => patch({ justify: v === "justify" })}
          options={[
            { value: "left", icon: <AlignLeftOutlined /> },
            { value: "justify", icon: <MenuOutlined /> },
          ]}
        />
      </Field>

      <Bar />

      <Field label={`Font ${style.fontScale ?? 100}%`}>
        <Slider
          min={80}
          max={120}
          value={style.fontScale ?? 100}
          onChange={(v) => patch({ fontScale: v })}
          style={{ width: 96, margin: "0 8px" }}
          tooltip={{ open: false }}
        />
      </Field>

      <Bar />

      <Field label={`Leading ${(style.lineSpacing ?? 1.4).toFixed(2)}`}>
        <Slider
          min={1.1}
          max={1.8}
          step={0.05}
          value={style.lineSpacing ?? 1.4}
          onChange={(v) => patch({ lineSpacing: v })}
          style={{ width: 96, margin: "0 8px" }}
          tooltip={{ open: false }}
        />
      </Field>

      <div style={{ marginLeft: "auto" }}>
        <Tooltip title="Reset styling to defaults">
          <Button
            size="small"
            type="text"
            icon={<UndoOutlined />}
            onClick={() => onStyleChange(DEFAULT_STYLE)}
          />
        </Tooltip>
      </div>
    </div>
  );
}

/** Label above control, so the strip stays one row tall. */
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Typography.Text
        type="secondary"
        style={{ fontSize: 10, lineHeight: 1, paddingLeft: 2 }}
      >
        {label}
      </Typography.Text>
      {children}
    </div>
  );
}

const Bar = () => (
  <Divider orientation="vertical" style={{ height: 28, margin: "0 4px" }} />
);
