import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { AzureBlobStorage } from "./azure";
import { extensionFor, type Storage } from "./types";

export * from "./types";

/**
 * File storage.
 *
 * Deliberately three methods and nothing else. Hardcoding a provider's SDK into
 * an API route would mean every call site had to change to move anywhere else,
 * and this deployment already has Azure Blob configured while a fresh checkout
 * has nothing at all — both have to work.
 *
 * So: this interface is the seam. `put`, `get`, `remove`, keyed by an opaque
 * string. A driver for S3, Supabase or Azure Blob is a file next to this one
 * plus a case in `driver()`; nothing above this layer changes, and no component
 * knows where a file lives.
 *
 * What is NOT here is equally deliberate. No signed URLs, no direct-to-bucket
 * uploads, no CDN. Those matter at a scale this does not have, and each would
 * commit the interface to a provider's semantics.
 */

/**
 * Local disk, for development.
 *
 * Two properties matter more than anything else here:
 *
 *  1. The key is generated server-side from random bytes. A user-supplied
 *     filename never touches the path, so "../../.env" cannot be a storage key.
 *  2. Every read re-resolves the path and checks it is still inside the root,
 *     so even a malformed key that reached the database cannot escape.
 */
class LocalStorage implements Storage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private pathFor(key: string): string {
    const full = resolve(join(this.root, key));
    // `resolve` collapses any "..", so comparing prefixes afterwards is what
    // makes traversal impossible rather than merely unlikely.
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new Error("Refusing to touch a path outside the storage root");
    }
    return full;
  }

  async put({ body, contentType }: { body: Buffer; contentType: string; filename: string }) {
    // Sharded two levels deep so a directory never holds a hundred thousand
    // entries, which some filesystems handle badly.
    const id = randomBytes(16).toString("hex");
    const key = `${id.slice(0, 2)}/${id.slice(2, 4)}/${id}.${extensionFor(contentType)}`;

    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);

    return { key, size: body.byteLength };
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async remove(key: string): Promise<void> {
    // `force` so removing an already-missing file is not an error — deleting an
    // attachment whose bytes are already gone should still remove the row.
    await rm(this.pathFor(key), { force: true });
  }
}

let cached: Storage | null = null;

/**
 * The configured driver.
 *
 * `STORAGE_DRIVER` selects it. A missing variable means local, so a checkout
 * with no configuration still works; `azure` uses the Blob container this
 * deployment already has. Adding S3 or Supabase is one file and one case.
 */
export function storage(): Storage {
  if (cached) return cached;

  const driver = process.env.STORAGE_DRIVER ?? "local";
  switch (driver) {
    case "local":
      cached = new LocalStorage(process.env.STORAGE_LOCAL_DIR ?? ".storage");
      return cached;
    case "azure":
      // The SDK reads no credentials at import time; the connection string is
      // only touched on the first upload, so this costs nothing when unused.
      cached = new AzureBlobStorage();
      return cached;
    default:
      throw new Error(
        `Unknown STORAGE_DRIVER "${driver}". Add a driver in src/lib/storage/index.ts.`,
      );
  }
}

/** Stable identity for a file's bytes, for deduplication if it is ever wanted. */
export function checksum(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}
