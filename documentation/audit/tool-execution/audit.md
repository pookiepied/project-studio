# Worker Audit — Tool Execution (`studio-tool-execution`)

Verified by static analysis. Folder: `Backend/Cloud/tool-execution` (~1491 LOC, 17 files). D1-backed.

## 1–2. Responsibility
Execute a resolved tool call from a runtime: pick a dispatcher by `route.kind`, run it, persist a durable job + transcript events, normalize the result/error, surface artifact updates. Idempotent.

## 3. Entry points
`server/routes/execute.ts`: `POST /execute` (single) and `POST /execute/batch` (parallel, `Promise.all`). Requires `x-user-id` == `request.userId`. Request shape `studio.tool-execution.request.v1` (from RuntimeSession.executeToolCall): `{userId, sessionId, conversationId, agentId, toolCallId, toolName, arguments, tool, route, sourceRuntime, idempotencyKey}`. Response `studio.tool-execution.result.v1`.

## 4. Dispatch map (`executor.ts` → `dispatch`)
| `route.kind` | Dispatcher | Target | Status |
|---|---|---|---|
| `agent-runtime` | `dispatchAgentRuntime` | `AGENT_RUNTIME` | ✅ exists |
| `skill-library` | `dispatchSkillLibrary` | `SKILL_LIBRARY` (`studio-skill-library`) | ✅ |
| `connector` | `dispatchConnector` | `CONNECTORS` (`studio-connectors`) `/internal/composio/execute` | ✅ |
| `remote-mcp`/`mcp-server` (http) | `dispatchMcpTool` | direct HTTP MCP handshake | ✅ |
| `remote-mcp`/`mcp-server` (`service-binding://`) | `dispatchServiceBoundMcp` | maps `studio-agent-execution-mcp`→AGENT_RUNTIME, `studio-skill-library-mcp`→SKILL_LIBRARY | ✅ (only these two serverIds; others → `not_implemented`) |
| `native-cloud` | `dispatchNativeCloud` | **`NATIVE_TOOLS`** `/services/{serviceId}/tools/{toolName}` | ❌ **missing worker** (G-02) |
| `memory` | `dispatchMemory` | **`MEMORY`** `/operations/{operation}` | ❌ **missing worker** (G-02) |
| `local-relay` | — | desktop relay | ⛔ `not_implemented` (expected; local phase) |

## 5. Storage / state model
D1 `TOOL_EXECUTION_DB` table `tool_execution_jobs`: durable job per call with `request_json`/`result_json`/`error_json`, status lifecycle (running→completed/failed), **`UNIQUE(user_id, idempotency_key)`** enforcing dedup. `database_id` is placeholder `replace-with-tool-execution-d1-id`.

## 6. Idempotency (good, one rough edge)
- Completed job → returns cached result; failed job → returns cached failure; running job (replayed) → `duplicate_in_progress` (retryable). Solid.
- **TE-1 (Low):** `createJob` does a non-atomic `findByIdempotencyKey` then INSERT and **does not catch the `UNIQUE` violation** (unlike `saveMcpServer` in registry). On a true concurrent first-call race, the losing INSERT throws out of `executeToolCall` **before** the try block → `500` instead of a graceful `duplicate_in_progress`. Dedup integrity is preserved by the constraint; only the error surface is wrong.

## 7. Quality highlights
- Transcript persistence (`persistToolCallEvent`/`persistToolResultEvent`) is **soft-wrapped** (`safePersist`) — persistence failure never fails execution. (Contrast CE-1, which is not soft-wrapped.)
- Connector results are **redacted** (`redactConnectorResult`) and produce `artifactProposal`s.
- Error normalization with `retryable` + HTTP status mapping (`upstream_error`→502, `not_implemented`→501, etc.).
- `resolveRoute`: prefers request-supplied `route`; else infers agent/skill by tool name; else looks up MCP route from `REGISTRY /mcp?status=active`.

## 8. Bugs / defects
- TE-1 (above).
- **TE-2 (Medium, G-02 edge):** `native-cloud` and `memory` dispatch hit missing workers — the entire native-tools and memory execution surface is dead until restored. Every `web_search`/`memory_*`/image-gen tool call fails with `upstream_error`.
- **TE-3 (Low, consistency):** memory is reached here via a **REST** worker (`MEMORY /operations/{op}`), but context-engine reaches memory via the **MCP hub** (`MCP /internal/native/execute serviceId=memory`). Two contracts for one store (= CE-3). Note the backup `studio-mcp-memory` exposes `/mcp` + `/facts`, matching **neither** — so the restore must add a `/operations/{op}` adapter (or the callers must change).

## 9. Architectural notes
- Agent-execution + skill-library system MCP servers are dispatched via **direct service bindings**, not a hub — so a "studio-mcp hub" is only implied by context-engine's memory path, not by tool-execution. This argues **against** needing a general hub: native/memory could be direct REST workers (Option B in mcp-native-memory.md) to match `dispatchNativeCloud`/`dispatchMemory` as written.
- `dispatchServiceBoundMcp` hardcodes the two known serverIds; adding native/memory as service-binding MCP servers would require extending it.

## 10. Unused / duplicate
None significant. `contracts.ts` route union mirrors tool-pool's `StudioToolDescriptor.route` — keep them in sync (shared-contract candidate).

## 11. Testing status
No tests found; `scripts/` present.

## 12. Recommended changes
1. Catch the `UNIQUE` violation in `createJob` → return `duplicate_in_progress` (TE-1).
2. G-02: restore native-tools + memory with routes matching `dispatchNativeCloud`/`dispatchMemory` **or** adjust these dispatchers to the restored workers' actual routes (`/mcp`). Decide REST-direct (Option B) vs hub (Option A) — tool-execution's code favors **direct REST**.
3. Set real `TOOL_EXECUTION_DB` id + apply `schema.sql`.
4. Promote the `route` union to a shared contract with tool-pool.

## 13. Open questions
- Q-TE1: Native/memory execution — direct REST workers (matches current dispatchers) or via a hub? (ties G-02, CE-3)
- Q-TE2: Should the `route` discriminated union be a single shared package across tool-pool/tool-execution/runtime?

## 14. Severity & priority
- **TE-2 High-ish** (blocks all native/memory tools) — but it's the G-02 dependency, not a defect in this worker.
- TE-1 / TE-3 Low–Medium.
- Core execution/idempotency/persistence: **well-built**, low risk.
