# Worker Audit — Tool Pool (`studio-tool-pool`)

Verified by static analysis. Folder: `Backend/Cloud/tool-pool` (~871 LOC, 10 files).

## 1. Component overview
Unified capability index. Aggregates capabilities from Registry (skills/agents/MCP), Connectors (Composio), and a static Memory tool set, then serves projections and discovery/resolution to the Context Engine and runtimes.

## 2. Intended responsibility (arch doc §12)
Aggregate, normalize, store, search, filter, rank, resolve execution targets, expose discovery tools, track permissions/availability, route execution.

## 3. Current implementation
- `src/index.ts` — Hono app + error mapping (403 forbidden / 401 missing user / 500).
- `src/server/routes.ts` — routes: `POST /projection`, `POST /discover`, `POST /resolve`, `POST /expand` (alias of discover), `GET /defaults`, `GET /health`.
- `src/inventory/build.ts` — `buildProjection`, `discoverTools`, `resolveTools`; eligibility, conflict metadata, dedupe.
- `src/inventory/registry.ts` — fetches `/skills`, `/agents`, `/mcp-servers` from `env.REGISTRY`; emits summaries + hardcoded skill/agent tools + per-MCP-tool descriptors.
- `src/inventory/connectors.ts` — fetches `/internal/tools/composio` from `env.CONNECTORS`.
- `src/inventory/memory.ts` — **static** `memory_recall/write/update/delete` descriptors (no service call).
- `src/tools/defaultTools.ts` — the two client tools `discover_tools` + `resolve_tool` (always in `defaultTools`).
- `src/server/auth.ts` — `X-User-ID` required; `body.userId` must match header.

## 4. Entry points / public contract
| Route | Request | Response `format` |
|---|---|---|
| `POST /projection` | `ToolPoolScope` | `studio.tool-pool.projection.v1` (`defaultTools`, `summaries`, `sourceHealth`) |
| `POST /discover` / `POST /expand` | `ToolDiscoveryRequest` | `studio.tool-pool.discovery.v1` (`matches`) |
| `POST /resolve` | `ToolResolveRequest` | `studio.tool-pool.resolve.v1` (`matches[].tool`) |
| `GET /defaults` | header user | projection (consumer=execution) |

Consumers: Context Engine (`toolPool/client.ts` → `/projection`) supplies `defaultTools`; runtime client tools `discover_tools`/`resolve_tool` hit `/discover`/`/resolve` (see RuntimeSession.executeClientTool → `TOOL_POOL /discover|/resolve`).

## 5. Dependencies (bindings)
`REGISTRY` ✅ (used), `CONNECTORS` ✅ (used, now `studio-connectors`), `SKILL_LIBRARY` ⚠️ **declared, never used**, `AGENT_LIBRARY` ⚠️ **declared, never used**, `TOOL_POOL_DB` (D1) ⚠️ **declared, never used**.

## 6. External contracts
- Registry list shape `{ items: RegistryResource[] }` with `tools[]` for MCP servers. ✅ matches registry routes.
- Connector shape `{ tools: [{slug,name,description,inputParameters,connectionId,entityId,appKey,displayName}] }`.
- Emits `StudioToolDescriptor` with `route` discriminated union consumed by tool-execution + runtime.

## 7. Storage / state model
**None.** No D1/KV/DO. Every request recomputes the full projection live from sources. `TOOL_POOL_DB` is bound but there are zero D1 queries — the "store tool metadata / ranking" responsibility (arch §12) is **not implemented**.

## 8. Cloudflare-specific dependencies
D1 `studio-tool-pool` bound but unused; `database_id` is placeholder `00000000-...`.

## 9. Implemented functionality
Aggregation, normalization to a common descriptor, text search (`discover`), tier labelling, per-consumer eligibility gating (planner read-only, user-scope, native-local cloud gating), conflict detection, dedupe, source-health reporting, graceful per-source failure (`safeInventory`).

## 10. Missing functionality
- **No persistence / ranking / caching** (arch §12) — no store, no relevance ranking beyond substring match, no metadata tracking.
- **Conflict resolution is advisory only** (see B-2).
- Memory/native tools are advertised but their execution targets don't exist yet (G-02).

## 11. Bugs / defects
- **B-1 (Medium, efficiency):** `resolveTools` calls `buildProjection` (which loads registry + connectors) **and then loads registry + connectors again** — inventories fetched twice per `/resolve`.
- **B-2 (Medium, correctness):** conflict `strategy: "namespaced"` is a **label only** — tool names are never actually namespaced except MCP tools (`namespacedToolName`). Connector/memory/skill/agent tool names are raw. Two sources exposing the same tool name collide in the runtime's `registerTools` map (keyed by `descriptor.name`, last-wins), silently dropping one.
- **B-3 (Low):** hardcoded fallback endpoint `"service-binding://studio-mcp"` (registry.ts:92) points at the missing hub (G-02).

## 12. Architectural inconsistencies
- Skill/agent **tools** are hardcoded in `registry.ts` (`skillTools()`, `agentTools()`) rather than sourced from the skill/agent libraries → the `SKILL_LIBRARY`/`AGENT_LIBRARY` bindings are dead, and the tool set can drift from what those libraries actually offer.
- Two parallel caches of the same data: Context Engine caches a capability snapshot AND calls tool-pool which recomputes live. Ownership of "the tool catalog" is split.

## 13. Integration risks
- Depends on Registry route shapes; if registry `/mcp-servers` item schema changes, silently yields empty (fetch returns `[]` on non-OK).
- Advertises memory/native tools whose executors are absent → runtime will surface execution failures until G-02 is resolved.

## 14. Unused / duplicate code
`SKILL_LIBRARY`, `AGENT_LIBRARY`, `TOOL_POOL_DB` bindings (dead). `/expand` duplicates `/discover`.

## 15. Testing status
No tests in the worker.

## 16. Recommended changes
1. Fix B-1 (reuse the projection's inventories in `resolveTools`).
2. Decide conflict policy: actually namespace on collision, or document last-wins (B-2).
3. Remove or wire the dead `SKILL_LIBRARY`/`AGENT_LIBRARY`/`TOOL_POOL_DB` bindings — either source skill/agent tools from those services or drop the bindings.
4. Define whether persistence/ranking belongs here or in Context Engine (arch decision — avoid the double-catalog).
5. Set real D1 id if persistence is adopted; otherwise remove the D1 binding.

## 17. Open questions
- Q-TP1: Is Tool Pool meant to **persist** the catalog (D1) and **rank**, or stay a pure live aggregator? (Determines whether the double-catalog with Context Engine is intended.)
- Q-TP2: Should skill/agent tool schemas come from the Skill/Agent libraries (via bindings) rather than being hardcoded?
- Q-TP3: Namespacing policy for cross-source tool-name collisions?

## 18. Severity & priority
- Deploy-blocking: none intrinsic (binding names fixed under G-01; D1 id placeholder only matters if persistence is used).
- Correctness: **B-2** (silent tool shadowing) — Medium/High once multiple sources are live.
- Efficiency: **B-1** — Medium.
- Cleanliness: dead bindings — Low.
