/**
 * Local MCP server catalogue + permission primitives.
 *
 * Pure data + localStorage — no Tauri, no network. The catalogue is consumed by
 * the lifecycle (manifest.ts / useRuntimeInit), the Settings UI, and the chat
 * provider so they all speak the same server list and do not drift apart.
 *
 * Split out of the former services/local/localMcpControl.ts.
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

/** Shared env injected into every local MCP subprocess (Studio Harness API). */
export const HARNESS_API_URL = "https://api.pookiepied.dev";
export const HARNESS_ENV = Object.freeze({
  STUDIO_API_URL: HARNESS_API_URL,
  STUDIO_API_PREFIX: "/adapters/openai/v1",
});
