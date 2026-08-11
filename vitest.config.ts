import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    // Integration tests share one Postgres database, so they must not run
    // concurrently — parallel truncation between files causes cross-test
    // interference that looks like flakiness.
    fileParallelism: false,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    // Vitest 4 removed environmentMatchGlobs. Everything runs in node; UI test
    // files opt into jsdom with a `// @vitest-environment jsdom` docblock.
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
