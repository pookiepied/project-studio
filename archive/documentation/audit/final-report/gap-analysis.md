# Cloud Architecture — Gap Analysis (Phase 1/2 findings)

Source of truth for remediation. Findings are verified by static analysis unless marked (assumed).
Severity: Critical / High / Medium / Low / Info.

| ID | Severity | Component | Category | Finding | Evidence |
|---|---|---|---|---|---|
| G-01 | ~~Critical~~ **RESOLVED** | all runtimes, context-engine, tool-pool, tool-execution | Integration / deploy | 5 service bindings referenced worker names that didn't exist. **Fixed:** renamed workers to `studio-registry` / `studio-skill-library` / `studio-agent-library` / `studio-connectors` / `studio-tracker` and repointed the stray `connectors`/`studio-cloud-skill-library` references. Binding graph now resolves for all workers that exist. | service-topology.md §2a; verified |
| G-02 | **Critical** | tool-execution, runtimes, context-engine, mcp-library | Missing functionality | `studio-mcp` hub + `studio-native-tools` + `studio-memory` not present in `Backend/Cloud`. **Backups found** as MCP servers `studio-mcp-tools` / `studio-mcp-memory` (+ `youtube-transcript`); restoring them requires reconciling an MCP-vs-REST routing contract + hub ownership. See mcp-native-memory.md. | service-topology.md §2b; mcp-native-memory.md |
| G-03 | **High** | gateway | Config / data | `MODEL_REGISTRY_KV` + `CREDITS_KV` ids are placeholders; provider secrets unset; no model seeded. Chat returns `MODEL_NOT_FOUND` until provisioned. Blocks any real model call. | hello-flow-trace.md §6; gateway wrangler.toml |
| G-04 | **High** | api / frontend contract | Schema | Runtime requires `modelId` + `idempotencyKey` on every run; no default model is applied anywhere. The "Hello" example cannot be satisfied by text alone. | runs.ts:26-37; RuntimeSession.start |
| G-05 | Medium | context-engine | Reliability | Capability builders (`mcp`, `skills`, `agents`, `connectors`) are not `soft()`-wrapped; a single REGISTRY/CONNECTORS failure throws the whole assembly, zeroing all tools instead of degrading per-layer. | assemble.ts:47-53 |
| G-06 | Medium | execution-runtime | Observability | Runtime silently falls back to the fallback prompt when Context returns non-2xx; no event distinguishes "context unavailable" from "empty context". | RuntimeSession.loadContext:620 |
| G-07 | Medium | data | Placeholder | `studio-tool-pool` and `studio-context-engine` D1 `database_id` are `00000000-...`; several libraries use `replace-with-*-d1-id`. Deploy will fail or bind wrong DB until real ids set. | wrangler.toml (tool-pool, context-engine, agent-library, mcp-library, skill-library, tool-execution) |
| G-08 | Medium | connectors, tracker, tool-execution, mcp/skill/agent libraries | Deploy | Multiple `database_id = "TODO_..."/"replace-with-*"` placeholders; `[build]` steps assume `npm install && npx tsc`. Not deployable as-is. | wrangler.toml files |
| G-09 | Low | mcp-library, skill-library | Consistency | `compatibility_date` and `ENVIRONMENT=development` diverge from the rest (`2026-07-01`, `production`); missing `nodejs_compat`. | wrangler.toml |
| R-01 | **High** | registry | Config / deploy | No `REGISTRY_WRITE_TOKEN` provisioned; with `ENVIRONMENT=production` **all writes throw forbidden**, so `register-system` can't seed the registry. Capability system can't be populated in prod as configured. | registry/audit.md §8 R-1 |
| R-02 | Medium | registry, mcp-library | Missing functionality | System MCP registrations exist only for `studio-agent-execution-mcp` + `studio-skill-library-mcp`; **none for native-tools/memory** — so those never surface even after G-02 workers exist. | registry/audit.md §8 R-2 |
| R-03 | Medium | registry, mcp-library | Duplicate / ambiguity | System MCP definitions live in **two** places (registry `systemServers.ts` and mcp-library `systemServers.ts`); no single owner. | registry/audit.md §8 R-3 |
| TP-01 | Medium | tool-pool | Correctness | Cross-source tool-name collisions silently drop a tool (conflict `strategy` is advisory; only MCP tools get namespaced). | tool-pool/audit.md B-2 |
| CE-01 | **High** | context-engine | Reliability | `recordContextAssembly` (D1 audit write) is awaited and not soft-wrapped; an unmigrated/placeholder `CONTEXT_DB` makes the whole context assembly 500, silently reducing every request to the bare fallback prompt. | context-engine/audit.md CE-1 |
| CE-03 | Medium | context-engine, tool-execution | Consistency | Two memory access paths (CE `MCP /internal/native/execute serviceId=memory` vs runtime `MEMORY /operations/{op}`) for the same store. | context-engine/audit.md CE-3 |
| TP-02 | Low | tool-pool | Efficiency / dead code | `/resolve` double-fetches inventories; `SKILL_LIBRARY`/`AGENT_LIBRARY`/`TOOL_POOL_DB` bindings are dead; no persistence/ranking though arch §12 expects it. | tool-pool/audit.md B-1, §12 |
| G-10 | Info | legacy chat | Dead code | `Backend/legacy (Will be removed)/chat/` still references the three missing workers; confirm removal so it doesn't confuse the topology. | grep |

## Naming-standardization decision (blocks G-01)

Two ways to reconcile G-01:
- **(A) Rename the workers to the `studio-*` names the majority of references and the architecture doc use** (`studio-registry`, `studio-skill-library`, `studio-agent-library`, `studio-connectors`, `studio-tracker`). Fixes the many references, touches few worker files. **Recommended** — matches the documented deployment layout (arch doc §G).
- **(B) Fix the references to the current worker names** (`studio-cloud-library-registry`, `connectors`, `tracker`, ...). Touches more binding sites, and leaves names inconsistent with the doc.

Recommend **(A)** plus fixing the stray minority references so every name is consistent with arch doc §G.

## Suggested remediation order (dependency-aware)
1. G-01 naming standardization (unblocks every downstream binding). *(mechanical, safe)*
2. G-07/G-08 provision real D1/KV ids + secrets (deploy prerequisites). *(needs Cloudflare account access — deferred: static-only session)*
3. G-02 stand up `studio-mcp` / `studio-native-tools` / `studio-memory` (or formally fold their responsibilities into existing workers — **open question for Q&A**).
4. G-03/G-04 seed model registry + define default-model contract.
5. G-05/G-06 resilience + observability hardening.

## Open questions (for the Q&A phase)
- Q1: Is `studio-mcp` intended as a **separate runtime execution hub**, or should the MCP-library worker gain an execution surface? (arch doc lists `studio-mcp-library` only.)
- Q2: Are `native-tools` and `memory` meant to be their own workers, or folded into tool-execution / an existing service? (arch doc lists them as logical components, "may be combined".)
- Q3: Canonical worker names — adopt arch doc §G `studio-*` names as the contract? (assumed yes in rec (A)).
- Q4: What is the default model + how does the client obtain `modelId`/`idempotencyKey`? Who owns that contract (frontend vs API)?
