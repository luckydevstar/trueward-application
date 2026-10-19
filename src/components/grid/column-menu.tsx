"use client";

import { ArrowDownOutlined, ArrowUpOutlined, SettingOutlined } from "@ant-design/icons";
import { Button, Checkbox, Popover, Tooltip, Typography } from "antd";

/**
 * The Columns button: every column in its current order, to show or hide and
 * to move — the keyboard's and the touch screen's way to do what dragging a
 * header's grip does. "Reset" goes back to the designed layout.
 */
export function ColumnMenu({
  columns,
  hidden,
  onToggle,
  onShift,
  onReset,
  customised,
}: {
  /** In display order, without pinned columns. */
  columns: Array<{ key: string; label: string }>;
  hidden: Set<string>;
  onToggle: (key: string) => void;
  onShift: (key: string, by: -1 | 1) => void;
  onReset: () => void;
  customised: boolean;
}) {
  const shown = columns.filter((c) => !hidden.has(c.key));

  const content = (
    <div style={{ width: 250, display: "flex", flexDirection: "column", gap: 2 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12, marginBottom: 6 }}>
        Tick to show; arrows to move. Or drag a header by its grip.
      </Typography.Text>
      {columns.map((c) => {
        const at = shown.findIndex((s) => s.key === c.key);
        const isHidden = hidden.has(c.key);
        return (
          <div key={c.key} style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 0" }}>
            <Checkbox
              checked={!isHidden}
              // Something has to stay on screen.
              disabled={!isHidden && shown.length === 1}
              onChange={() => onToggle(c.key)}
              style={{ flex: 1, minWidth: 0 }}
            >
              <span style={{ color: isHidden ? "#94a3b8" : undefined }}>{c.label}</span>
            </Checkbox>
            <Button
              size="small"
              type="text"
              icon={<ArrowUpOutlined />}
              aria-label={`Move ${c.label} left`}
              disabled={isHidden || at <= 0}
              onClick={() => onShift(c.key, -1)}
            />
            <Button
              size="small"
              type="text"
              icon={<ArrowDownOutlined />}
              aria-label={`Move ${c.label} right`}
              disabled={isHidden || at < 0 || at === shown.length - 1}
              onClick={() => onShift(c.key, 1)}
            />
          </div>
        );
      })}
      <Button size="small" type="link" disabled={!customised} onClick={onReset} style={{ alignSelf: "flex-start", paddingInline: 0, marginTop: 6 }}>
        Reset to the default layout
      </Button>
    </div>
  );

  return (
    <Popover content={content} title="Columns" trigger="click" placement="bottomRight">
      <Tooltip title="Show, hide and move columns">
        <Button icon={<SettingOutlined />}>
          Columns{hidden.size ? ` · ${hidden.size} hidden` : ""}
        </Button>
      </Tooltip>
    </Popover>
  );
}
