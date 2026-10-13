import type { ThemeConfig } from "antd";

/**
 * The few brand values antd tokens can't carry — a gradient, the sidebar's
 * night tone — shared by the shell and the sign-in page so they cannot drift.
 * Trueward Calendar uses the same values in its own providers.tsx.
 */
export const BRAND = {
  primary: "#4f46e5",
  /** The mark, the avatar and the sign-in glow. */
  gradient: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
  /** Slightly lifted at the bottom so a long sidebar doesn't read as a slab. */
  sider: "linear-gradient(180deg, #0b1120 0%, #111936 100%)",
  ink: "#0f172a",
  line: "#edf0f5",
} as const;

const FONT =
  'var(--font-sans), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

/**
 * One source of truth for design tokens.
 *
 * Antd derives its entire palette from `colorPrimary`, so overriding tokens
 * here is preferable to writing CSS against `.ant-*` class names — those are
 * hashed by cssinjs and change between minor versions.
 *
 * The direction: quiet slate neutrals, one indigo accent, soft depth instead
 * of borders. Tables and cards lose their heavy lines; the eye lands on data.
 */
export const theme: ThemeConfig = {
  token: {
    colorPrimary: BRAND.primary,
    colorInfo: BRAND.primary,
    colorSuccess: "#16a34a",
    colorWarning: "#d97706",
    colorError: "#dc2626",
    colorText: BRAND.ink,
    colorTextSecondary: "#64748b",
    colorBorder: "#e2e8f0",
    colorBorderSecondary: BRAND.line,
    colorBgLayout: "#f5f7fb",
    borderRadius: 10,
    borderRadiusLG: 14,
    borderRadiusSM: 6,
    controlHeight: 36,
    fontFamily: FONT,
    boxShadowTertiary:
      "0 1px 2px rgba(15, 23, 42, 0.04), 0 2px 8px -2px rgba(15, 23, 42, 0.05)",
  },
  components: {
    Layout: {
      headerBg: "rgba(255, 255, 255, 0.78)",
      siderBg: "#0b1120",
      triggerBg: "#0e1530",
      bodyBg: "#f5f7fb",
      headerHeight: 60,
    },
    Menu: {
      darkItemBg: "transparent",
      darkSubMenuItemBg: "transparent",
      darkItemColor: "rgba(226, 232, 240, 0.7)",
      darkItemHoverBg: "rgba(148, 163, 184, 0.12)",
      darkItemSelectedBg: "rgba(129, 140, 248, 0.2)",
      darkItemSelectedColor: "#ffffff",
      itemBorderRadius: 10,
      itemMarginInline: 10,
      itemHeight: 42,
    },
    Table: {
      headerBg: "#f8fafc",
      headerColor: "#64748b",
      headerSplitColor: "transparent",
      rowHoverBg: "#f5f7ff",
      borderColor: BRAND.line,
    },
    Card: {
      headerFontSize: 15,
    },
    Button: {
      fontWeight: 500,
      primaryShadow: "0 6px 16px -8px rgba(79, 70, 229, 0.65)",
    },
    Statistic: {
      titleFontSize: 13,
      contentFontSize: 28,
    },
    Tag: {
      defaultBg: "#f1f5f9",
    },
    Modal: {
      titleFontSize: 17,
    },
  },
};
