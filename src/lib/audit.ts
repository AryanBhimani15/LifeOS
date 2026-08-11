import { db } from "@/lib/db";
import type { AuditAction } from "@/generated/prisma/enums";

/**
 * Audit logging for security-relevant actions.
 *
 * Audit writes must never break the operation they are recording — a logging
 * failure that rolls back a successful sign-in would be worse than the missing
 * log line. Every write is therefore best-effort and swallows its own errors,
 * reporting to the server console so the failure is still visible.
 *
 * What gets logged: authentication events, deletions, exports, account
 * deletion, settings changes, and every AI plan and execution. Reads are not
 * logged — the volume would bury the signal.
 */

export interface AuditInput {
  userId: string | null;
  action: AuditAction;
  summary: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

/** Fields that must never reach the audit table, even if a caller passes them. */
const REDACT_KEYS = /password|passwordhash|token|secret|apikey|api_key|authorization/i;

function scrub(metadata: Record<string, unknown> | undefined) {
  if (!metadata) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata)) {
    out[k] = REDACT_KEYS.test(k) ? "[redacted]" : v;
  }
  return out;
}

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        userId: input.userId,
        action: input.action,
        summary: input.summary.slice(0, 500),
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: scrub(input.metadata) as never,
        ip: input.ip ?? undefined,
        userAgent: input.userAgent?.slice(0, 300) ?? undefined,
      },
    });
  } catch (error) {
    console.error("[audit] failed to record audit entry", {
      action: input.action,
      summary: input.summary,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Pulls client metadata off a request without trusting it for anything but logging. */
export function requestMeta(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  return {
    ip: forwarded?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip"),
    userAgent: request.headers.get("user-agent"),
  };
}
