# Flue V2 — is it pain or blessing?

**Date:** 2026-08-31
**Scope:** `STUDIO HARNESS/` dependency stack (`@flue/*`, `@earendil-works/pi-ai`), its patches, and the
Tauri contract that binds the desktop app to the harness. `STUDIO/` frontend is assessed for impact only —
nothing there changes.
**Status:** Analysis only. No code, lockfile, or patch was touched.
**Method:** Every fact below was verified against real artifacts: the npm registry (version history and
dist-tags for all five packages), the published tarballs of `@flue/runtime@2.0.3`, `@flue/cli@2.0.3`,
`@flue/sdk@2.0.3`, `@flue/opentelemetry@2.0.3` and `@earendil-works/pi-ai@0.84.4` (downloaded and diffed
against the installed `@flue/runtime@1.0.0-beta.9`), Flue's own migration guide (`docs/guide/migration.md`,
shipped inside the 2.0.3 tarball and read in full), and this workspace's source. Nothing is guessed; where
something is inference it is marked as such.

---

## Part 0 — The verdict in one paragraph

Flue 2.0 is not an update to the thing we pinned; it is the *graduation* of it. The `1.0.0-beta.x` line we
are on never went stable — it was renamed `2.0.0` and shipped on 2026-07-31. Everything published since
June 30 exists only on the 2.x line, so staying on beta.9 means pinning to a permanently frozen branch.
The upgrade is a **boundary replacement, not a rebuild**: roughly **10–15% of the harness code** changes,
concentrated in five known files plus the build pipeline and the patches; the frontend, the Tauri host, the
process architecture, and Studio's entire product layer do not move. Two of our four patch hunks become
obsolete because upstream fixed what they fixed. The two genuine costs are (1) **Flue's local conversation
database is reset, with no migration path** — existing threads are lost without an export plan — and (2)
**agent functions must be synchronous**, and our initializer is async. Net: days of work, not hours, and
we come out with *less* hand-maintained code than we started with.

---

## Part 1 — The version landscape: how the old branch stopped

### 1.1 Timeline (from the npm registry's own publish timestamps)

| Event | Version | Date |
|---|---|---|
| Our pin | `@flue/runtime@1.0.0-beta.9` | 2026-06-30 |
| Last publication on any 1.x line | (none — beta.9 is the last) | — |
| Parallel 0.4.0-nightly churn (separate branch) | 0.4.0-nightly.* | 2026-07-10 → 07-21 |
| 2.0 development begins on the new line | 2.0.0-nightly.202607220848 | 2026-07-22 |
| **2.0.0 stable** | 2.0.0 | 2026-07-31 |
| 2.0.1 | 2.0.1 | 2026-08-01 |
| 2.0.2 | 2.0.2 | 2026-08-04 |
| **2.0.3 (current `latest`)** | 2.0.3 | 2026-08-05 |

Interpretation, marked as inference: the beta line *became* 2.0. There is no `1.0.0` stable on the registry
— the version line goes `0.11.1 → (1.0.0-beta.1…9) → 2.0.0`. The `next` dist-tag still points at an old
`0.8.0-beta.6`. Our pin is the direct ancestor of 2.0, published three weeks before 2.0 development went
nightly.

### 1.2 Package-by-package position

| Package | Installed | Current `latest` | Note |
|---|---|---|---|
| `@flue/runtime` | 1.0.0-beta.9 | **2.0.3** | The core. Breaking redesign. |
| `@flue/cli` | 1.0.0-beta.9 | **2.0.3** | `flue build`/`flue dev` removed; CLI shrinks to scaffold/run/docs tooling. |
| `@flue/sdk` | 1.0.0-beta.9 | **2.0.3** | Client reshaped to conversation-scoped; `createFlueClient` survives. |
| `@flue/opentelemetry` | 1.0.0-beta.3 | **2.0.3** | `createOpenTelemetryInstrumentation` survives; adds GenAI semantic-convention projections. |
| `@earendil-works/pi-ai` | 0.80.10 | **0.84.4** | runtime 2.0.3 depends on `^0.83.0`. `isRetryableAssistantError` (our patch's delegation target) verified present in 0.84.4. |
| `@earendil-works/pi-agent-core` | (transitive) | **0.84.4** | The agent loop we stream through. |

`@flue/runtime@2.0.3` engines are `node >=22.19.0` — identical to our harness's own engines pin. Its
dependency set: `pi-ai ^0.83.0`, `pi-agent-core ^0.83.0`, `@hono/node-server ^2.0.3`,
`@modelcontextprotocol/client 2.0.0` (new — MCP client is now a real dependency), `js-yaml ^5.2.1`,
`@valibot/to-json-schema ^1.3.0`, `hono ^4.8.3`, `valibot ^1.1.0`.

### 1.3 Where the documentation lives

Flue ships its migration guide **inside the package**: `docs/guide/migration.md` in the 2.0.3 tarball
(also at flueframework.com/docs/guide/migration). It is written exactly for our situation — "migrates a
Flue codebase from `1.0.0-beta.9` to Flue 2" — pairs every beta API with its replacement, and ends with an
ordered checklist. There are no GitHub Releases for the repo (`withastro/flue`), and no CHANGELOG.md at the
package root; the migration guide plus tarball diffs are the authoritative record.

---

## Part 2 — The complete change log, beta.9 → 2.0.3

Five conceptual changes drive everything (the migration guide's own framing, verified against the bundles):

1. `flue build` / `flue dev` → **Vite** with the `flue()` plugin (`@flue/vite`).
2. The auto-mounted `flue()` router and directory discovery → **explicit routing** in a required `app.ts`.
3. `defineAgent(async initializer => config)` → **the agent is the function**, composed with hooks.
4. **Workflows are removed** entirely.
5. The deployment-wide SDK client → **conversation-scoped clients**.

### 2.1 Build and CLI

- `flue build` / `flue dev` are gone. A Flue app is a Vite project: add `vite`, `@flue/vite`, `hono`;
  author `vite.config.ts` with the `flue()` plugin (before `cloudflare()` if used).
- `vite build` on the Node target **still emits `dist/server.mjs`**, started with `node dist/server.mjs`
  "as before" — the migration guide's words. This is why our Tauri supervisor contract survives (see 3.1).
- Dev server port moves 3583 → Vite's 5173 (irrelevant to us; the Tauri dev flow uses Vite on 1420 for the
  *frontend*, and the harness is spawned headless by the Rust host, never by `flue dev`).
- `flue.config.ts`: `defineConfig` moves to `@flue/runtime/config`; `root` and `output` fields are retired
  (Vite owns both); strict validation rejects them.
- `.env` loading changes: `vite dev` uses Vite's standard files; built servers **never** load `.env`.
- `flue run` no longer talks to a built server; it executes one agent module in-process. `--input` →
  `--data`; `--server/--header/--target/--root/--output/--config` are gone. New `--uid`/`--new` send
  conditions and `--json`.
- New: the `providers` config on the `flue()` plugin narrows which providers ship in the build.

### 2.2 Routing and HTTP surface

- The beta's auto-router (`import { flue } from '@flue/runtime/routing'`; we mount it at
  `transport/http/create-app.ts:99` as `options.flueApp ?? flue()`) **no longer exists**. `app.ts` is
  required and mounts every route explicitly.
- Replacement: `createAgentRouter(fn)` — a pure router factory per HTTP-exposed agent, serving
  `POST /:id`, `GET|HEAD /:id`, `POST /:id/abort`, `GET /:id/attachments/:attachmentId` relative to the
  mount. URL shapes are ours.
- **Registration is decoupled from mounting.** Agents are registered by the build-time scan for the
  `'use agent'` module directive. A **dispatch-only agent stays unmounted and still works** — this is
  exactly our titler (see 3.2).
- The agent-module `export const route` and `export const attachments` conventions are deleted. Our
  `agents/studio.ts:20` exports `route: AgentRouteHandler` — that goes away; per-agent middleware becomes
  ordinary Hono middleware registered before the mount.
- `POST /:id` body changed: `{ "message": "...", "images": [...] }` → a bare message object
  `{ "message": { "kind": "user", "body": "..." } }`, with optional top-level `initialData` and `uid`.
- The `?wait` query is gone; clients follow the returned `streamUrl` or use the SDK's `wait()`.
- Workflow routes (`POST /workflows/<name>`, `/runs/<runId>`) are gone with workflows.

### 2.3 Agent authoring model (the big one)

The beta's async initializer returning a config bag becomes a **synchronous exported capitalized function**
in a module marked `'use agent'`. Verified from the shipped docs and the 2.0.3 `index.d.mts` exports:
`defineAgent`, `defineAgentProfile`, `defineAction`, `defineWorkflow` are **absent** from the 2.0.3 export
surface. There is no compatibility alias anywhere in the bundle (grep-verified).

Field-by-field mapping of the config bag we return today at `agents/studio.ts:86-119`:

| Beta (ours today) | 2.0 replacement |
|---|---|
| `model` | `useModel(model, options?)` — **required, exactly once per render, root render only** |
| `instructions` | the agent function's **return string**; `useInstruction()` appends more |
| `tools` (our `tools: (_env, _options) => [...]` factory) | `useTool()` per tool; sandbox factories may pass a composed tool set |
| `sandbox: runtime.createAgentSandbox(...)` | `useSandbox(factory, { cwd })` — at most once per render |
| `cwd` | `useSandbox(factory, { cwd })` |
| `thinkingLevel` | `useModel(model, { thinkingLevel })` |
| `durability` | a **static**: `Agent.durability = { maxAttempts }` (a static, not a hook — applied when the function is not running) |
| `description` | deleted, no replacement |
| initializer `ctx.id` | `AgentProps`: the function receives `{ id }` |
| initializer `ctx.env` | platform imports / `process.env` |

Rules with no beta equivalent, because **the function re-renders before every model turn**:

- Resources (`useTool`, `useSkill`, `useSubagent`) may be conditional — changes are announced to the model
  as `resources` signals. `useSandbox` presence may flip (announced as an `environment` signal).
- **The function must be synchronous.** Async work moves into tools, lifecycle hooks
  (`useAgentStart`/`useAgentFinish`), or resource factories such as the sandbox factory's
  `createSandbox(options)` — where `options.id` carries the conversation id (that is also how
  per-conversation workspaces work now).
- Identity is the exported function's name (or an `fn.agentName` string-literal static). Renaming the
  function without an `agentName` pin is a storage-identity change.
- New hooks: `usePersistentState` (durable per-instance state), `useInitialData` (creation data, validated
  by an `initialData` schema static), `useDelivery` (delivered-message cursor), `useDispatchMessage`
  (self-dispatch), `useDataWriter` (client-facing data parts), `useResponseStart`/`useResponseFinish`
  (response metadata).

### 2.4 Tools

- `defineTool({ name, description, input, output, run })` keeps its shape; three changes:
  - `run({ input })` → `run({ data })` (the parsed-arguments field renamed).
  - `run()` returns an envelope `{ output?, terminate? }`. A bare `string` still works; any other bare
    value (object, number, array, `null`) **throws at runtime** with instructions to wrap it.
  - `harness: true` replaces all session plumbing: the tool receives `harness` with `harness.prompt()`
    (model calls in the tool's own scratch conversation) and `harness.sandbox`. `FlueSession`/
    `FlueSessions` and `harness.fs` are gone (`harness.sandbox` carries exec + file verbs + cwd).
- **`durable: true`** — checkpointed execution: `run` receives `step`; side effects go through
  `step.do(name, fn)`; recovery replays recorded step values. This is the in-agent replacement for small
  workflow orchestration.
- The `task` tool's `agent` parameter is now required; an unnamed task no longer clones the parent.
  `defineSubagent()` / `useSubagent({ name, description, agent })` define delegates; `GeneralSubagent` is
  the blank fresh-context delegate.
- The standard tool set is composable: `createReadTool()`, `createEditTool()`, `createGlobTool()`,
  `createGrepTool()`, `createBashTool()`, `createWriteTool()` — a `SandboxFactory` may pass `tools: [...]`
  to swap or drop the sandbox-backed set.

### 2.5 Skills

- Import-attribute syntax removed. An import resolving to a `SKILL.md` packages the whole skill directory
  and returns a `SkillReference` for `useSkill()`; any other `.md` import is plain inlined text. Wrap with
  `defineSkill({ name, description, instructions })` when needed.
- Manual invocation (`session.skill(...)`) is gone; steer by naming skills in instructions or
  `harness.prompt()` text.

### 2.6 Sandboxes

- **No implicit environment.** The beta gave every agent an in-memory virtual sandbox by default; now an
  agent without `useSandbox()` has **no filesystem and no read/write/edit/bash/grep/glob tools**, and
  `harness.sandbox` throws. (Our studio agent always passes an explicit sandbox, so we were already
  compliant in spirit.)
- Remote sandbox providers are created lazily inside the factory's `createSandbox(options)`, never at
  module top level — `options.id` is how durable per-conversation workspaces work.
- New `SandboxDriver` / `sandboxFromDriver()` abstractions; ecosystem sandboxes (E2B, Modal, Daytona,
  Cloudflare, boxd, …) documented per provider.

### 2.7 Workflows — removed

`defineWorkflow`, `invoke()`, `listRuns()`, `getRun()`, workflow routes, run events, `src/workflows/`
discovery, and `client.workflows.*` are all gone. Replacements, smallest first: an awaited `init()`
handle (`init(Agent, { id })` → `dispatch()` → `read(receipt)` with `AgentRunError` on failure), a
`durable: true` tool with `step.do(...)`, or an application-owned orchestrator. Scheduled work becomes
`dispatch(Agent, { id, message: { kind: 'signal', ... } })` from a cron trigger.

**Impact on us: zero migration burden** — Studio deliberately uses direct agent submissions for the main
loop and an in-process `dispatch()` for titling; we never adopted workflows (harness README, "Runtime
Ownership"). What we *lose* is nothing; what we *gain* is `init()` handles and durable tools we didn't
have.

### 2.8 Dispatch and sends

- `dispatch(agent, request)` keeps its shape; the named-string form (`dispatch({ agent: 'name' })`) is
  removed — pass the function itself. Our `conversations/titling.ts` dispatch call sites need that shape.
- Creation seed field is `initialData` (validated by the agent's `initialData` static; read with
  `useInitialData()`).
- **`uid` send conditions**: omit to continue-or-create; pass a prior receipt's `uid` to continue only
  that incarnation (`AgentInstanceNotFoundError`/404); pass `null` to create only
  (`AgentInstanceExistsError`/409, carrying the existing uid). `getAgentInstance(agent, id)` looks up
  `{ id, uid }` without sending. This is a real hardening opportunity for Studio's conversation-open race.
- **`dispatchId` → `submissionId` rename** across receipts, events, and telemetry
  (`flue.dispatch.id` → `flue.submission.id`). New submission ids are `sub_`-prefixed; ids are opaque.

### 2.9 MCP — first-class for the first time

`useMcpConnection(...)` mounts a remote MCP server's tools; `defineMcpConnection` /
`createMcpConnection` define them; `@modelcontextprotocol/client@2.0.0` is a runtime dependency. In beta.9
none of this existed — which is why our tree carries an entire hand-rolled MCP stack
(`src/extend/mcp/`: framing, JSON-RPC, era probes, lifecycle, pending-correlation, wire backoff,
handshake, supervisor, registry, reconcile, launcher, input-security, plus the capability catalog).

### 2.10 Channels

Explicit `channel.route()` mounts (no auto-serve from `src/channels/`); `conversationKey` →
`instanceId` renames across every connector; structured facts move to `initialData` instead of id
encoding; hand-written channels build on `createChannelRouter(routes)`. Not relevant to Studio's desktop
product today; a zero-cost option later.

### 2.11 Database and persistence

- **Persisted state reset.** Flue schema moves **v5 (beta) → v8 (2.0)**, and pre-release persisted
  schemas are **reset-only** — the runtime rejects an older database before any application code runs.
  There is no in-place migration. If beta conversation state must survive, export it through the beta
  application *before* upgrading and re-seed after; otherwise it is a drained deployment. This is the
  migration's one hard boundary.
- Ecosystem DB adapters now take your driver object instead of a connection string
  (`postgres({ query, transaction, close })` wrapping your own pool).
- `db.ts` moves from `.flue/db.ts` to the source root — **our `src/db.ts` is already there**; this item is
  accidentally done.
- Custom store adapters: `RunStore` and `EventStreamStore` are deleted; `AgentSubmissionStore` grew
  settlement and lease methods; **`@flue/runtime/test-utils` now ships contract test suites** for
  conversation-stream stores and attachment stores — directly usable against our SQLite adapter.

### 2.12 Providers

- Flue's provider registration schema is gone. `registerProvider()`, `registerApiProvider()`,
  `ProviderRegistrationError`, and the registration option bag are removed. Providers are now **Pi's own
  objects**, registered with `setProvider()`.
- `registerProvider('ollama', { api, baseUrl, ... })` → `setProvider(createProvider({ id, auth, models,
  api }))` with Pi's `createProvider`. Models are declared as full `Model` objects (each carries its own
  `baseUrl` and metadata); no catalog hydration or zero-fill for custom providers.
- `registerProvider('anthropic', { baseUrl, apiKey })` (patch a built-in) → register your own provider
  under the built-in's id, reusing its catalog models.
- `registerApiProvider({ api, stream, streamSimple })` (our local-adapter's contract) → pass the
  `{ stream, streamSimple }` pair as `createProvider()`'s `api` field; the global wire-protocol registry
  is gone. **Our `streamSimple` implementation maps over directly** — the wrapper changes, the
  implementation does not.
- `storeResponses` removed (no replacement); `telemetry` overrides removed; `headers` move onto `Model`
  objects; API keys become `auth.apiKey.resolve()` on the provider.
- In tests: Pi's `fauxProvider(...)` + `setProvider(faux.provider)`; no `.unregister()`.

### 2.13 Observability and events

- Run-scoped events are gone with workflows: `run_start`/`run_end` → `agent_start`/`agent_end`;
  `runId` correlation → `instanceId` (the agent instance) + `submissionId` (one submission); polling
  `getRun()` → `submission_settled` events (the terminal outcome of every submission); failed-run
  inspection → `operation` events with `isError`. Event envelope is `v: 3`.
- `createOpenTelemetryObserver()` from `@flue/opentelemetry` → `createOpenTelemetryInstrumentation()`,
  registered with `instrument(...)` instead of `observe(...)` (we already register via `instrument` —
  `src/observability/flue.ts:5` — so this is a name check, not a pattern change). The `exportContent`
  option became the instrumentation-wide `content` policy; old custom model/tool content attributes are
  no longer emitted alongside the standard fields. New in 2.0.3: GenAI semantic-convention projections
  (`GEN_AI_PROJECTION_REVISION`, `GEN_AI_SEMCONV_REVISION` in the package's exports).

### 2.14 Agent SDK

- The deployment-wide client is now **conversation-scoped**: `createFlueClient({ url:
  '/agents/<mount>/<conversationId>' })` — one client per conversation. No `baseUrl`, no
  `client.agents.*` namespaces.
- The conversation client exposes `send` (202 admission; returns `uid` and `submissionId`), `wait()`,
  `observe()`, `history()`, `abort()`, `attachmentUrl()`.
- `wait()` rejects with `FlueExecutionError`; error codes renamed (`agent_not_found` →
  `agent_instance_not_found`; new `agent_instance_exists` for conditional sends).
- **`abort()` aborts the conversation's in-flight *and queued* work — there is no per-submission abort.**
  For Studio's one-active-run-per-conversation UX this is equivalent in practice, but queued sends die
  with an abort — a behavioural note, not a blocker.
- Live updates default to SSE with long-poll fallback.
- `ConversationStreamChunk` and the conversation snapshot/history/observation types we consume in
  `application/harness-client.ts` all still exist in the 2.0.3 SDK exports (verified) — the seam survives;
  the shapes around it change.

### 2.15 React

`@flue/react` exports only `useFlueAgent({ url | client })`; `FlueProvider` and `useFlueWorkflow` are
removed. Irrelevant to us — the frontend does not use `@flue/react`; it talks through the Tauri
`service_fetch`/`service_stream` seam.

### 2.16 What changed inside the machinery we patch (verified bundle diffs)

This is the part the migration guide doesn't cover, checked by diffing our patched beta.9 bundles against
the shipped 2.0.3 bundles:

- **`composeSystemPrompt`** (`conversation-stream-store-*.mjs`): the headless preamble we patched out is
  **gone upstream** — their comment says "an autonomy preamble used to live here". The skills section we
  kept is unchanged in wording. But 2.0.3 now **re-adds upstream** what our patch removed: a `Date:` line,
  `Working directory:`, `Directory structure:` (when non-empty), and a new **always-present**
  `## Available Agents` section — including when the roster is empty, where it instructs the model *not*
  to call `task`. There is new `recompose` machinery (dynamic skill/agent catalogs that can change
  mid-conversation with announcements). Consequence for us in 3.4.
- **`isRetryableModelError`** (now in `dispatch-*.mjs`, was `conversation-projections-*.mjs`): still the
  inline regex, extended with a `(retryable_interruption)` marker and a `provider finish_reason: error`
  alternative — **still no quota/billing exclusion**, so our pi-ai delegation patch remains justified.
  `isRetryableAssistantError` verified exported from pi-ai 0.84.4.
- **`waitForTransientModelRetry`** (`conversation-stream-store-*.mjs`): still the invisible-retry design —
  one shipped budget (`MAX_TRANSIENT_MODEL_RETRIES = 3`), internal warn log only, no
  `submission_retry_scheduled` record, no per-class budget, no external policy hook. Our Task 29/30 patch
  (visible retries + per-class budget via `globalThis.__projectStudioTransientModelRetryPolicy`, fed from
  `src/reliability/model-retry-policy.ts`) **remains necessary** and must be re-derived. Note the 2.0.3
  function now computes its own `modelRetryDelayMs(attempt)` — the delay curve overlaps with what our
  policy owns, so the re-derived hunk must own the delay too, not just the budget.
- **`VALID_THINKING_LEVELS`** (now in `dispatch-*.mjs`): **`max` is included upstream**. Our patch hunk is
  obsolete.
- **Cache breakpoints** (pi-ai anthropic adapter, unchanged design): `cache_control` on the system prompt,
  on the **last tool** (the breakpoint our `agents/studio.ts:92` comment reasons about), and on the last
  user message block. The "You are Claude Code" prefix for OAuth-token Anthropic models still exists in
  pi-ai 0.84.4's `buildParams` — still dormant for us (no OAuth models in our local catalog), still a
  surprise waiting if one is added.
- **Bundle layout**: beta.9's `conversation-projections-*.mjs` responsibilities are now split across
  `dispatch-*.mjs`, `events-*.mjs`, `gateway-*.mjs`, `agent-coordinator-*.mjs`, `observation-*.mjs`,
  `provider-diagnostics-*.mjs`, `mcp-*.mjs`. Every patch hunk's anchor file has a new content hash; the
  hash-named patch files fail loudly rather than half-applying (by design — see `pnpm-workspace.yaml`'s
  patch comments).

---

## Part 3 — Impact on Studio, category by category

### 3.1 What does NOT change at all (verified, not assumed)

- **The process architecture.** Still one harness process (`node dist/server.mjs`) spawned by the Tauri
  host; Flue is still an in-process library mounted inside the harness's own Hono app
  (`transport/http/create-app.ts`); the chain webview → Tauri IPC (`service_fetch`/`service_stream`) →
  Rust (holds the bearer) → loopback HTTP → harness is untouched. 2.0 introduces no separate Flue server,
  no per-agent processes, no new wire between processes.
- **The Tauri host** (`STUDIO/src-tauri/`): supervisor, Windows job-object containment, environment
  allowlist, bootstrap fd 4 / readiness fd 3 handshake, `HarnessEndpointView`, `service_fetch` /
  `service_stream` — all survive because `dist/server.mjs` remains the artifact and the spawn contract is
  ours, not Flue's.
- **The entire frontend** (`STUDIO/`): React, Tauri shell, design system, transcript, composer — zero
  changes required. `@flue/react` is not used.
- **Studio's product layer**: admission (scopes, verifier, per-launch credential), permission kernel and
  CallGate, native tool registry, sandbox containment, snapshot store, projects, retrieval, app settings,
  migrations — none of it is Flue-coupled in a way 2.0 disturbs.
- **Node engine** `>=22.19.0` — identical on both sides.
- **`src/db.ts` location** — already the 2.0 convention (source root).

### 3.2 What changes, file by file

| File | Change | Size |
|---|---|---|
| `src/agents/studio.ts` | Rewrite as an exported function in a `'use agent'` module: `useModel` (thinking level moves here), `useSandbox(factory, { cwd })`, return the instructions string. Delete `export const route`. **The async initializer is the hard part** — see 3.3. | Medium, delicate |
| `src/agents/title.ts` | Same conversion. Dispatch-only: **no mount needed** (its only caller is `conversations/titling.ts:205`'s in-process `dispatch()`). Its no-tools / no-sandbox isolation maps to simply *not* declaring them — note 2.0's "no implicit sandbox" makes its isolation posture the default rather than something it opted into. | Small |
| `src/models/adapters/local-adapter.ts`, `test-adapter.ts` | `registerApiProvider`/`registerProvider` → Pi `createProvider` + `setProvider`; the `{ stream, streamSimple }` pair becomes the provider's `api` field; models become full `Model` objects. The `streamSimple` implementation carries over. | Medium |
| `src/application/harness-client.ts` | SDK reshape: conversation-scoped `createFlueClient({ url })`, new send body shape, renamed error codes, `wait()` semantics, abort scope. | Medium |
| `src/app.ts` + `src/transport/http/create-app.ts` | Required explicit mounts; `flue()` auto-router line replaced by `createAgentRouter(StudioAgent)` (one line); admission middleware stays ordinary Hono middleware. | Small |
| `src/conversations/titling.ts` | `dispatch()` named-string → function reference; consume renamed events where it observes. | Small |
| `src/observability/flue.ts` | Event renames (`run_*` → `agent_*`, `dispatchId` → `submissionId`, envelope v3); `createOpenTelemetryInstrumentation` name already matches; consider the new GenAI projections. | Small |
| `src/db.ts` + SQLite stream store | `AgentSubmissionStore` settlement/lease method additions; optional adoption of `@flue/runtime/test-utils` contract suites. | Small–Medium |
| `package.json` scripts + build | `flue build --target node` → `vite build` with `@flue/vite`; add `vite`, `@flue/vite`, `hono` (present), `@earendil-works/pi-ai` moves to a direct dependency; `@flue/cli` shrinks to a dev tool (its build/dev roles are gone). | Small |
| `pnpm-workspace.yaml` + `patches/` | See 3.4. | Medium |
| Conversations **data** | Flue SQLite schema v5 → v8, **reset-only**. Export-before-upgrade or accept the loss. Studio's own stores (app settings, projects) are separate and unaffected. | Planning item |

### 3.3 The painful list, ranked

1. **Conversation data reset (irreversible if skipped).** Not code — user data. Flue's own store is
   rejected on startup when it predates v8. An export/re-seed path must exist before anyone upgrades a
   machine with real history on it. This is the one item with a deadline attached to it.
2. **The synchronous agent function vs. our async initializer.** `agents/studio.ts` currently does, per
   run: `runtime.start()`, `runtime.reconcile()`, directory creation, and the per-conversation
   turn-settings read (model + reasoning level) that decides `useModel`'s argument. 2.0 agent functions
   must be sync and re-render every turn. The migration shape: sandbox factory's `createSandbox(options)`
   owns the per-conversation directory setup (`options.id` is the conversation); the turn-settings read
   needs a sync cache warmed by a lifecycle hook or at admission time, because `useModel` is required
   exactly once per root render with no awaiting. This is the single genuinely non-mechanical step.
3. **The CLI patch must be re-architected, not re-derived.** Our `@flue/cli` patch injects, into the
   generated entry point: the admission bootstrap fd-4 read, the `PROJECT_STUDIO_HARNESS_HOSTNAME`
   loopback bind, and the fd-3 readiness frames the Rust supervisor blocks on. In 2.0 the CLI no longer
   generates that entry (Vite does, via `@flue/vite`, and the CLI bundle no longer even contains the HTTP
   server). The same four behaviours must be re-landed against the new generated entry — likely as a
   custom entry wrapper we own, or post-build injection into `dist/server.mjs`. Everything the Rust side
   expects (frame shape, fd numbers, env names) is ours and must keep matching
   `harness/channel.rs` / `bootstrap.rs`.
4. **Provider rewrite.** Mechanical but wide: two adapters, plus the models catalog mapping into full
   `Model` objects (per-model `baseUrl`, contextWindow, capabilities — data we already maintain in
   `src/models/local/catalog.ts`).
5. **SDK reshape ripples.** `harness-client.ts` plus whatever assumptions the Rust `service_stream` path
   makes about paths/offsets. The chunk types survive; the client construction and error surface change.
6. **Patch re-derivation.** Hash-anchored patches fail loudly (good), then two hunks must be re-derived by
   hand against new bundles (see 3.4). The patch files themselves contain re-derivation instructions —
   keep that discipline.

### 3.4 The patch-by-patch verdict

| Patch hunk | What it does | Verdict on 2.0.3 | Effort |
|---|---|---|---|
| `@flue/runtime` hunk 1 — `VALID_THINKING_LEVELS` + `max` | Let the type-legal `max` level past runtime validation | **Obsolete** — upstream includes `max` (`dispatch-*.mjs`) | None |
| `@flue/runtime` hunk 2 — delegate transient-error classification to pi-ai's `isRetryableAssistantError` | Retry the right failures; never retry billing exhaustion | **Still needed** — 2.0.3 ships an extended regex that still lacks quota exclusions; target verified present in pi-ai 0.84.4 | Re-derive vs `dispatch-*.mjs` |
| `@flue/runtime` hunk 3 — visible retries + per-class budget (`submission_retry_scheduled` record; `globalThis.__projectStudioTransientModelRetryPolicy` from `src/reliability/model-retry-policy.ts`) | A retry the user can see; budget per failure class (rate-limit 8, transport 2, else 3) | **Still needed** — 2.0.3 is still invisible with one fixed budget of 3; must now also own the delay curve (`modelRetryDelayMs`) | Re-derive vs `conversation-stream-store-*.mjs` (+ possibly `dispatch-*.mjs`) |
| `@flue/runtime` hunk 4 — `composeSystemPrompt`: drop headless preamble, drop Flue's date/cwd/directory lines | Studio owns its environment facts (`src/context/environment.ts`) and pays for them once, cache-stably | **Flips.** Preamble removal is upstream now; but 2.0.3 re-adds `Date:`/`Working directory:`/`Directory structure:` and an always-on `## Available Agents` section. Decide: drop our `# Environment` block (lose git/shell/machine facts) or re-patch to suppress the duplication. The empty-roster `Available Agents` paragraph is new prompt text we have not reviewed. | Decision + small patch |
| `@flue/cli` patch — bootstrap fd, loopback bind, readiness frames | The entire Rust↔harness handshake | **Re-architect** for the `@flue/vite`-generated entry (hunk targets are gone) | The largest single patch item |
| `pnpm-workspace.yaml` patch registry | Pins patches to exact versions | Re-point to 2.0.3; hashes guarantee loud failure if an anchor drifts | Trivial |

### 3.5 The blessing list — what we gain

- **Maintenance resumes.** The branch we're on is dead; every fix since 2026-06-30 is 2.x-only. Four
  releases in 2.0's first week says the line is active.
- **Two patches deleted, one shrunk.** The framework fixed what we patched around (thinking levels,
  preamble). Upstream `composeSystemPrompt` now composes almost exactly the way our patch forced it to.
- **MCP becomes framework work.** `useMcpConnection` replaces our wire plumbing — framing, JSON-RPC
  correlation, era probes, lifecycle, backoff, handshake (`src/extend/mcp/wire/*` and friends). What we
  keep is the part that is genuinely ours: sandbox containment of MCP processes, secret scrubbing, and
  permission gating of every call. Net code reduction in a subsystem we otherwise own forever.
- **`submission_settled` events** — terminal outcome per submission, which is cleaner than what titling's
  retry loop and reconcile paths infer today.
- **`uid` send conditions** — create-only/continue-only dispatch with 409s hardens the conversation-open
  race.
- **`initialData`** — structured creation data instead of conventions encoded in ids.
- **Durable tools** (`step.do`) — checkpointed side effects we had no framework answer for.
- **Subagents** (`useSubagent`) — a real delegation path if Studio ever wants one, with the roster
  announced in-prompt and changes signalled mid-conversation.
- **Official store contract tests** — `@flue/runtime/test-utils` suites we can run our SQLite stream
  store against, for free.
- **GenAI semantic-convention telemetry** in `@flue/opentelemetry` — richer model-call tracing than our
  current custom content attributes.
- **Re-render = dynamic context done right.** The environment block's "re-bills when the day turns" cache
  wrinkle (`agents/studio.ts:91-101`) becomes a first-class concept: conditional resources with
  announcements, instead of a hand-balanced prompt.

### 3.6 Effort shape

- **Frontend / Tauri / Rust: ~0%.** No changes required; the spawn contract is preserved by design.
- **Harness code: ~10–15% touched**, concentrated in the files listed in 3.2 — the boundary layer between
  Studio's contracts and Flue's API. Studio's own HTTP surface, permissions, storage, and tools are
  untouched.
- **Plus two work items with no line-count**: the conversation-data export plan (3.3 #1) and the CLI-patch
  re-architecture (3.3 #3).

---

## Part 4 — Recommended sequence (if we go)

The migration guide's checklist, reordered for our shape and risks:

1. **Export the conversation store first** (or accept loss explicitly). Everything else is recoverable;
   this isn't.
2. **Pins and build**: `@flue/*@2.0.3`, `pi-ai` `^0.84`, add `vite` + `@flue/vite`; move scripts; author
   `vite.config.ts`; fix `flue.config.ts` imports.
3. **Re-land the handshake patch** (bootstrap fd / readiness / loopback bind) against the new generated
   entry, and prove it with the existing harness-launcher test seam *before* porting agents — it is the
   contract the Tauri host cannot flex.
4. **Port the two agents** behind unchanged contracts: `studio.ts` (solve the sync-render problem:
   sandbox factory owns per-conversation setup; turn-settings read becomes a sync cache) and `title.ts`
   (dispatch-only). Delete `export const route`.
5. **Providers**: convert local/test adapters to `createProvider` + `setProvider`; map the catalog into
   full `Model` objects.
6. **`harness-client.ts` + stream paths**: conversation-scoped clients; confirm the Rust
   `service_stream` offset/retry assumptions against the new chunk shapes.
7. **Events/observability renames** in `titling.ts` and `observability/flue.ts`.
8. **Patches last**: regenerate `pnpm-workspace.yaml` entries; re-derive hunks 2 and 3; make the
   environment-block decision (hunk 4) with a fresh prompt diff in hand.
9. **Adopt, where cheap**: `submission_settled` for titling triggers; `uid` conditions at conversation
   open; `test-utils` contract suites for the SQLite store; MCP evaluation as a *separate* follow-up (the
   permission wrapper must be proven first — do not swap the MCP stack and the runtime in the same move).

Cross-references: the retry patch's design history is `report/TASK-29-a-retry-you-can-see.md` and
`report/TASK-30-the-budget-is-per-class.md`; the policy itself is
`STUDIO HARNESS/src/reliability/model-retry-policy.ts` with the architecture map in
`documentation/architecture/retry.md`.

---

## Part 5 — Appendix: how each claim was verified

- **Versions/dates**: npm registry metadata and `dist-tags` for `@flue/runtime`, `@flue/cli`, `@flue/sdk`,
  `@flue/opentelemetry`, `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core` (queried 2026-08-31).
- **2.0.3 behaviour**: published tarballs of all four `@flue` packages and pi-ai 0.84.4, downloaded and
  extracted; export surfaces read from `dist/index.d.mts` (both versions); key functions read in-source
  (`composeSystemPrompt`, `discoverSessionContext`, `waitForTransientModelRetry`,
  `isRetryableModelError`, `VALID_THINKING_LEVELS`, `assembleModelTools`, pi-ai's `buildParams`/
  `convertTools` cache placement).
- **Migration facts**: `docs/guide/migration.md`, shipped in the `@flue/runtime@2.0.3` tarball, read in
  full.
- **Our side**: every `@flue` import in `STUDIO HARNESS/src` enumerated and matched against the 2.0.3
  export surface; both patch files read in full; Tauri host spawn/readiness contract read from
  `STUDIO/src-tauri/src/harness/*`.
- **Known gaps**: GitHub Releases for `withastro/flue` return empty and no CHANGELOG.md ships, so the
  *narrative* of what changed between 2.0.0 and 2.0.3 is inferred from bundle diffs rather than release
  notes. The `title.ts` isolation posture under 2.0's "no implicit sandbox" default is marked inference
  where it depends on runtime defaults we have not executed.
