import { createUploadthing, type FileRouter } from "uploadthing/next";
import { UploadThingError } from "uploadthing/server";

import { requireActor } from "@/lib/actor";
import { teamIdFor } from "@/lib/scope";

const f = createUploadthing();

/**
 * `middleware` runs inside the user's request, so it still has their cookies
 * and can authorize. `onUploadComplete` does not — it is a server-to-server
 * callback from UploadThing with no session attached.
 *
 * Both routes below hand the file's key and URL back to the browser, which then
 * writes the row. That is deliberate: an application resume can be attached to
 * a row that hasn't been inserted yet, and a profile attachment belongs to a
 * profile the caller already holds through RLS. The cost is that abandoning the
 * page between upload and save leaves a file nothing references — a small,
 * bounded leak, and the alternative (writing rows from a session-less callback)
 * would need the service-role key on the upload path.
 */
const authorize = async () => {
  const actor = await requireActor();
  const teamId = teamIdFor(actor);

  // Throwing here rejects the upload before a byte is sent.
  if (!teamId) {
    throw new UploadThingError(
      "Your account isn't attached to a team, so there's nowhere to file this.",
    );
  }
  return { teamId, userId: actor.id };
};

const DOCUMENT_TYPES = {
  pdf: { maxFileSize: "8MB", maxFileCount: 1 },
  "application/msword": { maxFileSize: "8MB", maxFileCount: 1 },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    maxFileSize: "8MB",
    maxFileCount: 1,
  },
} as const;

export const uploadRouter = {
  /** The resume sent with one application, uploaded from its grid cell. */
  applicationResume: f(DOCUMENT_TYPES)
    .middleware(authorize)
    .onUploadComplete(({ file }) => ({
      key: file.key,
      url: file.ufsUrl,
      name: file.name,
      size: file.size,
      type: file.type,
    })),

  /** Photos and supporting documents on a candidate profile. */
  profileAttachment: f({
    ...DOCUMENT_TYPES,
    image: { maxFileSize: "8MB", maxFileCount: 5 },
    "application/vnd.ms-excel": { maxFileSize: "8MB", maxFileCount: 5 },
    text: { maxFileSize: "2MB", maxFileCount: 5 },
  })
    .middleware(authorize)
    .onUploadComplete(({ file }) => ({
      key: file.key,
      url: file.ufsUrl,
      name: file.name,
      size: file.size,
      type: file.type,
    })),
} satisfies FileRouter;

export type UploadRouter = typeof uploadRouter;
