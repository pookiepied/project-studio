/**
 * Runtime's use of the cloud MCP registry — push local tool manifests and
 * ensure servers are registered so the cloud agent can discover them.
 *
 * Split out of the former services/local/localMcpControl.ts. This is the thin
 * runtime-side wrapper over `@/core/mcpRegistry/registryClient` (the dual-use
 * REST client also consumed by the Extensions marketplace). Keeping the
 * registry calls here — rather than inlining them in manifest.ts — documents
 * the runtime → core dependency direction (D-9).
 */

import { mcpService } from "@/core/mcpRegistry/registryClient";
import { logger } from "@/core/logging/logger";
import type { LocalMcpServerDef } from "./catalog";

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

/**
 * Push the server's live tool manifest to the cloud KV so the agent can
 * discover and call these tools at request time. Retries once after 4 s —
 * auth is often not ready on the first cold-start attempt.
 *
 * NOTE (audit B5): best-effort/racy — flagged as a known limitation, not fixed
 * by this reorg.
 */
export async function pushServerManifest(
  server: LocalMcpServerDef,
  tools: { name: string; description: string; inputSchema?: unknown }[]
): Promise<boolean> {
  let synced = false;
  for (let attempt = 1; attempt <= 2 && !synced; attempt++) {
    if (attempt === 2) await new Promise<void>((r) => setTimeout(r, 4_000));
    const result = await mcpService.syncManifest(server.name, tools);
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
  return synced;
}
