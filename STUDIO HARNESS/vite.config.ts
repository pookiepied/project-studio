import { flue } from "@flue/vite";
import { defineConfig, type PluginOption } from "vite";

/**
 * Claims the dist/server.mjs artifact back from the plugin's generated
 * entry. Listed after flue() so its config hook merges over flue's forced
 * input map: the `app` entry (the loadFlueNodeApplication bootstrap) stays,
 * the `server` entry becomes ours. Setting `build.rolldownOptions.input`
 * directly in this file's own config is overridden by flue() with a warning
 * naming the path - Phase 0 measured that, so the override happens here,
 * through a plugin ordered after it.
 */
function studioServerEntry(): PluginOption {
  return {
    name: "studio-server-entry",
    config: () => ({
      build: {
        rolldownOptions: {
          input: {
            server: "src/server.ts"
          }
        }
      }
    })
  };
}

export default defineConfig({
  plugins: [flue(), studioServerEntry()]
});
