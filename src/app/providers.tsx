"use client";

import { AntdRegistry } from "@ant-design/nextjs-registry";
import { App as AntdApp, ConfigProvider } from "antd";
import type { ReactNode } from "react";

import { theme } from "@/lib/theme";

/**
 * AntdRegistry collects cssinjs style rules during SSR and inlines them into
 * the streamed HTML. Without it antd renders unstyled on first paint and then
 * snaps into place when the client bundle hydrates.
 *
 * AntdApp supplies the context that `App.useApp()` reads, which is how message
 * and modal calls pick up the theme above. The bare `message.success()` import
 * bypasses ConfigProvider entirely and renders with default tokens.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <AntdRegistry>
      <ConfigProvider theme={theme}>
        <AntdApp>{children}</AntdApp>
      </ConfigProvider>
    </AntdRegistry>
  );
}
