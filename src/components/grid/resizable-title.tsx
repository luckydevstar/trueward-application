"use client";

import { Resizable, type ResizeCallbackData } from "react-resizable";
import type { SyntheticEvent } from "react";

import "react-resizable/css/styles.css";

/**
 * A `<th>` with a drag handle on its right edge.
 *
 * Passed to antd's Table via `components.header.cell`. antd has no built-in
 * column resizing; this is the documented way to add it.
 *
 * Columns with no `width` render as a plain header — a resize handle on an
 * auto-sized column fights the table's own layout algorithm and snaps back.
 */
export function ResizableTitle(
  props: React.HTMLAttributes<HTMLElement> & {
    onResize?: (e: SyntheticEvent, data: ResizeCallbackData) => void;
    width?: number;
  },
) {
  const { onResize, width, ...rest } = props;

  if (!width) return <th {...rest} />;

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
      <th {...rest} style={{ ...rest.style, position: "relative" }} />
    </Resizable>
  );
}

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
