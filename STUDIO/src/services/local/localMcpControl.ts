import { invoke } from "@tauri-apps/api/core";
import { mcpService } from "../ai/mcpService";
import { logger } from "../logging/logger";

/**
 * Local MCP control — single source of truth for the two local MCP servers
 * (Studio Harness, Computer Use) and the primitives to register / resolve /
 * start / stop them.
 *
 * Consumed by the first-run permission flow (useHarnessInit), the Settings
 * pages, and the Apps popover so they all speak the same server list and do not
 * drift apart.
 *
 * ── Migration ──────────────────────────────────────────────────────────────
 * Before the split, a single localStorage key `"studio-harness-permission"`
 * gated all four former servers (harness + desktop + system + network). After
 * the split that key is reused verbatim for Studio Harness, so returning users
 * keep their existing grant and Studio Harness auto-starts.
 *
 * Computer Use (the new home for desktop/system/network/vision tools) uses a
 * new key `"computer-use-permission"` and defaults to disabled for returning
 * users — they must explicitly enable it in Settings. This is intentional:
 * Computer Use controls desktop automation, system settings, and network
 * diagnostics, which are more sensitive than filesystem/git/shell access.
 * ── End migration ───────────────────────────────────────────────────────────
 */

const HARNESS_API_URL = "https://api.pookiepied.dev";
const HARNESS_ENV = Object.freeze({
  STUDIO_API_URL: HARNESS_API_URL,
  STUDIO_API_PREFIX: "/adapters/openai/v1",
});

export interface LocalMcpServerDef {
  /** Runtime MCP server name (= cloud tool prefix stem). */
  name: string;
  /** User-facing display name. */
  displayName: string;
  /** Tauri command that resolves the built dist bundle path. */
  resolveCmd: string;
  /** localStorage permission key. */
  permissionKey: string;
}

/** The two local MCP servers. `studio-harness` is the connectivity indicator. */
export const LOCAL_MCP_SERVERS: readonly LocalMcpServerDef[] = [
  {
    name: "studio-harness",
    displayName: "Studio Harness",
    resolveCmd: "mcp_resolve_studio_harness_server_path",
    permissionKey: "studio-harness-permission",
  },
  {
    name: "computer-use",
    displayName: "Computer Use",
    resolveCmd: "mcp_resolve_computer_use_server_path",
    permissionKey: "computer-use-permission",
  },
] as const;

export function getLocalMcpServer(name: string): LocalMcpServerDef | undefined {
  return LOCAL_MCP_SERVERS.find((s) => s.name === name);
}

export type LocalMcpPermission = boolean | null;

export function readLocalMcpPermission(server: LocalMcpServerDef): LocalMcpPermission {
  const v = localStorage.getItem(server.permissionKey);
  if (v === "granted") return true;
  if (v === "denied") return false;
  return null;
}

export function setLocalMcpPermission(server: LocalMcpServerDef, granted: boolean): void {
  localStorage.setItem(server.permissionKey, granted ? "granted" : "denied");
}

/**
 * Ensure the server is registered in the backend D1 (idempotent). A registration
 * failure is non-fatal — the local process can still run and serve tools; the
 * manifest sync happens after a successful start.
 */
export async function ensureLocalMcpRegistered(server: LocalMcpServerDef): Promise<void> {
  const known = new Set<string>();
  try {
    const result = await mcpService.listServers();
    if (result.success) {
      ((result as any).servers ?? []).forEach((s: any) => known.add(s.name));
    }
  } catch {
    /* non-fatal — proceed and try to register */
  }
  if (!known.has(server.name)) {
    const reg = await mcpService.installServer({
      name: server.name,
      displayName: server.displayName,
      type: "local",
      config: {},
    });
    if (!reg.success) {
      logger.warn("LocalMcp", `Backend registration failed for ${server.name} — will still try to start`, reg.error);
    }
  }
}

/** Resolve the absolute path to a built local-MCP dist bundle. */
export async function resolveLocalMcpPath(server: LocalMcpServerDef): Promise<string> {
  return invoke<string>(server.resolveCmd);
}

/**
 * Start a local MCP subprocess. Idempotent (the Rust side no-ops if already
 * running). Registers the server backend first (best-effort).
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
 * Push the server's tool manifest to KV so the cloud agent can discover the
 * tools. Retries once after 4 s — auth is often not ready on the first
 * cold-start attempt.
 */
export async function syncLocalMcpManifest(server: LocalMcpServerDef): Promise<void> {
  try {
    const manifest = await invoke<{ tools?: { name: string; description: string; inputSchema?: unknown }[] }>(
      "mcp_get_tools",
      { server: server.name }
    );
    if (!manifest?.tools?.length) return;
    let synced = false;
    for (let attempt = 1; attempt <= 2 && !synced; attempt++) {
      if (attempt === 2) await new Promise<void>((r) => setTimeout(r, 4_000));
      const result = await mcpService.syncManifest(server.name, manifest.tools);
      synced = result.success;
      if (!result.success) {
        logger.warn("LocalMcp", `syncManifest attempt ${attempt} failed for ${server.name}`, result.error);
      }
    }
    if (!synced) {
      logger.warn(
        "LocalMcp",
        `syncManifest failed for ${server.name} after 2 attempts — KV manifest may be stale until next launch.`
      );
    }
  } catch (e) {
    logger.warn("LocalMcp", `Failed to get or sync manifest for ${server.name}`, e);
  }
}
