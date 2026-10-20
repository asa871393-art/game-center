import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Integration tests run the real services against TEST_DATABASE_URL
 * (a migrated + seeded database that is NOT your dev database).
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws outside a React Server environment.
      "server-only": fileURLToPath(new URL("./src/test/empty-module.ts", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.integration.test.ts"],
    environment: "node",
    setupFiles: ["./src/test/integration-setup.ts"],
    // Tests share one database; run files serially.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
