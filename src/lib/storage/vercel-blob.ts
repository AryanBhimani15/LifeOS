import { randomBytes } from "node:crypto";
import { del, get, put } from "@vercel/blob";
import { extensionFor, type Storage, type StoredFile } from "./types";

/**
 * Vercel Blob.
 *
 * Selected with `STORAGE_DRIVER=vercel-blob`, which is what a Vercel deployment
 * wants: that platform throws its filesystem away on every deploy, so the local
 * driver would lose attachments while their rows survived — which is why
 * `storage()` refuses `local` in production at all.
 *
 * Credentials come from `BLOB_READ_WRITE_TOKEN`, which Vercel injects into the
 * project when a Blob store is connected. Nothing here reads it directly; the
 * SDK picks it up, so a missing token surfaces on the first upload with the
 * SDK's own message rather than a second, worse one from us.
 *
 * Blobs are written **private**, for the same reason the Azure container is
 * created private: a public blob is readable by anyone holding the URL, with no
 * session and no ownership check, which is precisely what the per-user download
 * route exists to prevent. Bytes are streamed back through that route, so the
 * blob URL is never handed to a browser.
 */

/** Generous enough for a 20 MB file on a poor connection, finite regardless. */
const TIMEOUT_MS = 60_000;

export class VercelBlobStorage implements Storage {
  async put({
    body,
    contentType,
  }: {
    body: Buffer;
    contentType: string;
    filename: string;
  }): Promise<StoredFile> {
    // Server-generated and sharded, exactly as the other two drivers do it. The
    // user's filename is a label in the database and never part of the key.
    const id = randomBytes(16).toString("hex");
    const key = `${id.slice(0, 2)}/${id.slice(2, 4)}/${id}.${extensionFor(contentType)}`;

    // `addRandomSuffix` would be the natural thing to reach for and is wrong
    // here: it changes the stored pathname, so the key we hand back — and write
    // to the database — would no longer be the key `get` needs. Ours is already
    // 16 random bytes, so there is nothing left for a suffix to protect against.
    await put(key, body, {
      access: "private",
      contentType,
      addRandomSuffix: false,
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    });

    return { key, size: body.byteLength };
  }

  async get(key: string): Promise<Buffer> {
    const result = await get(key, {
      access: "private",
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    });

    // `null` is a missing blob, and 304 cannot happen because no `ifNoneMatch`
    // is sent — but the return type is a union on `statusCode`, and treating an
    // absent stream as an empty file would hand the user a zero-byte download
    // instead of an error. Both become the same failure the other drivers give.
    if (!result || result.stream === null) {
      throw new Error(`No stored file for key ${key}`);
    }

    return Buffer.from(await new Response(result.stream).arrayBuffer());
  }

  async remove(key: string): Promise<void> {
    // Deleting an already-missing blob is a no-op in this SDK, which matches
    // the other drivers: removing an attachment whose bytes have gone should
    // still remove the row.
    await del(key, { abortSignal: AbortSignal.timeout(TIMEOUT_MS) });
  }
}
