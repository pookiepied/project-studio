import { isAbsolute, normalize } from "node:path";

import { flue } from "@flue/vite";
import { defineConfig, type PluginOption } from "vite";

/**
 * Gives every file on disk exactly one module id, so a module imported two
 * ways is one module.
 *
 * On Windows a file reaches the graph under two spellings. A relative import
 * is resolved by joining the importer's directory with the specifier, and
 * the result keeps the importer's forward slashes:
 * `D:/.../src/agents/title.ts`. An absolute specifier goes through
 * Rolldown's own resolver, which answers in the platform's separators:
 * `D:\...\src\agents\title.ts`. Rolldown keys modules by that string, so the
 * same file arrives twice and is bundled twice.
 *
 * `@flue/vite` writes exactly that absolute specifier: `virtual:flue/agents`
 * imports each scanned agent file by its path run through Vite's
 * `normalizePath` (forward slashes, always). So the built bundle carried two
 * copies of `src/agents/title.ts` and two of `src/agents/studio.ts` - and
 * the copy the build REGISTERED as an agent was not the copy our own code
 * imported.
 *
 * That is fatal for `dispatch()`, which resolves its target by function
 * VALUE: the registered `Title` was the scan's copy, the `Title` the titling
 * orchestrator passed was ours, and every dispatch was refused with "target
 * agent is not registered in this built application". Automatic titling had
 * been dead in every Windows build since the migration, silently, because
 * the derived title covers for it. (The studio agent survived the same split
 * only because `createAgentRouter` falls back to the `agentName` static
 * rather than the function value.)
 *
 * The fix is to resolve normally and then spell the answer the way the
 * platform does, which is what the ordinary resolver already returns: the
 * two ids collapse into one and each file is bundled once. Virtual modules
 * (the `\0` prefix), externals and ids carrying a query are left exactly as
 * they came, and on POSIX `normalize` changes nothing at all, so no
 * non-Windows build resolves differently because of this.
 */
function nativeModuleIdentity(): PluginOption {
  return {
    name: "studio-native-module-identity",
    enforce: "pre",
    async resolveId(source, importer, options) {
      const resolved = await this.resolve(source, importer, options);
      if (resolved === null || resolved.external === true) return resolved;
      const id = resolved.id;
      if (id.includes("\0") || id.includes("?") || !isAbsolute(id)) return resolved;
      const normalized = normalize(id);
      return normalized === id ? resolved : { ...resolved, id: normalized };
    }
  };
}

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
            server: "src/server.ts",
            // The browser capability, bundled beside the harness rather than
            // as a third package. It is a separate *process* (ADR 0049 §3),
            // which is what the isolation is for, and a separate build would
            // buy nothing but a third `pnpm install` and a third staleness
            // check in `start.ps1`.
            browser: "src/browser/server.ts",
            // The computer-use capability, the second server of Studio's
            // own (ADR 0055). Its PowerShell driver travels inside this
            // bundle as a string (`?raw`) and is written out at first use.
            computer: "src/computer/server.ts",
            // The customization capability, the third of Studio's own. Its
            // tools relay to the harness's own management routes over
            // loopback, so the bundle carries no state of its own - the
            // endpoint it needs is injected by the launcher at spawn.
            customization: "src/customization/server.ts"
          },
          // Playwright resolves its own driver files by path at runtime and
          // cannot survive being bundled. It stays a real dependency, resolved
          // from the harness's node_modules by the process that needs it.
          external: ["playwright-core"]
        }
      }
    })
  };
}

export default defineConfig({
  plugins: [flue(), studioServerEntry(), nativeModuleIdentity()]
});
