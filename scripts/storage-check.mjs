#!/usr/bin/env node
/**
 * Storage doctor.
 *
 *   node scripts/storage-check.mjs           # configuration and blob listing
 *   node scripts/storage-check.mjs --peek    # also print the head of recent blobs
 *
 * Exists because "attachments aren't working" has several possible causes that
 * look identical from the browser: wrong driver, wrong container, a credential
 * without permission, or a database row pointing at a blob that is not there.
 * This answers all of them in one command, without touching the app.
 *
 * It prints no secrets — never the connection string, never an account key.
 */

import "dotenv/config";
import { BlobServiceClient } from "@azure/storage-blob";
import { Client } from "pg";

const driver = process.env.STORAGE_DRIVER ?? "local";
console.log(`STORAGE_DRIVER = ${driver}`);

if (driver === "vercel-blob") {
  // Reported rather than skipped: printing "Local storage directory" for a
  // Vercel deployment is exactly the misleading answer this script exists to
  // avoid. The SDK reads BLOB_READ_WRITE_TOKEN itself; we only say whether it
  // is there, never what it is.
  const { list } = await import("@vercel/blob");
  console.log(`BLOB_READ_WRITE_TOKEN = ${process.env.BLOB_READ_WRITE_TOKEN ? "set" : "MISSING"}`);
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("Connect a Blob store to the Vercel project, or pull the token with `vercel env pull`.");
    process.exit(1);
  }
  const { blobs } = await list();
  console.log(`\nblobs in store: ${blobs.length}`);
  for (const blob of blobs.slice(0, 20)) {
    console.log(`  ${blob.pathname}  ${blob.size} bytes  ${blob.uploadedAt.toISOString()}`);
  }
  process.exit(0);
}

if (driver !== "azure") {
  console.log(`Local storage directory: ${process.env.STORAGE_LOCAL_DIR ?? ".storage"}`);
  process.exit(0);
}

const connection = process.env.AZURE_STORAGE_CONNECTION_STRING;
const containerName = process.env.AZURE_STORAGE_CONTAINER ?? "lifeos-attachments";

if (!connection) {
  console.error("AZURE_STORAGE_CONNECTION_STRING is not set.");
  process.exit(1);
}

const service = BlobServiceClient.fromConnectionString(connection);
const container = service.getContainerClient(containerName);

console.log(`account        = ${service.accountName}`);
console.log(`container      = ${containerName}`);
console.log(`container URL  = ${container.url}`);

const exists = await container.exists();
console.log(`container exists = ${exists}`);
if (!exists) process.exit(1);

// Public access must be off. A public container would make every uploaded file
// readable by anyone who guessed a blob name, which is the whole point of
// serving downloads through an authenticated route instead.
try {
  const policy = await container.getAccessPolicy();
  console.log(`public access  = ${policy.blobPublicAccess ?? "none (private)"}`);
} catch {
  console.log("public access  = could not read (credential lacks permission)");
}

const blobs = [];
for await (const blob of container.listBlobsFlat()) blobs.push(blob);
console.log(`\nblobs in container: ${blobs.length}`);
for (const blob of blobs) {
  console.log(`  ${blob.name}  ${blob.properties.contentLength}B  ${blob.properties.contentType}`);
}

if (process.argv.includes("--peek")) {
  for (const blob of blobs.slice(-4)) {
    const head = await container.getBlockBlobClient(blob.name).downloadToBuffer(0, 64);
    console.log(`  peek ${blob.name}: ${JSON.stringify(head.toString("latin1").slice(0, 40))}`);
  }
}

// Cross-check the database against the container. A Document row whose blob is
// missing is the one failure the UI cannot show you: the attachment lists fine
// and only fails when someone tries to download it.
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const { rows } = await db.query(
  'SELECT name, "storageKey", "sizeBytes", "eventId" FROM documents ORDER BY "createdAt"',
);
await db.end();

const present = new Set(blobs.map((b) => b.name));
console.log(`\ndocument rows: ${rows.length}`);
let orphans = 0;
for (const row of rows) {
  const ok = present.has(row.storageKey);
  if (!ok) orphans += 1;
  console.log(
    `  ${ok ? "OK  " : "MISS"} ${row.name} -> ${row.storageKey}${row.eventId ? "" : "  (no event)"}`,
  );
}

const unreferenced = blobs.filter((b) => !rows.some((r) => r.storageKey === b.name)).length;
console.log(`\nrows with a missing blob: ${orphans}`);
console.log(`blobs with no row:        ${unreferenced}`);
process.exit(orphans > 0 ? 1 : 0);
