import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@test": fileURLToPath(new URL("./tests", import.meta.url))
    }
  },
  test: {
    include: ["tests/**/*.test.ts"],
    // Windows containment registers an AppContainer profile per workspace, and
    // a test suite mints a new workspace every run. See the file for why this
    // removes a difference rather than a pattern.
    globalSetup: ["tests/helpers/sandbox-profiles.ts"],
    restoreMocks: true,
    testTimeout: 30_000,
    fileParallelism: false
  }
});
