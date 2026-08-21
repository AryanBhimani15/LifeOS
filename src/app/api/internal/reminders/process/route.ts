import { timingSafeEqual } from "node:crypto";
import { processDueReminders } from "@/lib/repositories/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function secureEqual(actual: string | null, expected: string) {
  if (!actual) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function run(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[reminders] CRON_SECRET is not configured");
    return Response.json({ error: "Reminder scheduler is not configured." }, { status: 503 });
  }

  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : request.headers.get("x-cron-secret");
  if (!secureEqual(token, secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await processDueReminders();
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}

export const GET = run;
export const POST = run;
