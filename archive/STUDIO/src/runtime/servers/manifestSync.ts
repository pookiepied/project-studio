/**
 * Runtime's use of the cloud MCP registry — push local tool manifests and
 * ensure servers are registered so the cloud agent can discover them.
 *
 * Split out of the former services/local/localMcpControl.ts. This is the thin
 * runtime-side wrapper over `@/core/mcpRegistry/registryClient` (the dual-use
 * REST client also consumed by the Extensions marketplace). Keeping the
 * registry calls here — rather than inlining them in manifest.ts — documents
 * the runtime → core dependency direction (D-9).
 *
 * ## Manifest sync durability (audit B5)
 *
 * The cloud agent picks which local tools to call from the manifest in KV, so a
 * dropped push is a correctness problem, not just a logged warning: the agent
 * keeps calling a tool list that no longer matches the running server. Three
 * guarantees:
 *
 *   1. **Bounded exponential backoff with jitter** rather than a single 4 s retry.
 *   2. **A deferred queue.** A server whose push exhausts its retries is kept in
 *      `deferred` and re-pushed by `resyncPendingManifests()`, which the runtime
 *      drains on every `ws:reconnected`. Previously the manifest stayed stale
 *      until the app was relaunched.
 *   3. **In-flight de-duplication + a content version stamp.** Concurrent
 *      `startLocalMcp` calls for one server used to race two pushes with no
 *      ordering guarantee; the second now awaits the first. A push whose tool
 *      list stamps identically to the last *confirmed* push is skipped.
 */

import { mcpService } from "@/core/mcpRegistry/registryClient";
import { connectionManager, CONNECTION_TIMEOUTS } from "@/core/connection";
import { logger } from "@/core/logging/logger";
import type { LocalMcpServerDef } from "./catalog";

export type ManifestTool = { name: string; description: string; inputSchema?: unknown };

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

// ---------------------------------------------------------------------------
// Sync state
// ---------------------------------------------------------------------------

/** Version stamp of the last manifest the cloud confirmed, per server. */
const syncedVersions = new Map<string, string>();

/** Servers whose push exhausted its retries, awaiting a reconnect to retry. */
const deferred = new Map<string, { server: LocalMcpServerDef; tools: ManifestTool[] }>();

/** In-flight push per server, so concurrent callers await one push, not two. */
const inFlight = new Map<string, Promise<boolean>>();

/**
 * Order-insensitive content stamp for a tool list. `mcp_get_tools` does not
 * guarantee stable tool ordering across process restarts, so sorting first
 * avoids both a pointless re-push and a spurious "changed" verdict.
 *
 * The U+0000 / U+0001 delimiters must stay written as escapes. Emitted as raw
 * bytes they make this file test as binary, and grep/ripgrep then skip its
 * contents silently — an importer here becomes invisible to a codebase search.
 */
function manifestVersion(tools: ManifestTool[]): string {
  const normalized = tools
    .map((t) => `${t.name}\u0000${t.description}\u0000${JSON.stringify(t.inputSchema ?? null)}`)
    .sort()
    .join("\u0001");
  // djb2 — change detection only, no cryptographic claim.
  let hash = 5381;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash + normalized.charCodeAt(i)) | 0;
  }
  return `${tools.length}:${(hash >>> 0).toString(36)}`;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

async function pushWithBackoff(server: LocalMcpServerDef, tools: ManifestTool[]): Promise<boolean> {
  const maxAttempts = CONNECTION_TIMEOUTS.MCP_MANIFEST_SYNC_MAX_ATTEMPTS;
  const baseDelay = CONNECTION_TIMEOUTS.MCP_MANIFEST_SYNC_BASE_DELAY_MS;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      // Auth is often not ready on a cold start. Jitter so N servers retrying
      // together do not hit the registry in lockstep.
      const delay = baseDelay * 2 ** (attempt - 2) * (0.5 + Math.random() * 0.5);
      await sleep(delay);
    }

    const result = await mcpService.syncManifest(server.name, tools);
    if (result.success) return true;

    logger.warn(
      "LocalMcp",
      `syncManifest attempt ${attempt}/${maxAttempts} failed for ${server.name}`,
      result.error
    );
  }
  return false;
}

/**
 * Push the server's live tool manifest to the cloud KV so the agent can
 * discover and call these tools at request time.
 *
 * Skips the push when the tool list is unchanged since the last confirmed sync.
 * On terminal failure the manifest is queued for `resyncPendingManifests()`
 * instead of being dropped. Concurrent calls for one server share a single push.
 */
export async function pushServerManifest(
  server: LocalMcpServerDef,
  tools: ManifestTool[]
): Promise<boolean> {
  const existing = inFlight.get(server.name);
  if (existing) return existing;

  const version = manifestVersion(tools);
  if (syncedVersions.get(server.name) === version) {
    deferred.delete(server.name);
    return true;
  }

  const run = (async () => {
    const synced = await pushWithBackoff(server, tools);
    if (synced) {
      syncedVersions.set(server.name, version);
      deferred.delete(server.name);
    } else {
      // Keep the newest tool list — that is what the cloud must eventually hold.
      deferred.set(server.name, { server, tools });
      logger.warn(
        "LocalMcp",
        `syncManifest failed for ${server.name} — deferred until the next reconnect. ` +
          `The cloud may call a stale tool list until then.`
      );
    }
    return synced;
  })();

  inFlight.set(server.name, run);
  try {
    return await run;
  } finally {
    inFlight.delete(server.name);
  }
}

/**
 * Re-push every manifest whose sync previously failed. Safe to call often: a
 * no-op when nothing is deferred, and `pushServerManifest` skips any server
 * whose version stamp already matches.
 */
async function resyncPendingManifests(): Promise<void> {
  if (deferred.size === 0) return;
  const pending = [...deferred.values()];
  logger.warn("LocalMcp", `Re-syncing ${pending.length} deferred manifest(s)`);
  await Promise.all(pending.map(({ server, tools }) => pushServerManifest(server, tools)));
}

// ---------------------------------------------------------------------------
// Reconnect hook
// ---------------------------------------------------------------------------

let unsubscribe: (() => void) | null = null;

/**
 * Drain the deferred queue whenever the agent socket comes back. A reconnect is
 * the strongest available signal that whatever broke the push — offline, expired
 * auth, a cold worker — may now be fixed.
 *
 * Idempotent: calling twice does not double-subscribe.
 */
export function startManifestResyncOnReconnect(): () => void {
  if (unsubscribe) return unsubscribe;

  const off = connectionManager.on((event) => {
    if (event.type !== "ws:reconnected") return;
    resyncPendingManifests().catch((e) =>
      logger.warn("LocalMcp", "Manifest re-sync after reconnect failed", e)
    );
  });

  unsubscribe = () => {
    off();
    unsubscribe = null;
  };
  return unsubscribe;
}
