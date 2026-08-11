import { config } from "dotenv";
import { beforeAll } from "vitest";

/**
 * Test bootstrap.
 *
 * Points every module at the TEST database before any application code is
 * imported. src/lib/db.ts reads DATABASE_URL at module load, so this assignment
 * must happen here, in a setup file, rather than inside a test.
 *
 * The guard below is deliberate: a misconfigured DATABASE_URL_TEST would
 * otherwise silently run destructive truncation against the development
 * database.
 */

config({ path: ".env", quiet: true });

const testUrl = process.env.DATABASE_URL_TEST;

if (!testUrl) {
  throw new Error("DATABASE_URL_TEST is not set — refusing to run tests against the dev database.");
}
if (!/_test(\?|$)/.test(testUrl)) {
  throw new Error(
    `DATABASE_URL_TEST must point at a database whose name ends in "_test" (got: ${testUrl.replace(/\/\/[^@]*@/, "//***@")})`,
  );
}

process.env.DATABASE_URL = testUrl;
process.env.AUTH_SECRET ??= "test-secret-not-used-for-real-sessions";

beforeAll(() => {
  // Surfaces immediately if the schema was never pushed to the test database.
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run tests with NODE_ENV=production");
  }
});
