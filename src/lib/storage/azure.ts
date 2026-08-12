import { randomBytes } from "node:crypto";
import { BlobServiceClient, type ContainerClient } from "@azure/storage-blob";
import { extensionFor, type Storage, type StoredFile } from "./types";

/**
 * Azure Blob Storage.
 *
 * Selected with `STORAGE_DRIVER=azure`, which this account already sets. It
 * implements the same three methods as the local driver and nothing more, so
 * everything above the storage seam — the upload route, the repository, the UI —
 * is identical whichever one is running.
 *
 * The container is created on first use if it does not exist, and created
 * **private**. That default matters: a public container would make every
 * uploaded syllabus world-readable to anyone who guessed a blob name, which is
 * exactly what the per-user download route exists to prevent.
 */

/** Generous enough for a 20 MB file on a poor connection, finite regardless. */
const UPLOAD_TIMEOUT_MS = 60_000;

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. It is required when STORAGE_DRIVER=azure.`);
  }
  return value;
}

export class AzureBlobStorage implements Storage {
  private container: ContainerClient | null = null;
  private ensured: Promise<ContainerClient> | null = null;

  /**
   * Resolved lazily and cached, including the existence check.
   *
   * Caching the *promise* rather than the result means concurrent uploads on a
   * cold start share one round trip instead of each issuing its own create.
   *
   * The `catch` that clears `ensured` is the important part. Without it, a
   * single transient failure — a DNS blip, a network hiccup on the first
   * upload after a deploy — leaves a permanently rejected promise in the cache,
   * and every upload for the life of the process fails with that same stale
   * error. The symptom is "it worked yesterday and now nothing uploads until
   * the server is restarted", which is exactly the kind of unreliability that
   * is impossible to reproduce on demand.
   */
  private client(): Promise<ContainerClient> {
    if (this.container) return Promise.resolve(this.container);
    if (this.ensured) return this.ensured;

    this.ensured = (async () => {
      const service = BlobServiceClient.fromConnectionString(
        required("AZURE_STORAGE_CONNECTION_STRING"),
      );
      const container = service.getContainerClient(
        process.env.AZURE_STORAGE_CONTAINER ?? "lifeos-attachments",
      );

      // Creating is a convenience for a fresh environment, not a requirement.
      // A credential scoped to the container itself (a SAS, say) cannot create
      // one, and failing the whole upload because a container we are about to
      // write to successfully "could not be created" would be absurd. So the
      // attempt is best-effort, and a genuinely missing container surfaces on
      // the write instead — with the real reason.
      try {
        // No `access` option: the container stays private.
        await container.createIfNotExists();
      } catch (error) {
        console.warn(
          "[storage] could not ensure the Azure container exists; continuing",
          error instanceof Error ? error.message : error,
        );
      }

      this.container = container;
      return container;
    })().catch((error) => {
      this.ensured = null;
      throw error;
    });

    return this.ensured;
  }

  async put({
    body,
    contentType,
  }: {
    body: Buffer;
    contentType: string;
    filename: string;
  }): Promise<StoredFile> {
    const container = await this.client();

    // Server-generated, like the local driver: the user's filename is a label,
    // never part of the key.
    const id = randomBytes(16).toString("hex");
    const key = `${id.slice(0, 2)}/${id.slice(2, 4)}/${id}.${extensionFor(contentType)}`;

    await container.getBlockBlobClient(key).uploadData(body, {
      blobHTTPHeaders: {
        blobContentType: contentType,
        // Even though blobs are private and served through our own route, the
        // header travels with the object. If the container is ever exposed by
        // mistake, a stored file still cannot render as a document.
        blobContentDisposition: "attachment",
      },
      // Bounded so a hung connection surfaces as a failed upload the user can
      // retry, rather than a request that never returns.
      abortSignal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });

    return { key, size: body.byteLength };
  }

  async get(key: string): Promise<Buffer> {
    const container = await this.client();
    return container.getBlockBlobClient(key).downloadToBuffer(0, undefined, {
      abortSignal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
  }

  async remove(key: string): Promise<void> {
    const container = await this.client();
    // Deleting an already-missing blob is not an error: removing an attachment
    // whose bytes have gone should still remove the row.
    await container.getBlockBlobClient(key).deleteIfExists();
  }
}
