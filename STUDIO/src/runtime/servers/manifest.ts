import { invoke } from "@tauri-apps/api/core";
import { logger } from "@/core/logging/logger";
import { HARNESS_ENV, type LocalMcpServerDef } from "./catalog";
import { ensureLocalMcpRegistered, pushServerManifest, type ManifestTool } from "./manifestSync";

/**
 * Local MCP process lifecycle (Tauri): resolve path, start / stop subprocess,
 * and push the live tool manifest to the cloud once a server is up.
 *
 * Split out of the former services/local/localMcpControl.ts:
 *   - server defs + permission read/set → ./catalog.ts
 *   - cloud registry calls               → ./manifestSync.ts
 *   - Tauri subprocess lifecycle         → this file
 *
 * `studio-harness` is always treated as the primary connectivity indicator —
 * when it is running, the cloud worker enables Studio main-chat mode
 * (localEngineConnected). Computer Use is an independent, separately-granted
 * capability.
 */

/** Resolve the absolute path to a built local-MCP dist bundle. */
export async function resolveLocalMcpPath(server: LocalMcpServerDef): Promise<string> {
  return invoke<string>(server.resolveCmd);
}

/**
 * Start a local MCP subprocess. Idempotent (the Rust side no-ops if already
 * running). Registers the server backend first (best-effort), then syncs the
 * tool manifest so the cloud agent can discover the server's tools.
 */
export async function startLocalMcp(server: LocalMcpServerDef): Promise<void> {
  await ensureLocalMcpRegistered(server);
  const serverPath = await resolveLocalMcpPath(server);
  await invoke("mcp_start_server", {
    name: server.name,
    command: "node",
    args: [serverPath],
    envVars: { ...HARNESS_ENV },
  });
  await syncLocalMcpManifest(server);
}

/** Stop a local MCP subprocess by name. */
export async function stopLocalMcp(name: string): Promise<void> {
  await invoke("mcp_stop_server", { name });
}

/**
 * Fetch the server's live tool manifest (via Tauri `mcp_get_tools`) and push it
 * to the cloud registry so the AI worker can discover and call these tools at
 * request time.
 *
 * The push itself — retries, de-duplication, and the deferred-retry queue that
 * survives a failed sync (audit B5) — lives in ./manifestSync.ts.
 */
export async function syncLocalMcpManifest(server: LocalMcpServerDef): Promise<void> {
  try {
    const manifest = await invoke<{ tools?: ManifestTool[] }>(
      "mcp_get_tools",
      { server: server.name }
    );
    if (!manifest?.tools?.length) return;
    await pushServerManifest(server, manifest.tools);
  } catch (e) {
    logger.warn("LocalMcp", `Failed to get or sync manifest for ${server.name}`, e);
  }
}
