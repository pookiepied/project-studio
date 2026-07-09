/**
 * Local Runtime lifecycle helpers (pure — no React).
 *
 * Split out of the former hooks/useHarnessInit.ts. These are the start/stop/
 * health/restart primitives that do not need React state; the React wrapper
 * (`./useRuntimeInit.ts`) composes them with mount-once effects + modal state.
 */

import { invoke } from "@tauri-apps/api/core";
import { logger } from "@/services/logging/logger";
import { connectionManager } from "@/services/connection";
import { LOCAL_MCP_SERVERS, HARNESS_ENV, type LocalMcpServerDef } from "./catalog";
import { startLocalMcp, resolveLocalMcpPath } from "./manifest";

// Back-compat permission keys (re-exported from the runtime barrel until all
// callers import from @/runtime).
export const HARNESS_PERMISSION_KEY = LOCAL_MCP_SERVERS[0].permissionKey;
export const COMPUTER_USE_PERMISSION_KEY = LOCAL_MCP_SERVERS[1].permissionKey;

export interface LocalPermissionGrants {
  studioHarness: boolean;
  computerUse: boolean;
}

// How often to check if all granted servers are still alive (ms).
export const HEALTH_CHECK_INTERVAL_MS = 30_000;

/** Servers that should run given the persisted grants. */
export function grantedServers(grants: LocalPermissionGrants): LocalMcpServerDef[] {
  return LOCAL_MCP_SERVERS.filter((srv) => {
    if (srv.name === "studio-harness") return grants.studioHarness;
    if (srv.name === "computer-use") return grants.computerUse;
    return false;
  });
}

/** Register + start each granted local server (registers + syncs manifests). */
export async function registerAndStartLocalServers(servers: LocalMcpServerDef[]): Promise<void> {
  for (const srv of servers) {
    try {
      await startLocalMcp(srv);
    } catch (e) {
      logger.warn("HarnessInit", `Failed to start ${srv.name}`, e);
    }
  }
}

/** Restart a crashed local server; returns true on success. */
export async function restartServer(srv: LocalMcpServerDef): Promise<boolean> {
  connectionManager.emit({ type: "mcp:restarting", timestamp: Date.now(), serverName: srv.name });
  try {
    const serverPath = await resolveLocalMcpPath(srv);
    await invoke("mcp_start_server", {
      name: srv.name,
      command: "node",
      args: [serverPath],
      envVars: { ...HARNESS_ENV },
    });
    logger.warn("HarnessInit", `Auto-restarted ${srv.name} after crash`);
    connectionManager.emit({ type: "mcp:restored", timestamp: Date.now(), serverName: srv.name });
    return true;
  } catch (e) {
    logger.warn("HarnessInit", `Auto-restart failed for ${srv.name}`, e);
    connectionManager.emit({ type: "mcp:restart_failed", timestamp: Date.now(), serverName: srv.name, error: e instanceof Error ? e.message : String(e) });
    return false;
  }
}
