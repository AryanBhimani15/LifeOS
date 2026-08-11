import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Prisma 7 no longer reads the connection URL from schema.prisma; the runtime
 * client takes a driver adapter instead.
 *
 * The client is cached on globalThis because Next.js dev-mode hot reload
 * re-evaluates modules on every edit, and a fresh PrismaClient per reload
 * exhausts the Postgres connection limit within a few minutes of editing.
 */

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and fill it in — see docs/development.md.",
  );
}

function createClient() {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createClient> | undefined;
};

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
