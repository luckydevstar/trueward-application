"use client";

import {
  AlignLeftOutlined,
  MenuOutlined,
  SettingOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import {
  Button,
  Checkbox,
  Divider,
  Dropdown,
  Segmented,
  Select,
  Slider,
  Space,
  Tooltip,
  Typography,
} from "antd";

import { ACCENT_NAMES } from "@/lib/pdf/resume-pdf";
import { TEMPLATES } from "@/lib/pdf/templates";
import {
  HEADER_FIELD_LABELS,
  resolveHeaderFields,
} from "@/lib/resume-header";
import type { ResumeStyle } from "@/lib/supabase/types";

/**
 * Re-exported so the builder keeps importing its style vocabulary from one
 * place. Imported above as well — a bare `export … from` re-exports without
 * binding the name locally, and this file uses both.
 */
export { TEMPLATES };
export const ACCENTS = ACCENT_NAMES;

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

  const fields = resolveHeaderFields(style.header);

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
        <Select
          size="small"
          value={template}
          onChange={onTemplateChange}
          style={{ width: 150 }}
          // A dropdown rather than a segmented control: five templates with a
          // sentence each don't fit on one strip, and the hint is what makes
          // them choosable without rendering each in turn.
          optionLabelProp="label"
          options={TEMPLATES.map((t) => ({
            value: t.id,
            label: t.label,
            title: t.hint,
            children: (
              <div>
                <div>{t.label}</div>
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  {t.hint}
                </Typography.Text>
              </div>
            ),
          }))}
        />
      </Field>

      <Bar />

      <Field label="Header">
        <Space.Compact size="small">
          <Segmented
            size="small"
            value={style.headerPosition ?? "center"}
            onChange={(v) => patch({ headerPosition: v as "left" | "center" })}
            options={["left", "center"]}
          />
          <Dropdown
            trigger={["click"]}
            placement="bottomRight"
            popupRender={() => (
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #e5e7eb",
                  borderRadius: 8,
                  padding: 12,
                  boxShadow: "0 6px 16px rgba(0,0,0,.08)",
                }}
              >
                <Typography.Text
                  type="secondary"
                  style={{ fontSize: 11, display: "block", marginBottom: 8 }}
                >
                  Show in header
                </Typography.Text>
                <Space orientation="vertical" size={4}>
                  {HEADER_FIELD_LABELS.map(({ key, label }) => (
                    <Checkbox
                      key={key}
                      checked={fields[key]}
                      onChange={(e) =>
                        patch({ header: { ...fields, [key]: e.target.checked } })
                      }
                    >
                      {label}
                    </Checkbox>
                  ))}
                </Space>
              </div>
            )}
          >
            <Button size="small" icon={<SettingOutlined />} />
          </Dropdown>
        </Space.Compact>
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
