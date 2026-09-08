"use client";

/**
 * One line of text that truncates with an ellipsis, and scrolls itself on
 * hover so the hidden part can still be read.
 *
 * Grid columns are narrow and resizable, so overflow is the normal case rather
 * than the exception. An ellipsis alone means the only way to read a long value
 * is to widen its column and then put it back.
 *
 * The scroll distance is `container width − text width`, which is exactly what
 * `calc(100cqw - 100%)` resolves to inside a container-query container: `cqw`
 * measures the wrapper, `%` measures the inline-block text. So no ref, no
 * ResizeObserver, no measuring pass — the browser computes the distance from
 * the same layout it just performed, and a column resize is picked up for free.
 *
 * `min()` clamps it at zero: text that already fits has a positive difference,
 * which would otherwise shove it out to the right.
 */
export function Marquee({
  children,
  title,
}: {
  children: React.ReactNode;
  /**
   * Full text, as a native tooltip. Also the whole answer for anyone who has
   * asked for reduced motion, since the scroll is switched off for them.
   */
  title?: string;
}) {
  return (
    <span className="tw-marquee">
      <span title={title}>{children}</span>
    </span>
  );
}

/**
 * Rendered once per table. A string rather than a CSS module because the class
 * lands on antd-owned cell markup, which a module's hashed name would not
 * reach.
 */
export const MARQUEE_CSS = `
  .tw-marquee {
    display: block;
    overflow: hidden;
    container-type: inline-size;
  }
  .tw-marquee > span {
    display: inline-block;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    vertical-align: bottom;
  }
  /*
   * Hover lifts the width cap so the text lays out at its full length; the
   * wrapper still clips it, and the animation walks it left by the overflow.
   */
  .tw-marquee:hover > span {
    max-width: none;
    overflow: visible;
    text-overflow: clip;
    animation: tw-marquee 4.5s ease-in-out infinite alternate;
  }
  @keyframes tw-marquee {
    /* Holds at each end, so the start is readable before it moves. */
    0%, 18% { transform: translateX(0); }
    82%, 100% { transform: translateX(min(0px, calc(100cqw - 100%))); }
  }
  /*
   * Reduced motion keeps the ellipsis rather than swapping the animation for a
   * jump-cut — the title attribute is the way to read it, and a silent jump
   * would be the same motion complaint in one frame.
   */
  @media (prefers-reduced-motion: reduce) {
    .tw-marquee:hover > span {
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      animation: none;
    }
  }
`;
