import { defineRoute, json } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { badRequest } from "@/lib/errors";
import { addTaskAttachment } from "@/lib/repositories/events";
import { MAX_UPLOAD_BYTES, isAllowedType } from "@/lib/storage";

interface UploadedFile {
  name: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export const POST = defineRoute({
  rateLimit: RATE_LIMITS.write,
  handler: async ({ userId, params, request }) => {
    const taskId = params.id;
    if (typeof taskId !== "string") throw badRequest("Invalid task id");
    let form: Awaited<ReturnType<Request["formData"]>>;
    try {
      form = await request.formData();
    } catch {
      throw badRequest("Upload must be sent as multipart form data.");
    }

    const files: UploadedFile[] = [];
    for (const value of form.getAll("files")) {
      if (typeof value === "object" && value !== null && "arrayBuffer" in value) {
        files.push(value as unknown as UploadedFile);
      }
    }
    if (files.length === 0) throw badRequest("Choose at least one file.");
    if (files.length > 10) throw badRequest("Upload up to 10 files at a time.");

    const saved = [];
    const failed: { name: string; reason: string }[] = [];
    for (const file of files) {
      if (file.size === 0) {
        failed.push({ name: file.name, reason: "That file is empty." });
        continue;
      }
      if (!isAllowedType(file.type)) {
        failed.push({ name: file.name, reason: "That file type is not allowed." });
        continue;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        failed.push({ name: file.name, reason: "That file is larger than 20 MB." });
        continue;
      }
      try {
        saved.push(
          await addTaskAttachment(userId, taskId, {
            filename: file.name,
            mimeType: file.type || "application/octet-stream",
            body: Buffer.from(await file.arrayBuffer()),
          }),
        );
      } catch (error) {
        failed.push({ name: file.name, reason: error instanceof Error ? error.message : "Upload failed." });
      }
    }
    return json({ attachments: saved, failed }, { status: failed.length && !saved.length ? 400 : 201 });
  },
});
