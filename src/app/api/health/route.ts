import { db } from "@/lib/db";

/**
 * Liveness and readiness in one endpoint.
 *
 * It touches the database, because "the process is up" is not the question a
 * host is really asking — an app that boots without a reachable Postgres serves
 * an error on every page, and a health check that returns 200 for it will keep
 * routing traffic there forever.
 *
 * Deliberately unauthenticated and deliberately silent: it reports up or down
 * and nothing else. No version, no connection string, no error detail, since
 * this is the one route a stranger can always reach.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { status: "degraded" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
