import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // The API client is the only thing worth testing here: everything else is
    // presentation, and the business rules live on the server by design.
    setupFiles: ["./tests/setup.ts"],
  },
});
