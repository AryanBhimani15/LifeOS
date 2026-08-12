/**
 * The storage contract, shared by the selector and every driver.
 *
 * Split out purely to break a cycle: `index.ts` imports the Azure driver to
 * register it, and the driver needs `extensionFor` from the same place.
 */

export interface StoredFile {
  /** Opaque handle. Only this module may interpret it. */
  key: string;
  size: number;
}

export interface Storage {
  put(input: { body: Buffer; contentType: string; filename: string }): Promise<StoredFile>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

/** Bytes above which an upload is refused, before anything is written. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/**
 * The set of types accepted.
 *
 * An allow-list rather than a deny-list. The failure mode of a deny-list is
 * that anything not thought of gets through, and "anything" here includes
 * .html — which, served back from our own origin, is stored XSS.
 */
const ALLOWED = new Map<string, string>([
  ["application/pdf", "pdf"],
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["text/plain", "txt"],
  ["text/markdown", "md"],
  ["text/csv", "csv"],
  ["application/msword", "doc"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
  ["application/vnd.ms-excel", "xls"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
  ["application/vnd.ms-powerpoint", "ppt"],
  ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx"],
  ["application/zip", "zip"],
]);

export function isAllowedType(mimeType: string): boolean {
  return ALLOWED.has(mimeType);
}

export function extensionFor(mimeType: string): string {
  return ALLOWED.get(mimeType) ?? "bin";
}
