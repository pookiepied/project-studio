# MCP hub / Native Tools / Memory — findings (G-02)

## Current state in `Backend/Cloud`
- **No `studio-mcp` worker exists.** `mcp-library` (`studio-cloud-mcp-library`) only serves `/health` and `/mcp-servers/system` — a definition store, not an execution hub. It has no `/internal/native/execute` route.
- **No `studio-native-tools` worker.** `tool-execution/src/execution/serviceDispatch.ts` calls `env.NATIVE_TOOLS.fetch(".../services/{serviceId}/tools/{toolName}")`.
- **No `studio-memory` worker.** Same file calls `env.MEMORY.fetch(".../operations/{operation}")`. `context-engine/builders/user.ts` calls `env.MCP.fetch("http://mcp/internal/native/execute")` for memory retrieval.

## What the backup reveals
`C:\pookiepied\Backup\Project Studio Backup 04\workers\mcp\` contains three workers:

| Backup worker | `name` | Shape | Exposes |
|---|---|---|---|
| `memory/` | `studio-mcp-memory` | McpAgent DO (`StudioMemoryAgent`) + REST | `/mcp` (Streamable HTTP), `/health`, `/facts`, memory inject/process. D1 `studio-memory`, Vectorize `studio-memory-vectors`, Workers AI embeddings, KV profile cache. Binds `AI_WORKER=studio-gateway`, `TRACKER=tracker`. |
| `tools/` | `studio-mcp-tools` | McpAgent DO (`StudioToolsAgent`) | `/mcp` (Streamable HTTP), `/health`. Native work tools (web_search, web_fetch, rag, image/video gen, http_request). Binds `GATEWAY`, `TRACKER`, Vectorize `studio-rag`, R2 `studio-images`. |
| `youtube-transcript/` | (native tool) | — | additional native tool worker |

Design intent (from backup comments): a **studio-mcp hub** holds the native-service catalog and routes execution to these MCP servers via `/internal/native/execute`, performing the MCP handshake against each server's `/mcp`. "The hub holds no tool logic; it only lists these schemas and routes execution here."

## The contract mismatch to resolve
The current callers do **not** speak MCP to these servers:
- `tool-execution` expects **REST** routes (`/services/{id}/tools/{name}`, `/operations/{op}`) — the backup servers expose **MCP `/mcp`** instead.
- `context-engine` expects a hub at `env.MCP` with `/internal/native/execute` — no such worker.

So restoring the backups is necessary but not sufficient; the **hub + routing contract** must be reconciled. Two coherent options for the remediation session:

- **Option A — Hub owns routing (matches backup intent):** stand up/relocate the `studio-mcp` hub (or give mcp-library an execution surface) exposing `/internal/native/execute`; hub does the MCP handshake to `studio-mcp-tools` / `studio-mcp-memory`. Point `context-engine.MCP` and `tool-execution.NATIVE_TOOLS/MEMORY` at the hub. Register the native services into the Registry (per owner's steer: "registered into the studio register system").
- **Option B — Direct REST adapters:** add REST routes to the restored workers matching the current callers' expectations and bind them directly (no hub). Simpler wiring, diverges from the MCP-server design.

Owner's steer favors A ("studio-mcp is just the mcp-library, registered into the registry"): the mcp-library/registry pair is the catalog+hub; native servers are restored from backup and registered.

## Recommended remediation steps (deferred — implementation session)
1. Restore `studio-mcp-memory`, `studio-mcp-tools` (and `youtube-transcript`) into `Backend/Cloud/` (e.g. under `mcp/`).
2. Decide hub ownership (A vs B) — **open question Q1/Q2**.
3. Implement the `/internal/native/execute` hub route (Option A) or REST adapters (Option B).
4. Register native MCP servers into the Registry so context-engine's `buildMcpContext` (which reads `REGISTRY /mcp`) surfaces them.
5. Repoint `MCP`, `NATIVE_TOOLS`, `MEMORY` bindings to the real worker names and update `wrangler.toml` D1/Vectorize/KV ids + secrets.
6. Add tail_consumers → `studio-tracker` on the restored workers.
