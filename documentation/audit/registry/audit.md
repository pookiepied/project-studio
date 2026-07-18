# Worker Audit — Registry (`studio-registry`)

Verified by static analysis. Folder: `Backend/Cloud/registry` (~1854 LOC). D1-backed.

## 1–2. Responsibility (arch doc §5)
Unified registry of Studio-managed capability definitions: **Skills, Agents, MCP servers**. CRUD + versioning + system-bundle registration. Publishes to Tool Pool / Context Engine via `GET` list routes. (Connectors, Native Tools, Memory are explicitly *not* registered here — confirmed by schema header comment.)

## 3. Current implementation
- `src/index.ts` — routes `/skills`, `/mcp` **and** `/mcp-servers` (same handler), `/agents`, `/health`; `loggingMiddleware`.
- `domains/{skills,agents,mcpServers}/` — each has `routes.ts`, `repository.ts` (D1), `types.ts`, `validation.ts`, plus a `library/` of bundled system definitions.
- `database/resourceVersions.ts` — append-only version history per resource.
- `system/identity.ts` — `x-user-id` identity + `requireRegistryWriter` (bearer token gate on writes).
- `system/ownership.ts` — `readableOwnerKeys(userId)` → `['system','user:<id>']`.

## 4. Public contract
| Route | Method | Notes |
|---|---|---|
| `/skills`, `/agents`, `/mcp` = `/mcp-servers` | GET | `{ items: [...] }`, filtered by `owner_key IN ('system','user:<id>')` + optional `status/origin/ownerType/transport/query/tag/limit` |
| same | POST | create (writer token) |
| `/:id` | GET/PATCH/DELETE | scoped to system+user |
| `/mcp-servers/register-system` | POST | seeds bundled system MCP servers (writer token) |
| `/mcp-servers/system-definitions` | GET | lists bundled definitions |

Consumers: context-engine `builders/mcp.ts` (`GET /mcp`, filters `status==='active'`), `builders/agents.ts` (`/agents`), `builders/skills.ts` (`/skills`); tool-pool `inventory/registry.ts` (`/skills`,`/agents`,`/mcp-servers`); tool-execution `execution/routes.ts` (`/mcp?status=active`); agent-runtime invoke (`REGISTRY`). All route shapes ✅ match.

## 5. Storage / state model
D1 `studio-registry` (real id `eafac4b3-...`). Tables: `skills`, `skill_versions`, `mcp_servers`, `mcp_server_versions`, `agents`. Composite PK `(id, owner_key)`; `UNIQUE(owner_key, slug)`; CHECK enforces system↔`owner_key='system'` / user↔`owner_key='user:<id>'`. JSON columns for `tools`, `permissions`, `tags`, `metadata`. Clean, forward-compatible multi-tenant design. `tools` schemas live inline in the `mcp_servers.tools` JSON column.

## 6. Auth model
- Reads: `x-user-id` only (no JWT verification here — trusts the edge API to authenticate; fine for internal service binding).
- Writes: `requireRegistryWriter` — in **production**, requires `REGISTRY_WRITE_TOKEN` bearer or throws `forbidden`.

## 7. Implemented functionality
Full CRUD for all three domains, version history, owner-scoped isolation, search/filter, system-bundle seeding endpoint, conflict handling on unique violations.

## 8. Missing functionality / gaps
- **R-1 (High, provisioning blocker):** `registry/wrangler.toml` declares **no `REGISTRY_WRITE_TOKEN`** (no `[vars]`, no secret note). With `ENVIRONMENT="production"`, every write — including `/mcp-servers/register-system` — throws `forbidden`. **The registry cannot be seeded in production as configured.** Contrast: gateway documents its secrets. Fix: document + set the secret, or expose a binding-only internal seed path.
- **R-2 (Medium, seeding gap):** `library/systemServers.ts` registers only `studio-agent-execution-mcp` and `studio-skill-library-mcp`. There is **no system MCP registration for native tools or memory** (`studio-mcp-tools` / `studio-mcp-memory`). Per the owner's "native servers registered into the registry" model (G-02), these registrations are missing — so context-engine/tool-pool will never surface them even once the workers exist.
- **R-3 (Medium, duplication):** system MCP definitions exist in **two** places — `registry/.../library/systemServers.ts` (`listSystemMcpServerRegistrations`) and `mcp-library/.../systemServers.ts` (`listSystemMcpServerDefinitions`, served at `/mcp-servers/system`). Two sources of truth for "system MCP servers"; ownership unclear (see Q).

## 9. Bugs / defects
- None functional found in CRUD/versioning paths. Endpoint refs use logical `service-binding://studio-agent-execution-mcp` / `...skill-library-mcp` strings — these presuppose a hub that resolves them (G-02).

## 10. Architectural inconsistencies
- `platformManaged: false` on both system servers → context-engine routes them as `remote-mcp` (to the hub via `endpointRef`), **not** `native-cloud`. If these are meant to be Studio-native, `platformManaged` flag vs routing intent should be reconciled.
- The registry stores MCP **tool schemas** inline, while tool-pool *also* hardcodes skill/agent tool schemas — so tool schemas have multiple authorities.

## 11. Unused / duplicate code
R-3 duplication (registry vs mcp-library system lists).

## 12. Testing status
No tests in the worker.

## 13. Recommended changes
1. **R-1:** add `REGISTRY_WRITE_TOKEN` provisioning (secret + docs) or a service-binding-only internal seed route; otherwise seeding is impossible in prod.
2. **R-2:** add system MCP registrations for the native-tools + memory servers once G-02 direction is set.
3. **R-3:** pick one owner for system MCP definitions (registry vs mcp-library) and have the other consume it.
4. Reconcile `platformManaged`/routing intent for system servers.

## 14. Open questions
- Q-REG1: Who owns the canonical list of **system** MCP servers — Registry or MCP-Library? (R-3)
- Q-REG2: Should native-tools/memory be registered as system MCP servers here (owner's model), and with what `endpointRef` / `platformManaged` values?
- Q-REG3: How is `REGISTRY_WRITE_TOKEN` intended to be supplied (secret vs binding-only trust)?

## 15. Severity & priority
- **R-1 High** — blocks seeding the entire capability system in production.
- **R-2 / R-3 Medium** — needed for the capability system to actually surface native/memory tools and to remove ambiguity.
- Core CRUD/schema: solid, low risk.
