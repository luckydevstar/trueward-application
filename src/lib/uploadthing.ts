import { generateReactHelpers } from "@uploadthing/react";

import type { UploadRouter } from "@/app/api/uploadthing/core";

/**
 * Typed hooks rather than UploadThing's prebuilt <UploadButton>: the prebuilt
 * component brings its own styling, which would sit next to antd's rather than
 * inside it. `useUploadThing` gives the same upload machinery with the UI left
 * to us.
 *
 * The UploadRouter import is type-only at runtime — it carries the route names
 * and their input types, not the server handler.
 */
export const { useUploadThing, uploadFiles } =
  generateReactHelpers<UploadRouter>();
