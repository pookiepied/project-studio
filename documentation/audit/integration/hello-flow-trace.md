# End-to-End Trace: minimal "Hello" request

Method: static code-trace (no execution). Goal: identify what blocks the minimal flow described in the architecture doc §J.

## Intended path
Frontend → API → Execution Runtime → Context Engine → Gateway → Provider → Gateway → Runtime → Data → Frontend.

## Actual traced path

1. **Frontend → API.** `POST /cloud/runs` → `api/src/index.ts:24` proxies to `EXECUTION_RUNTIME` service, rewriting to `/runs`. Requires `x-user-id` header (`requireUserId`). ✅ contract clear.

2. **API → Execution Runtime.** `runs.ts` POST `/` validates `x-user-id`, requires body `{conversationId, request, modelId, idempotencyKey, ...}`, then forwards to the `ExecutionSession` DO `idFromName(conversationId)` at `/start` with a generated `runId`. ✅
   - ⚠️ **Contract gap:** `modelId` and `idempotencyKey` are **required** by the runtime but the architecture doc's "Hello" example implies the client only sends text. The frontend/API must supply a registered `modelId` and an `idempotencyKey`. No default model is applied anywhere.

3. **ExecutionSession.start** (`RuntimeSession.ts:440`) persists `RunState`, emits `run.started`, then:
   - `loadContext(run)` → `POST env.CONTEXT /context-engine` with `{userId, taskId, conversationId, task, consumer:"execution"}`. On non-2xx it returns `null` and the loop falls back to `fallbackSystemPrompt` + raw user message. **So context failure degrades gracefully** — good for Hello.
   - `runModelLoop(...)`.

4. **Context Engine `/context-engine`** (`context.ts` → `assembleContext`):
   - `buildCapabilitySnapshot` runs `buildMcpContext`, `buildConnectorContext`, `buildSkillContext`, `buildAgentContext` in `Promise.all` — **none are `soft()`-wrapped**, and each throws on a non-OK dependency response. `buildMcpContext`/`buildSkillContext`/`buildAgentContext` all call `env.REGISTRY` (broken binding name). `buildConnectorContext` calls `env.CONNECTORS`.
   - **Result:** with the current broken `REGISTRY` binding, `assembleContext` throws → context route 500 → runtime `loadContext` returns null → **Hello still proceeds on the fallback prompt.** Functional for Hello, but the entire capability/tool system is silently dead.

5. **Runtime → Gateway** (`modelLoop.ts:callGateway`): `POST env.GATEWAY /v1/chat/completions` with `{model, messages, tools:[], toolChoice:"none", user}`. ✅ route exists.

6. **Gateway chat route** (`chat/route.ts`): `getRegistryModelForEnv(env, body.model)` looks up the model in `MODEL_REGISTRY_KV`. If not present → `MODEL_NOT_FOUND` (thrown, 4xx). Then dispatches to `provider.chat`.
   - ⚠️ **Config blocker:** `MODEL_REGISTRY_KV` id is `replace-with-model-registry-kv-id` and must be seeded with at least one model mapping, plus provider secrets (`CF_AIG_TOKEN`, BYOK keys). Without this, Hello returns a gateway error → runtime throws → `run.failed`.

7. **Gateway → Provider → Gateway.** Provider `.chat` (e.g. anthropic) returns normalized OpenAI-style `{choices:[{message:{content}}]}`. Model loop reads `choices[0].message.content`. ✅ shape matches.

8. **Runtime finalize → Data** (`ExecutionSession.finalize`): POSTs conversation, user message, assistant message, transcript records to `env.DATA`. Wrapped in try/catch → a Data failure is reported as `run.progress`, not fatal. ✅ Hello returns output even if Data fails.

9. **Response.** `start` returns `{run: completed, output}`; events also stream over `/runs/:conversationId/ws`.

## Verdict for "Hello"

The **code path is coherent end-to-end.** Two classes of blocker prevent it from actually running as deployed:

- **B1 (deployment):** broken service-binding names (`studio-registry`, `studio-tracker`, etc.) — see service-topology.md §2a. `execution-runtime` binds `studio-tracker`, `studio-registry`, and `studio-mcp`; two of those don't resolve. Whether these hard-fail deploy or fail at first call, the runtime cannot be relied on until fixed.
- **B2 (config/data):** Gateway `MODEL_REGISTRY_KV` + provider secrets must be provisioned and seeded, and the client must send a `modelId` that is registered. No default model exists.

Neither B1 nor B2 is a logic bug — they are wiring/provisioning gaps. Once fixed, a text-only "Hello" should complete on the fallback prompt even before the capability system is repaired.

## Secondary observations
- Context assembly makes the **entire** capability system depend on `REGISTRY` being reachable and non-throwing; `buildMcpContext`/`skills`/`agents` are not `soft()`-wrapped, so one registry hiccup zeroes out all tools (not just the failed layer). Consider soft-wrapping each capability builder.
- The runtime falls back silently when context 500s. Good for resilience, bad for observability — there is no emitted event distinguishing "context unavailable" from "context intentionally empty."
