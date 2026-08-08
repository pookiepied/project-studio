# Cloud Service Topology & Binding Resolution Map

Status: **verified by static analysis** (wrangler.toml + `env.*` usage in source). No workers were executed.
Scope: every worker under `Backend/Cloud/`.

## 1. Deployed worker identities

The `name =` field in each `wrangler.toml` is the Cloudflare service name other workers must bind to.

> **Update (remediation):** worker names normalized to `studio-*`. `Backend/Cloud/api` **deleted** — the real API lives outside the cloud folder at `C:\pookiepied\Project Studio\api`; nothing bound to `studio-api`, so no bindings broke. `mcp-library` → `studio-mcp-library`.

| Folder | Deployed `name` |
|---|---|
| gateways/gateway | `studio-gateway` |
| context-engine | `studio-context-engine` |
| data | `studio-data` |
| runtime/execution-runtime | `studio-execution-runtime` |
| runtime/planner-runtime | `studio-planner-runtime` |
| runtime/agent-runtime | `studio-agent-runtime` |
| tool-pool | `studio-tool-pool` |
| tool-execution | `studio-tool-execution` |
| registry | `studio-registry` |
| skill-library | `studio-skill-library` |
| agent-library | `studio-agent-library` |
| mcp-library | `studio-mcp-library` |
| connectors | `studio-connectors` |
| tracker | `studio-tracker` |

## 2. Binding resolution table

Every `service =` reference across all wrangler configs, and whether a deployed worker exports that name.

| Referenced `service=` | Referenced by (binding) | Resolves? | Actual worker |
|---|---|---|---|
| `studio-data` | api, context-engine, runtimes, tool-execution | ✅ | studio-data |
| `studio-gateway` | api, runtimes | ✅ | studio-gateway |
| `studio-context-engine` | runtimes | ✅ | studio-context-engine |
| `studio-tool-pool` | context-engine, runtimes | ✅ | studio-tool-pool |
| `studio-tool-execution` | runtimes | ✅ | studio-tool-execution |
| `studio-execution-runtime` | api | ✅ | studio-execution-runtime |
| `studio-planner-runtime` | api | ✅ | studio-planner-runtime |
| `studio-agent-runtime` | api, tool-execution | ✅ | studio-agent-runtime |
| `connectors` | context-engine, tool-pool | ✅ | connectors |
| `studio-cloud-skill-library` | tool-execution (SKILL_LIBRARY) | ✅ | studio-cloud-skill-library |
| **`studio-registry`** | context-engine, exec-rt, agent-rt, tool-execution, tool-pool (REGISTRY) | ❌ | should be `studio-cloud-library-registry` |
| **`studio-connectors`** | tool-execution (CONNECTORS) | ❌ | should be `connectors` |
| **`studio-skill-library`** | tool-pool (SKILL_LIBRARY) | ❌ | should be `studio-cloud-skill-library` |
| **`studio-agent-library`** | tool-pool (AGENT_LIBRARY) | ❌ | should be `studio-cloud-agent-library` |
| **`studio-tracker`** | execution-runtime (TRACKER) | ❌ | should be `tracker` |
| **`studio-mcp`** | context-engine, exec-rt, agent-rt, planner-rt (MCP) | ❌ | **no worker exists** |
| **`studio-native-tools`** | tool-execution (NATIVE_TOOLS) | ❌ | **no worker exists** |
| **`studio-memory`** | tool-execution (MEMORY) | ❌ | **no worker exists** |

### 2a. Broken references that only need a rename (worker exists)
`studio-registry`, `studio-connectors`, `studio-skill-library`, `studio-agent-library`, `studio-tracker`.
These are pure naming drift: the target worker exists under a different name. The system as wired **cannot deploy/serve** these bindings until names are reconciled.

### 2b. References to workers that do not exist at all
- **`studio-mcp`** — a runtime "MCP hub" for cloud tool execution and native memory retrieval. `mcp-library` (`studio-cloud-mcp-library`) is only a *definition store*, not an execution hub. Used by `context-engine/src/builders/user.ts` (`env.MCP.fetch("http://mcp/internal/native/execute")`) and bound by all three runtimes.
- **`studio-native-tools`** — used for real in `tool-execution/src/execution/serviceDispatch.ts` (`env.NATIVE_TOOLS.fetch(".../services/{serviceId}/tools/{toolName}")`). No worker folder implements it.
- **`studio-memory`** — used for real in `tool-execution/src/execution/serviceDispatch.ts` (`env.MEMORY.fetch(".../operations/{operation}")`). No worker folder implements it.

## 3. Binding usage — declared vs. actually called

`env.*` bindings that are exercised in code (not just declared):

| Binding | Used in | Notes |
|---|---|---|
| `env.REGISTRY` | context-engine builders (mcp/agents/skills/project), tool-pool inventory, tool-execution routes, agent-runtime invoke | broken name `studio-registry` |
| `env.MCP` | context-engine `builders/user.ts` → memory retrieval | target worker absent |
| `env.NATIVE_TOOLS` | tool-execution `serviceDispatch.ts` | target worker absent |
| `env.MEMORY` | tool-execution `serviceDispatch.ts` | target worker absent |
| `env.CONNECTORS` | context-engine, tool-pool, tool-execution | tool-execution uses broken name `studio-connectors` |
| `env.TRACKER` | tracker lib (self) + intended consumers | execution-runtime binds broken `studio-tracker` |
| `env.SKILL_LIBRARY` | tool-execution, tool-pool | tool-pool uses broken name `studio-skill-library` |
| `env.AGENT_RUNTIME` | tool-execution | ✅ |

## 4. Route-path contracts (spot-checked, OK)

- Registry exposes **both** `/mcp` and `/mcp-servers` (aliased to same handler) → context-engine `/mcp` and tool-pool `/mcp-servers` both resolve. ✅
- Data exposes `/conversations`, `/transcripts`, `/artifacts`, `/plans`, `/uploads`, `/objects`; runtime calls `/conversations`, `/conversations/:id/messages`, `/transcripts`, `/transcripts/events`, `/artifacts`. (message/event sub-routes still to confirm.)
- Gateway exposes `/v1/chat/completions`, `/v1/models`, `/v1/embeddings`, `/v1/audio`, `/v1/images`, `/v1/videos`, `/v1/credits`, `/management/registry`. Runtime calls `/v1/chat/completions`. ✅

## 5. Legacy
- `Backend/legacy (Will be removed)/chat/` still references `studio-mcp`, `studio-native-tools`, `studio-memory`. Legacy; slated for removal.
