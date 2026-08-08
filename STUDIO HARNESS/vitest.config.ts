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
    restoreMocks: true,
    testTimeout: 30_000,
    fileParallelism: false
  }
});
