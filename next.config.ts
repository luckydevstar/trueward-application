import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * The resume fonts, for the routes that render PDFs on the server (the
   * Chrome extension's downloads). They read public/fonts from disk, which
   * isn't part of a function unless traced in.
   */
  outputFileTracingIncludes: {
    "/api/ext/apply": ["./public/fonts/**/*"],
    "/api/resume-jobs/*/pdf": ["./public/fonts/**/*"],
    "/api/resume-jobs/\\[id\\]/pdf": ["./public/fonts/**/*"],
  },
};

export default nextConfig;
