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
