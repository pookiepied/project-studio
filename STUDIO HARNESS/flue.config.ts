import { defineConfig } from "@flue/runtime/config";

/**
 * Flue 2.0 configuration.
 *
 * The 2.0 validator rejects `root` and `output` outright ("Invalid key:
 * Expected never"), which is why neither is set here: `vite build` owns the
 * output directory, and the project root is the package's own. Phase 0
 * measured the rejection against the published validator; do not reintroduce
 * either field.
 */
export default defineConfig({
  target: "node"
});
