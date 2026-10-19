"use client";

import { HolderOutlined } from "@ant-design/icons";
import { Resizable, type ResizeCallbackData } from "react-resizable";
import { useState, type DragEvent, type SyntheticEvent } from "react";

import "react-resizable/css/styles.css";

/** The drag payload's type, so a dropped file or link is never mistaken for a column. */
const COLUMN_TYPE = "application/x-trueward-column";

/**
 * A `<th>` with a drag handle on its right edge, and — when the table lets
 * its columns move — a grip on its left to drag it somewhere else.
 *
 * Passed to antd's Table via `components.header.cell`. antd has no built-in
 * column resizing or reordering; this is the documented way to add both.
 * The grip is the only thing that starts a move, so clicking the title still
 * sorts and dragging the right edge still resizes.
 *
 * Columns with no `width` render as a plain header — a resize handle on an
 * auto-sized column fights the table's own layout algorithm and snaps back.
 */
export function ResizableTitle(
  props: React.HTMLAttributes<HTMLElement> & {
    onResize?: (e: SyntheticEvent, data: ResizeCallbackData) => void;
    width?: number;
    /** Set for a column that can be moved: its key, and what to do on a drop. */
    columnKey?: string;
    onMoveColumn?: (key: string, target: string, place: "before" | "after") => void;
  },
) {
  const { onResize, width, columnKey, onMoveColumn, ...rest } = props;
  const [drop, setDrop] = useState<"before" | "after" | null>(null);

  const movable = Boolean(columnKey && onMoveColumn);
  const placeOf = (e: DragEvent<HTMLElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return e.clientX < box.left + box.width / 2 ? "before" : "after";
  };

  const dropProps = movable
    ? {
        onDragOver: (e: DragEvent<HTMLElement>) => {
          if (!e.dataTransfer.types.includes(COLUMN_TYPE)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setDrop(placeOf(e));
        },
        onDragLeave: () => setDrop(null),
        onDrop: (e: DragEvent<HTMLElement>) => {
          const key = e.dataTransfer.getData(COLUMN_TYPE);
          setDrop(null);
          if (!key) return;
          e.preventDefault();
          onMoveColumn!(key, columnKey!, placeOf(e));
        },
      }
    : {};

  const grip = movable ? (
    <span
      className="tw-col-grip"
      draggable
      role="button"
      aria-label="Drag to move this column"
      title="Drag to move this column"
      onClick={(e) => e.stopPropagation()}
      onDragStart={(e) => {
        e.stopPropagation();
        e.dataTransfer.setData(COLUMN_TYPE, columnKey!);
        e.dataTransfer.effectAllowed = "move";
      }}
    >
      <HolderOutlined />
    </span>
  ) : null;

  const style = {
    ...rest.style,
    position: "relative" as const,
    ...(movable ? { paddingLeft: 22 } : {}),
    ...(drop === "before" ? { boxShadow: "inset 3px 0 0 #4f46e5" } : {}),
    ...(drop === "after" ? { boxShadow: "inset -3px 0 0 #4f46e5" } : {}),
  };

  if (!width) {
    return (
      <th {...rest} {...dropProps} style={movable ? style : rest.style}>
        {grip}
        {rest.children}
      </th>
    );
  }

  return (
    <Resizable
      width={width}
      height={0}
      handle={
        <span
          className="react-resizable-handle"
          // The handle lives inside the header cell, which is itself a sort
          // trigger. Without this the drag that resizes also re-sorts.
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            right: -5,
            bottom: 0,
            zIndex: 1,
            width: 10,
            height: "100%",
            cursor: "col-resize",
            backgroundImage: "none",
          }}
        />
      }
      onResize={onResize}
      draggableOpts={{ enableUserSelectHack: false }}
    >
      <th {...rest} {...dropProps} style={style}>
        {grip}
        {rest.children}
      </th>
    </Resizable>
  );
}

/**
 * The grip's look: faint until the header is hovered, always there on a touch
 * screen — where dragging doesn't work and the Columns menu does the moving,
 * but it still says the columns can move.
 */
export const COLUMN_GRIP_CSS = `
  .tw-col-grip {
    position: absolute;
    left: 4px;
    top: 50%;
    transform: translateY(-50%);
    display: grid;
    place-items: center;
    width: 16px;
    height: 22px;
    border-radius: 4px;
    color: #94a3b8;
    cursor: grab;
    opacity: 0.35;
    transition: opacity 0.15s ease, background 0.15s ease;
  }
  th:hover > .tw-col-grip,
  .tw-col-grip:focus-visible { opacity: 1; }
  .tw-col-grip:hover { background: #eef2ff; color: #4f46e5; }
  .tw-col-grip:active { cursor: grabbing; }
`;

/**
 * Class for a Table whose column widths must be taken literally.
 *
 * rc-table styles its scrolling table `width: <scroll.x>px; min-width: 100%`.
 * The min-width is the sensible default — it stops a narrow table sitting in a
 * wide card with dead space beside it — but under `table-layout: fixed` it
 * also means the browser hands the surplus back to the columns, proportionally.
 * So dragging every column narrow appears to do nothing the moment the total
 * drops below the container: the widths are honoured relative to each other and
 * ignored absolutely.
 *
 * For a resizable grid that is the wrong trade. A column is set to 120px
 * because someone dragged it to 120px.
 *
 * `!important` because the rule it overrides is an inline style, which is the
 * only thing a stylesheet cannot outrank any other way.
 */
export const EXACT_WIDTH_CLASS = "tw-exact-widths";

export const EXACT_WIDTH_CSS = `
  .${EXACT_WIDTH_CLASS} .ant-table-container table { min-width: 0 !important; }
`;
