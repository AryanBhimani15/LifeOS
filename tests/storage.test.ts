import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Driver selection.
 *
 * Not a test of any provider — none of these touch a network. It covers the
 * `switch` that decides where uploads go, because the failure it guards against
 * is silent: `local` on an ephemeral host accepts every upload, returns 200, and
 * loses the bytes on the next deploy while their database rows survive. Nobody
 * finds out until they open an old attachment.
 */

const ORIGINAL = { ...process.env };

/** `storage()` caches its driver, so each case needs a fresh module. */
async function selectWith(env: Record<string, string | undefined>) {
  vi.resetModules();
  process.env = { ...ORIGINAL, ...env } as NodeJS.ProcessEnv;
  const { storage } = await import("@/lib/storage");
  return storage();
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("choosing a storage driver", () => {
  it("defaults to local when nothing is configured", async () => {
    const driver = await selectWith({ STORAGE_DRIVER: undefined, NODE_ENV: "development" });
    expect(driver.constructor.name).toBe("LocalStorage");
  });

  it("refuses local in production, where the filesystem is usually thrown away", async () => {
    await expect(
      selectWith({ STORAGE_DRIVER: "local", NODE_ENV: "production", STORAGE_ALLOW_LOCAL: undefined }),
    ).rejects.toThrow(/lost on the next deploy/);
  });

  it("names every driver that would fix it, since that message is the whole fix", async () => {
    const failure = await selectWith({
      STORAGE_DRIVER: "local",
      NODE_ENV: "production",
      STORAGE_ALLOW_LOCAL: undefined,
    }).catch((error: Error) => error.message);

    expect(failure).toContain("vercel-blob");
    expect(failure).toContain("azure");
    expect(failure).toContain("STORAGE_ALLOW_LOCAL");
  });

  it("allows local in production only when a persistent volume is promised", async () => {
    const driver = await selectWith({
      STORAGE_DRIVER: "local",
      NODE_ENV: "production",
      STORAGE_ALLOW_LOCAL: "true",
    });
    expect(driver.constructor.name).toBe("LocalStorage");
  });

  it("selects Vercel Blob without needing a token to do it", async () => {
    // Selection must not read credentials: a deployment that never uploads
    // should not fail to boot over a token it will never use.
    const driver = await selectWith({
      STORAGE_DRIVER: "vercel-blob",
      NODE_ENV: "production",
      BLOB_READ_WRITE_TOKEN: undefined,
    });
    expect(driver.constructor.name).toBe("VercelBlobStorage");
  });

  it("selects Azure the same way", async () => {
    const driver = await selectWith({
      STORAGE_DRIVER: "azure",
      NODE_ENV: "production",
      AZURE_STORAGE_CONNECTION_STRING: undefined,
    });
    expect(driver.constructor.name).toBe("AzureBlobStorage");
  });

  it("refuses a driver it does not have rather than falling back to disk", async () => {
    await expect(selectWith({ STORAGE_DRIVER: "s3", NODE_ENV: "production" })).rejects.toThrow(
      /Unknown STORAGE_DRIVER "s3"/,
    );
  });
});
