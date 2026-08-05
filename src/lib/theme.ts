import type { ThemeConfig } from "antd";

/**
 * One source of truth for design tokens.
 *
 * Antd derives its entire palette from `colorPrimary`, so overriding tokens
 * here is preferable to writing CSS against `.ant-*` class names — those are
 * hashed by cssinjs and change between minor versions.
 */
export const theme: ThemeConfig = {
  token: {
    colorPrimary: "#2f5bea",
    colorInfo: "#2f5bea",
    colorSuccess: "#16a34a",
    colorWarning: "#d97706",
    colorError: "#dc2626",
    borderRadius: 8,
    fontFamily:
      'var(--font-sans), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  components: {
    Layout: {
      headerBg: "#ffffff",
      siderBg: "#0f172a",
      bodyBg: "#f6f7f9",
    },
    Menu: {
      darkItemBg: "#0f172a",
      darkSubMenuItemBg: "#0f172a",
      darkItemSelectedBg: "#1e3a8a",
    },
    Table: {
      headerBg: "#f1f5f9",
    },
  },
};
