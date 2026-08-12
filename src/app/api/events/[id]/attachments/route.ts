import { defineRoute, json } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { badRequest } from "@/lib/errors";
import { addAttachment } from "@/lib/repositories/events";
import { MAX_UPLOAD_BYTES, isAllowedType } from "@/lib/storage";

/**
 * Uploads one or more files against an event.
 *
 * Multipart rather than JSON+base64: base64 inflates a payload by a third and
 * would put the whole file in memory twice.
 *
 * Each file is validated *before* anything is written, and files are stored one
 * at a time so a rejected fifth file does not undo the four that worked. The
 * response reports both outcomes, which is what lets the UI mark a single row
 * as failed and offer a retry instead of failing the whole drop.
 */
/** The shape this route needs from an uploaded part. */
interface UploadedFile {
  name: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export const POST = defineRoute({
  rateLimit: RATE_LIMITS.write,
  handler: async ({ userId, request, params }) => {
    const eventId = params.id;
    if (typeof eventId !== "string") throw badRequest("Invalid event id");

    // Typed from the request rather than the DOM lib: two FormData types are in
    // scope in a Next app and they are not assignable to each other.
    let form: Awaited<ReturnType<Request["formData"]>>;
    try {
      form = await request.formData();
    } catch {
      throw badRequest("Upload must be sent as multipart form data.");
    }

    // Collected explicitly rather than with a filter predicate: the runtime's
    // FormData yields its own value union, and `.filter()` will not narrow to a
    // type that is not already a member of it. Checking for `arrayBuffer` is
    // the honest test — a string part does not have one.
    const files: UploadedFile[] = [];
    for (const value of form.getAll("files")) {
      if (typeof value === "object" && value !== null && "arrayBuffer" in value) {
        files.push(value as unknown as UploadedFile);
      }
    }
    if (files.length === 0) throw badRequest("No files were attached.");
    if (files.length > 10) throw badRequest("Upload up to 10 files at a time.");

    const saved = [];
    const failed = [];

    for (const file of files) {
      if (file.size === 0) {
        failed.push({ name: file.name, reason: "That file is empty." });
        continue;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        failed.push({
          name: file.name,
          reason: `Files must be under ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`,
        });
        continue;
      }
      if (!isAllowedType(file.type)) {
        failed.push({ name: file.name, reason: "That file type isn't supported." });
        continue;
      }

      try {
        const body = Buffer.from(await file.arrayBuffer());
        saved.push(
          await addAttachment(userId, eventId, {
            filename: file.name,
            mimeType: file.type,
            body,
          }),
        );
      } catch (error) {
        // One bad file does not sink the batch, and never touches the event.
        console.error("[attachments] upload failed", error);
        failed.push({ name: file.name, reason: "Upload failed. Try again." });
      }
    }

    return json({ attachments: saved, failed }, { status: saved.length > 0 ? 201 : 400 });
  },
});
