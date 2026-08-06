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

/**
 * `awaitServerData: false` is what makes these usable.
 *
 * By default the client waits for onUploadComplete's return value before
 * resolving, which means waiting on a server-to-server callback from
 * UploadThing back into this app. Against a dev server on localhost that
 * callback cannot arrive at all, so the upload control span forever even though
 * the file had already landed.
 *
 * With it off, the upload resolves as soon as the bytes are stored, and the
 * client reads `key` and `ufsUrl` off the upload result directly — which is all
 * either caller needs. The trade is that `serverData` is null, so nothing may
 * be computed server-side and handed back; neither route wants that.
 */
const ROUTE_OPTIONS = { awaitServerData: false } as const;

export const uploadRouter = {
  /** The resume sent with one application, uploaded from its grid cell. */
  applicationResume: f(DOCUMENT_TYPES, ROUTE_OPTIONS)
    .middleware(authorize)
    .onUploadComplete(() => {
      // Nothing to do server-side: the browser records the file against the
      // row it belongs to, which may not exist yet when the upload starts.
    }),

  /** Photos and supporting documents on a candidate profile. */
  profileAttachment: f(
    {
      ...DOCUMENT_TYPES,
      image: { maxFileSize: "8MB", maxFileCount: 5 },
      "application/vnd.ms-excel": { maxFileSize: "8MB", maxFileCount: 5 },
      text: { maxFileSize: "2MB", maxFileCount: 5 },
    },
    ROUTE_OPTIONS,
  )
    .middleware(authorize)
    .onUploadComplete(() => {
      // As above — the browser writes the profile_attachment row from the
      // upload result, so there is nothing to hand back.
    }),
} satisfies FileRouter;

export type UploadRouter = typeof uploadRouter;
