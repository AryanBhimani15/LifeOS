"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, FileText, Loader2, Paperclip, RotateCcw, Trash2 } from "lucide-react";

/**
 * Files attached to an event.
 *
 * Uploads are per-file, not per-batch. Dropping five files and having all five
 * rejected because the third was a .exe is the behaviour this avoids: the
 * server stores what it can and reports what it could not, and a failed row
 * sits in the list with a Retry beside it while the successful ones are already
 * saved. Nothing about the event itself is touched by a failed upload.
 */

export interface AttachmentData {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

/** A row that is still uploading, or failed. Never persisted. */
interface PendingRow {
  key: string;
  name: string;
  size: number;
  state: "uploading" | "failed";
  reason?: string;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** The short label shown under a filename — "PDF", "PNG", "DOCX". */
function typeLabel(mimeType: string, name: string): string {
  const fromName = name.includes(".") ? name.split(".").pop()!.toUpperCase() : "";
  if (fromName && fromName.length <= 4) return fromName;
  return mimeType.split("/").pop()?.toUpperCase().slice(0, 4) ?? "FILE";
}

export function Attachments({
  uploadUrl,
  attachments,
  title = "Attachments",
}: {
  uploadUrl: string;
  attachments: AttachmentData[];
  title?: string;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingRow[]>([]);
  const [lastFiles, setLastFiles] = useState<File[] | null>(null);

  const upload = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setLastFiles(files);

      const rows: PendingRow[] = files.map((file) => ({
        key: `${file.name}-${file.size}-${Math.random()}`,
        name: file.name,
        size: file.size,
        state: "uploading",
      }));
      setPending(rows);

      const body = new FormData();
      for (const file of files) body.append("files", file);

      try {
        const response = await fetch(uploadUrl, {
          method: "POST",
          body,
        });
        const payload = await response.json();

        const failures: { name: string; reason: string }[] = payload?.failed ?? [];
        if (failures.length === 0 && response.ok) {
          setPending([]);
        } else {
          // Only the ones that actually failed stay on screen; the rest are
          // saved and arrive with the refresh below.
          setPending(
            failures.map((f) => ({
              key: f.name,
              name: f.name,
              size: 0,
              state: "failed" as const,
              reason: f.reason,
            })),
          );
        }
        router.refresh();
      } catch {
        setPending(rows.map((row) => ({ ...row, state: "failed", reason: "Upload failed." })));
      }
    },
    [uploadUrl, router],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await fetch(`/api/attachments/${encodeURIComponent(id)}`, { method: "DELETE" });
        router.refresh();
      } catch {
        // Left in place; a failed delete should not make a file appear gone.
      }
    },
    [router],
  );

  const empty = attachments.length === 0 && pending.length === 0;

  return (
    <div className="attachments">
      <div className="rail-head">
        <h3>{title}</h3>
        {attachments.length > 0 && (
          <span className="rail-count">
            {attachments.length} file{attachments.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {!empty && (
        <ul className="attach-list">
          {attachments.map((file) => (
            <li key={file.id}>
              <a
                className="attach-row"
                href={`/api/attachments/${encodeURIComponent(file.id)}/download`}
                // The server sends Content-Disposition: attachment, so this
                // downloads rather than rendering an uploaded file on our origin.
                target="_blank"
                rel="noreferrer"
              >
                <span className="attach-icon">
                  <FileText size={15} />
                </span>
                <span className="attach-copy">
                  <b>{file.name}</b>
                  <small>
                    {typeLabel(file.mimeType, file.name)} · {formatBytes(file.sizeBytes)}
                  </small>
                </span>
                <Download className="attach-open" size={14} />
              </a>
              <button
                type="button"
                className="attach-remove"
                onClick={() => remove(file.id)}
                aria-label={`Remove ${file.name}`}
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}

          {pending.map((row) => (
            <li key={row.key}>
              <div className={`attach-row is-${row.state}`}>
                <span className="attach-icon">
                  {row.state === "uploading" ? (
                    <Loader2 size={15} className="spin" />
                  ) : (
                    <FileText size={15} />
                  )}
                </span>
                <span className="attach-copy">
                  <b>{row.name}</b>
                  <small>{row.state === "uploading" ? "Uploading…" : row.reason}</small>
                </span>
                {row.state === "failed" && lastFiles && (
                  <button
                    type="button"
                    className="attach-retry"
                    onClick={() => upload(lastFiles.filter((f) => f.name === row.name))}
                  >
                    <RotateCcw size={12} /> Retry
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Compact when there is nothing yet, rather than a large empty dropzone. */}
      <button type="button" className="attach-add" onClick={() => input.current?.click()}>
        <Paperclip size={13} /> Add attachment
      </button>

      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          upload(Array.from(e.target.files ?? []));
          // Cleared so choosing the same file twice still fires a change.
          e.target.value = "";
        }}
      />
    </div>
  );
}
