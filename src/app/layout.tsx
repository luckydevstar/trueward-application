import { NextSSRPlugin } from "@uploadthing/react/next-ssr-plugin";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { extractRouterConfig } from "uploadthing/server";

import { uploadRouter } from "./api/uploadthing/core";
import { Providers } from "./providers";
import "./globals.css";

const inter = Inter({ variable: "--font-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Trueward Guru", template: "%s · Trueward Guru" },
  description: "Job application tracking and tailored resume generation",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        {/*
          Seeds the upload router's config into the initial HTML. Without it the
          first render of an upload control has to fetch /api/uploadthing before
          it knows what file types it accepts, which shows up as a button that
          is briefly inert.

          extractRouterConfig sends only the size/type rules — the middleware
          and completion handler stay on the server.
        */}
        <NextSSRPlugin routerConfig={extractRouterConfig(uploadRouter)} />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
