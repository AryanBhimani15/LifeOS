import { spawnSync } from "node:child_process";

// `dotenv` is a library, not the unrelated `dotenv-cli` executable. Loading
// it in Node keeps this script portable after a clean `npm install` and makes
// the test database an explicit substitution rather than a shell-expansion
// accident.
const databaseUrl = process.env.DATABASE_URL_TEST;
if (!databaseUrl) {
  throw new Error("DATABASE_URL_TEST is required to migrate the test database.");
}

const result = spawnSync(
  process.execPath,
  ["node_modules/prisma/build/index.js", "migrate", "deploy"],
  {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: databaseUrl },
  },
);

process.exit(result.status ?? 1);
