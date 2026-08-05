import { createRouteHandler } from "uploadthing/next";

import { uploadRouter } from "./core";

/**
 * Reads UPLOADTHING_TOKEN from the environment; no explicit config needed.
 * GET serves the router definition to the client helpers, POST handles the
 * upload handshake and the completion callback.
 */
export const { GET, POST } = createRouteHandler({ router: uploadRouter });
