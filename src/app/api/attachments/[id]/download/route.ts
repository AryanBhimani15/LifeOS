import { defineRoute } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { badRequest } from "@/lib/errors";
import { getAttachment } from "@/lib/repositories/events";
import { storage } from "@/lib/storage";

/**
 * Serves an attachment's bytes.
 *
 * Streamed through the app rather than from a public URL, because that is what
 * makes the file private: `getAttachment` is scoped to the signed-in user, so
 * knowing an id is not enough to read someone else's syllabus.
 *
 * Two headers matter for safety. `Content-Disposition: attachment` stops the
 * browser rendering an uploaded file as a document on our own origin, and
 * `X-Content-Type-Options: nosniff` stops it second-guessing the type we
 * declare. Together they mean a stored file cannot execute as script here —
 * `inline` is the tempting default and is exactly the wrong one.
 */
export const GET = defineRoute({
  rateLimit: RATE_LIMITS.read,
  handler: async ({ userId, params }) => {
    const id = params.id;
    if (typeof id !== "string") throw badRequest("Invalid attachment id");

    const doc = await getAttachment(userId, id);
    const body = await storage().get(doc.storageKey);

    // Quotes and backslashes would break out of the header's quoted string;
    // the RFC 5987 form carries anything non-ASCII in the filename.
    const safe = doc.name.replace(/["\\]/g, "_");

    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": doc.mimeType,
        "Content-Length": String(doc.sizeBytes),
        "Content-Disposition": `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  },
});
