# Studio Harness State

## Audit Metadata

- Audit date: 2026-08-13.
- Repository: `ProjectStudio`.
- Audited branch: `task/phase-11-mcp-l-06`.
- `HEAD`: `4a4df87`, shared with `main`.
- Evidence condition: the working tree contains uncommitted Phase 11 implementation and tests. This document describes current code and labels committed versus uncommitted behavior.
- Authority rule: executable code and tests determine what exists and works; ADRs determine intended architecture where they remain current; stale status prose is a discrepancy.

## Executive Overview

Studio Harness is currently a local Node.js TypeScript agent-runtime backend, not a complete desktop product. It composes Flue for durable agent execution and conversation state, Pi for model protocols and provider behavior, and Project Studio code for policy, permissions, credentials, model-source selection, native tool implementations, MCP integration, product configuration persistence, snapshots, and observability.

The active completion authority is `tasks/phase-11-mcp/008-phase-1-11-completion.md`.
It closes Phases 1-11 one dependency at a time, includes all accepted/deferred
decisions, and excludes visual UI work while requiring stable API and client
contracts.

The repository contains three separate applications:

| Component | What it is today | Runtime status |
| --- | --- | --- |
| `STUDIO HARNESS/` | Real local agent runtime and authenticated MCP client/control plane | Backend vertical slice works; dirty tree adds MCP/native application wiring |
| `STUDIO Gateway/` | Independent Cloudflare Worker with D1 and OpenAI-compatible routes | Source exists; contract is not aligned with the Harness adapter |
| `STUDIO/` | React/Vite/Tauri desktop shell and demo UI | Visual/demo surface; no production transport |

The strongest implemented path is:

`Flue admission -> durable agent -> Pi model adapter -> model tool call -> MCP sandbox tool -> CallGate -> PermissionKernel/approval -> MCP stdio or Streamable HTTP server -> result -> Flue continuation`

That path is proven by real generated-server and real stdio MCP integration tests in the uncommitted tree. The local control routes now have a global in-memory admission verifier and operation scopes, and the headless/Tauri Host and desktop client source seams exist; cargo, packaging, and desktop E2E verification remain open. The current Gateway Worker does not implement the Harness custom SSE contract.

The correct maturity statement is **functionally substantial backend, experimentally integrated MCP, disconnected desktop, and incomplete production boundary**.

## Current Phase And Completion

| Phase | Objective | Reconciled status | Evidence and remaining work |
| --- | --- | --- | --- |
| 1-4 | Harness foundation, loop, persistence, recovery, continuation | Implemented | Flue composition, `src/db.ts`, `src/agents/studio.ts`, `tests/integration/harness.test.ts` |
| 5 | Observability foundation | Implemented | `src/observability/`, Flue instrumentation, observability tests |
| 6 | Provider bootstrap and stable model identity | Implemented | `src/models/bootstrap.ts`, `model-registry.ts`, provider tests |
| 7 | Studio Gateway adapter and streaming integration | Harness-side implemented; repo-wide partial | `src/models/studio-cloud/`; current Worker emits OpenAI chunks rather than the custom Harness events |
| 7.5 | Architecture/modularity review | Implemented as review work | Roadmap records removal of dead event envelope and deferred product projections |
| 8 | Auth, secure credentials, local BYOK, application DB | Harness-side implemented; product integration absent | `src/auth/`, `credentials/`, `models/local/`, `storage/`; no desktop/auth-worker integration |
| 9 | Permission and containment kernel | Foundation implemented; application/isolation edges partial | `src/permissions/`, `src/sandbox/`, `src/tools/gate.ts`; remote OS isolation and grant audit remain open |
| 10 | Native tools | Libraries and CallGate production wiring implemented in dirty tree | Native families register through `registerNativeTools()`; local/manual posture and later product exposure remain |
| 11 | MCP client, lifecycle, grants, capabilities, management, wiring | Core P1/P2 remediation and Host/client source seams exist; formal closure not justified | Auth, recovery, catalog refresh, names/results, credential lifecycle, append-only membership, native wiring, loopback/readiness, and focused tests landed; runtime restart proofs, packaging, OAuth, bundled library, and management-tool scope remain |
| 12 | Skills | Designed only | Generic extension kind exists; no skill loader/executor |
| 13 | Subagents and tasks | Partial upstream surface | Flue task surface exists; no Project Studio child identity/profile/policy |
| 14 | Projects, workspaces, sandboxes | Designed beyond snapshots | UI projects are in memory; no product project persistence or Flue binding |
| 15 | Memory and context | Designed only | `PassthroughContextOptimizer`; no memory store or context assembly engine |
| 16 | Workflows and schedules | Designed only | No application workflow/schedule code |
| 17 | Evals | Designed only | No eval subsystem |
| 18 | Product integration | API/Host source exists; product integration incomplete | `STUDIO/src/platform/harness/`, Tauri Host, and `useFlueChatSession` exist; cargo/packaging/E2E and product projections remain |

The Phase 11 loose-end rule in `tasks/phase-11-mcp/005-loose-ends.md` requires a source caller, a proving test, and documentation explaining the rule. The dirty tree now satisfies those three for L-06 through L-09; task 007 records the broader P1/P2 remediation and Task 008 orders the remaining closure work. Phase 1-11 is therefore **functionally advanced but not a clean completion checkpoint** because runtime/platform proofs, containment decisions, API closure, Gateway contract, and deferred Phase 11 decisions remain.

## Repository Structure

```text
ProjectStudio/
  documentation/                 Repo-wide architecture, mental model, phase and audit docs
  tasks/                         Active task instructions and delegation rules
  STUDIO HARNESS/                Local TypeScript runtime
    src/                         Agent, application, auth, contracts, models, policy, tools
    tests/                       Unit and integration tests
    docs/                        Status, roadmap, known issues, ADRs
    vendor/                      Pinned binaries and manifest
  STUDIO Gateway/                Cloudflare Worker and D1 migrations
  STUDIO/                        React/Vite/Tauri desktop application
    src/                         UI components and demo state
    src-tauri/                   Rust Tauri shell and generated schemas
```

Meaningful Harness directories are `agents`, `application`, `auth`, `context`, `contracts`, `credentials`, `extend`, `host`, `models`, `net`, `observability`, `permissions`, `platform`, `process`, `retrieval`, `sandbox`, `snapshots`, `storage`, `tools`, and `vendor`. The current tree adds `application/approval-*`, `application/mcp-*`, `application/studio-runtime.ts`, `extend/mcp/capabilities.ts`, and `host/*` as untracked files.

There is no `archive/` directory despite `documentation/architecture.md` describing one. There is no `MCP/` directory in this checkout. There is no `.github` CI workflow, Dockerfile, Compose file, or application deployment manifest. `STUDIO Gateway/wrangler.toml` is the Worker deployment configuration; `STUDIO/src-tauri/tauri.conf.json` is the desktop bundle configuration.

The tracked `HEAD` inventory is approximately 420 files: 135 Harness source files, 54 Harness test files, 80 desktop source files, and 46 Gateway source files. Untracked Phase 11 files and the Linux vendor directory make the working-tree inventory larger.

## Intended Versus Actual Architecture

| Claim | Intended source | Actual implementation |
| --- | --- | --- |
| Desktop and Harness are separate processes | ADR 0001, `documentation/architecture.md` | Structurally true. The desktop has no client implementation, so the boundary is designed but not exercised by `STUDIO`. |
| Flue owns loop, durability, transcript, and recovery | ADR 0001, `src/db.ts` | True for the backend. Flue owns the canonical execution database. |
| Pi owns provider protocol behavior | `documentation/mental-model.md`, `src/models/` | True in the Harness; adapters register Pi protocols. |
| Project Studio owns policy and tools | ADR 0012, `src/permissions/`, `src/tools/` | Native and MCP tools are registered through the dirty-tree CallGate composition. |
| `app.ts` mounts only standard Flue routes | ADR 0004, ADR 0028 | `app.ts` calls `createHttpApp()`; route implementation lives in the transport factory and is globally admitted. |
| MCP changes apply at turn boundaries | Phase 11 design, `registerFlueTurnBoundary` | Reconciliation runs at startup and before model turns; recovery callbacks and dirty catalog refresh are wired. |
| Tool discovery is append-only within a session | `documentation/mental-model.md` section 3.4, ADR 0029 | Existing sandboxes retain MCP tools and return unavailable results after disable; new sandboxes start from live selection. |
| Public API authenticates users and private Gateway trusts service binding | ADR 0002, roadmap | The public API worker is absent. Gateway now fails closed outside explicit development/test mode; Harness session tokens are still not accepted by Gateway. |
| Desktop is the product face of the runtime | `documentation/architecture.md` | UI is a disconnected demo and Tauri only exposes `app_ready`. |

## Runtime Topology

### Harness Startup

1. `STUDIO HARNESS/src/app.ts` resolves `PROJECT_STUDIO_MODEL_SOURCE`.
2. `bootstrapModelProviders()` registers the selected test, Studio Cloud, or local adapter with Flue/Pi and resolves `project-studio/default`.
3. `initializeObservability()` configures redaction, OTel, and Flue instrumentation.
4. `PermissionApprovalBroker` is created in memory.
5. `StudioRuntime` opens application SQLite and constructs registries, selection, grants, trust, supervisor, catalog, and management services.
6. `registerFlueTurnBoundary()` calls `StudioRuntime.prepareModelTurn()` before model operations.
7. `StudioRuntime.start()` begins MCP reconciliation asynchronously.
8. Admission creates the per-launch local client/session context.
9. `createHttpApp()` mounts the admission middleware before Flue, `/api/mcp`, and `/api/permissions`.

### Agent Admission And Turn

1. An admitted client submits a direct agent request on Flue's standard route.
2. Flue resolves `src/agents/studio.ts`, calls runtime startup/reconciliation, and creates a continuing agent instance.
3. The agent uses `STUDIO_MODEL_ID` and a `SandboxFactory` from `StudioRuntime.createAgentSandbox()`.
4. Flue/Pi builds the model request and owns looping, streaming, continuation, durable submission, and settlement.
5. The turn interceptor reconciles selected MCP servers.
6. Flue asks the sandbox for tools. `StudioRuntime` refreshes MCP tools in the per-agent `CallGate`.
7. The model sees CallGate-backed native tools and dynamic MCP tools; no direct Flue tool bypass remains.
8. An MCP call enters `CallGate.call()`: parse, resource derivation, permission, sandbox check, snapshot if needed, bounds, execution.
9. `McpConnection` sends `tools/call` over stdio or Streamable HTTP.
10. Flue receives the result, continues, and persists canonical events/final state in Flue SQLite.

### Worker Topology

No worker-to-worker topology is implemented in this checkout.

| Runtime | Entrypoint | Communication | State |
| --- | --- | --- | --- |
| Harness Node process | `src/app.ts`, generated by `flue build --target node` | Local HTTP/Hono; child stdio; outbound direct HTTP | Flue SQLite, application SQLite, OS keychain, shadow Git |
| Gateway Worker | `STUDIO Gateway/src/index.ts` | `/v1`, `/admin`, system routes, cron | D1 and Worker secrets |
| Desktop Tauri process | `STUDIO/src-tauri/src/main.rs` -> `lib.rs` | WebView and Tauri commands | React in-memory state |

The public API/auth worker, service binding, R2, KV, and Durable Object sources described by roadmap prose are absent.

## Data Topology

| Data | Owner | Location | Status |
| --- | --- | --- | --- |
| Canonical conversation, submissions, runs, events | Flue | `~/.studio/data/flue.db` via `src/db.ts` | Implemented and tested |
| Product configuration, grants, trust, selection, MCP rows | Project Studio | `~/.studio/data/studio.db` via `src/storage/` | Implemented and migrated through schema 8 in dirty tree |
| Provider/session/MCP secrets | OS keychain | `src/credentials/` | Implemented; no plaintext fallback |
| Undo history | Project Studio | `~/.studio/data/snapshots/<project-key>` | Implemented shadow Git; deliberately not DB-backed |
| MCP processes/connections/retries | Runtime memory | `McpSupervisor` | Rebuilt from durable rows; not durable |
| Pending approvals | Runtime memory | `PermissionApprovalBroker.#pending` | Not restart-safe |
| File access observations | Runtime memory | `FileAccessLog` | Implemented; cleanup caller absent |
| Projects, notes, tasks, UI files | Desktop React state | `ProjectsProvider` | Demo-only, lost on reload |
| Artifacts/attachments | None at product layer | Flue has upstream primitives but no app client/routes | Not integrated |
| Memory | None | No store or retrieval contract | Designed/deferred |
| Product event projections | None | Dead envelope removed in Phase 7.5 | Deferred to Phase 18 |
| Cloud product persistence | None | Gateway D1 stores provider/model/key data only | Not implemented |

The application DB has a transaction helper, but MCP management performs registry, grant, selection, supervisor, credential, and generation updates separately. Cross-store atomicity is not established.

## Agent, Planner, Execution, And Subagents

The actual agent is the Flue continuing agent in `src/agents/studio.ts`. Flue owns execution identity, durable submission, transcript, loop, continuation, and recovery. Project Studio supplies model identity, workspace, sandbox, policy, MCP gate tools, and a test fixture.

`ExecutionScope` carries admitted client/session identity, separate agent and
conversation fields, and project ownership. ADR 0030 deliberately limits this
to one local Host session; account-backed user ownership and multi-user/subagent
authority remain deferred.

| Capability | Status | Evidence |
| --- | --- | --- |
| Main agent loop | Implemented by Flue | `defineAgent`, Flue runtime, Harness integration tests |
| Multi-step continuation | Implemented by Flue | `studio-flue.test.ts`, Gateway event mapper |
| Durable submission/recovery | Implemented by Flue | `src/db.ts`, Harness tests |
| Project Studio Agent Runtime | Partial | Sandbox/policy composition exists; loop remains Flue-owned |
| Planner Runtime | Designed only | No planner implementation or caller |
| Execution Runtime | Partial | Gate, bounds, sandbox, snapshots, MCP executor; no separate worker |
| Subagents | Partial/upstream | Flue task surface; no Project Studio child profile/scope policy |
| Retry | Partial | Flue retries and MCP supervisor retries; no unified policy |
| Cancellation | Partial | Tool signals and approval waits are abort-aware; pending approvals are still process-memory across restart |
| Parallel tools | Unknown/Flue-owned | Multiple calls can be represented; no Project Studio pool/policy |

There is no Project Studio planner, tool pool, execution worker, agent registry/profile system, or subagent policy engine. Flue's task tool can be present without named Project Studio subagents, and child work currently inherits parent selection/tool closure. Phase 13 must establish child authority explicitly.

## Tool System

### Native Tools

| Family | Tools | Registrar | Production exposure |
| --- | --- | --- | --- |
| Filesystem | `read`, `write`, `edit` | `registerFilesystemTools()` via `registerNativeTools()` | CallGate-backed |
| Search | `glob`, `grep` | `registerSearchTools()` via `registerNativeTools()` | CallGate-backed |
| Version control | `git` | `registerGitTools()` via `registerNativeTools()` | CallGate-backed |
| Execution | `shell` | `registerShellTools()` via `registerNativeTools()` | CallGate-backed |
| Web | `web_search`, `fetch` | `registerWebTools()` via `registerNativeTools()` | CallGate-backed |
| Fixture | `workspace_summary` | Native descriptor via `registerNativeTools()` | CallGate-backed |

The native families are real implementations with unit tests and are now
registered through the one production CallGate. They remain local/manual
capabilities rather than a multi-user product surface.

Native execution uses `src/process/exec.ts`, absolute executable paths, `shell: false`, explicit environments, vendor/system resolution, bounds, and snapshots. Known limits include Git's unresolved per-subcommand network effect and the Windows `taskkill`/stdin issues in `KNOWN-ISSUES.md`.

### Retrieval And Web

`RetrievalService` owns provider choice and key lookup. Search slots are Tavily, Brave, and Exa; reader slots are Jina and Firecrawl. Native web output is labelled untrusted and registered through the CallGate. There is no vector RAG, local-corpus index, or embedding pipeline; those remain deferred.

### Tool Pool

No separate Tool Pool exists. There is no user-scoped/session-scoped worker, planner-facing tool pool, or subagent-facing execution service. `CallBounds` is a FIFO queue inside one gate. MCP supervisor entries are live external connections, not a general tool pool.

## MCP

### Implemented Protocol Surface

MCP is implemented as a client for external user-installed servers. No MCP server implementation exists in this repository. Installed-server count is dynamic from `mcp_server` rows; live connections are held by `McpSupervisor`.

The authoritative client path is:

`McpServerRegistry -> ExtensionInventory/Selection -> ExtensionReconciler -> McpSupervisor -> McpLauncher -> StdioChannel or HttpChannel -> McpConnection -> handshake/era/wire -> McpCapabilityCatalog -> CallGate -> Flue sandbox tool`

`/api/mcp` is a management API, not an MCP protocol endpoint. The client supports `server/discover`, legacy `initialize`, `tools/list`, and `tools/call`, with modern/legacy handshake handling, JSON-RPC framing/correlation, stdio, and Streamable HTTP. HTTP+SSE, Roots, Sampling, Logging, resources, prompts, server-initiated requests, and an in-repo MCP server are not implemented.

### Current Dirty-Tree Additions

- `McpManagementService` for install/edit/remove, selection, credential, grant revocation, supervisor stop, and reconcile invalidation.
- `/api/mcp/servers` status/mutation routes.
- `/api/permissions/pending` approval listing/answer/cancel routes.
- `McpCapabilityCatalog` pagination, malformed/duplicate withholding, provenance, effects, execution closures, dirty refresh, result normalization, and untrusted-content labeling.
- Definition hashes in migration 8 and kernel re-approval when definitions change.
- Real stdio and Flue integration tests.

### MCP Gaps

- OAuth 2.1 is designed but auth kinds are only `none`, `bearer`, and `header`.
- The bundled extension library is absent.
- A model-facing management tool is absent; management is HTTP-only.
- TTL/interval refresh is absent; notification-driven refresh is implemented at turn boundaries.
- Background supervisor recovery notifies the catalog and replaces closed connection closures.
- Credential rotation/removal stops live connections and cleans keychain state.
- Tool validation enforces the documented 64-character grammar and injective model names.
- MCP `isError`, structured/non-text results, and untrusted-content labels survive projection.
- ADR 0029 defines append-only session membership with dispatch-time unavailable results.

## Skills, Connectors, And Registries

The generic extension spine recognizes `mcp`, `skill`, and `hook` in `src/extend/inventory.ts`, and selection is persisted by `(kind, extension_id, project_id)`. Only MCP has a provider and reconciler. There is no `src/extend/skills/`, skill storage, discovery, metadata loader, execution path, skill context, or skill-to-agent/MCP integration.

Connectors are described by the mental model as Composio-backed remote MCP servers, but no Composio client, connector registry, connector credential flow, connector discovery, or connector execution exists. Treating the generic `mcp` kind as a connector implementation would be incorrect.

The real registries are:

| Registry | Location | Actual role |
| --- | --- | --- |
| Model source registry | `src/models/model-registry.ts` | Selected test, Studio Cloud, or local provider adapter |
| Native capability registrars | `src/tools/*/index.ts` | Build gate registrations; currently test/unused in production |
| MCP server registry | `src/extend/mcp/registry.ts` | Durable installed-server configuration |
| Extension inventory/selection | `src/extend/inventory.ts`, `selection.ts` | Installed summaries and project enablement |
| MCP supervisor | `src/extend/mcp/supervisor.ts` | Live connection/process lifecycle |
| MCP capability catalog | Dirty-tree `src/extend/mcp/capabilities.ts` | Cached MCP tool definitions and closures |
| Retrieval provider tables | `src/retrieval/registry.ts` | Search and reader slot factories |
| Gateway provider registry | `STUDIO Gateway/src/providers/registry.ts` | Protocol/provider adapter selection |
| Desktop project state | `STUDIO/src/features/projects/ProjectsProvider.tsx` | In-memory demo state, not a durable registry |

## Context Engine And Memory

There is no implemented Context Engine. `src/context/context-optimizer.ts` defines `ContextOptimizer` and `PassthroughContextOptimizer`, but no production caller assembles registry data, connector state, memory, native tools, skills, or agent metadata through it. Flue/Pi construct the actual model context from the agent/session state and the sandbox's current tools.

The Harness request mapper maps Pi messages and tools to the intended Studio Gateway request shape. It does not filter irrelevant data, bind product project state, provide memory, or implement large-output artifact offload. ADR 0029's runtime tool membership is implemented, while the broader context assembly rules remain deferred.

Memory is absent. There is no project memory, user memory, vector store, retrieval index, memory lifecycle, or authenticated cloud-memory adapter.

## Sandbox, Trust, And Isolation

`LocalSandbox` is in-process containment. It resolves read/write paths under configured roots, withholds ambient environment, prevents workspace-root deletion, and exposes `allowExec`/`allowNetwork` switches. `WorkspaceTrustStore` persists per-folder trust. `PermissionKernel` evaluates trust before policy and grants. `ExecutionMode` is manual by default in `StudioRuntime`; there is no product settings source for the selected mode.

The real boundary is narrower than the architecture language sometimes suggests:

| Boundary | Real behavior |
| --- | --- |
| Native filesystem paths | Enforced by `LocalSandbox` path resolution |
| Native subprocess environment | Built from policy; `PATH` is blanked, with documented Windows caveats |
| User-connected MCP process | Runs outside the folder wall and is not OS-contained; explicit approval is the control |
| MCP remote network | Destination rules and permission approval apply; server behavior is external |
| Trust/mode | Kernel/policy enforced for calls that enter the gate |
| `workspace_summary` | Native read capability through CallGate and LocalSandbox |
| Remote OS/VM isolation | Not implemented |

ADR 0025 moved third-party consent into policy: elevated third-party capabilities are policy asks that Full Auto cannot silently resolve. This is an approval boundary, not hostile-code containment. The comments in `LocalSandbox` still contain older language saying connected execution is refused, while the current code permits it after the policy/approval path; this should be clarified by a decision/documentation update.

## Artifacts, Transcripts, Conversations, And Studio Data

Flue's conversation stream is the only current canonical transcript. It owns agent submissions, leases, runtime events, tool continuation, settlement, history, observation, and restart recovery. `FlueHarnessClient` exposes Flue snapshots/observations directly.

Project Studio has no product-owned conversation table, transcript projection, event journal, artifact envelope, attachment route, object storage, artifact lifecycle, or conversation-to-project binding. The desktop `ChatPart` union renders only text and reasoning. Flue has upstream attachment/file-part primitives, but the Harness client accepts text only and the desktop does not consume them.

The desktop project model contains project names, folders, chats, notes, tasks, and display-only files in React state. `projectKey()` is a workspace-path hash used for permissions/snapshots, not a persisted product project identity. Phase 14 and Phase 18 must define ownership and projections rather than treating Flue history as a product project database.

## Gateway And API

The Gateway Worker exposes:

- `GET /ready` and system health routes.
- OpenAI-compatible `/v1/models`, `/v1/models/:id`, `/v1/chat/completions`, and `/v1/responses`.
- D1-backed `/admin` provider, credential, key, model, and discovery operations.
- A six-hour scheduled discovery handler.

The Harness exposes authenticated Flue agent routes plus current dirty-tree
`/api/mcp` and `/api/permissions` routes. There is no authenticated public
Gateway proxy, no WebSocket API, no desktop API, no artifact API, no project API,
and no worker-to-worker service binding in this repository.

The Gateway's intended bearer is `sk-gw_*`; the Harness Studio Cloud client sends a Studio session/access token. The Harness expects custom typed SSE events such as `stream.started`, `model.message.delta`, `model.tool_call.completed`, and `model.completed`; the Gateway adapters return OpenAI-compatible response/SSE formats. The current repository therefore does not establish a working Harness-to-current-Worker wire contract.

Gateway admission is now fail-closed outside explicit development/test mode;
admin discovery uses `requireAdmin`, and model listing/selection honors provider
and model enabled flags. The Worker/Harness bearer and SSE contracts remain
separate and unproven.

## Model And Inference Stack

| Layer | Dependency/code | Actual role |
| --- | --- | --- |
| Durable agent/runtime | `@flue/runtime`, `@flue/sdk`, `@flue/opentelemetry` | Agent loop, routes, persistence, continuation, instrumentation |
| Provider protocol | `@earendil-works/pi-ai` | Models, credentials, provider APIs, Pi event stream |
| Test model | `src/models/adapters/test-adapter.ts` | Deterministic in-process test provider |
| Local BYOK | `src/models/local/`, `local-adapter.ts` | Pi model collection plus keychain credentials; operational in Harness tests |
| Studio Cloud | `src/models/studio-cloud/`, `studio-cloud-adapter.ts` | Custom SSE adapter intended for a private Studio Gateway |
| Gateway Worker | Hono, raw D1, provider/adapters | Independent OpenAI-compatible cloud gateway |
| Desktop inference | None | UI does not invoke a model |

Streaming, tool-call parsing, reasoning, usage, cancellation, and continuation are implemented in the Harness adapter/tests for the custom Gateway event contract. The current Worker is a separate contract. Media provider entries in the Worker are catalog/adapter placeholders; `/v1` exposes no dedicated image/video/audio execution path, and Fal/ElevenLabs currently reuse chat behavior.

## Streaming And Thinking

Flue/Pi own the model loop and stream. The Harness Studio Cloud adapter parses SSE frames, deduplicates compatibility/canonical event pairs, maps reasoning/text/tool calls/usage/finish states to Pi, and ends a tool-call turn with `toolUse` so Flue continues it. The desktop demo simulates thinking and text with timers. The desktop only renders `text` and `reasoning`; dynamic tools, files, artifacts, and runtime events have no UI representation.

## Error Handling

The Harness has a shared `StudioError` contract and `ErrorReporter` that normalizes failures, records a safe span event/counter/log, and exposes a typed report. Most Harness subsystems use it. Known exceptions include raw errors in the local setup CLI (L-11), open process teardown issues, and loss of original JSON-RPC error metadata when ordinary MCP protocol errors become `ExtendError("internal")`.

The Gateway has a separate error model and still throws raw `Error` values in adapters/helpers. `/ready` can return raw database error text. Chat and responses duplicate credential/model/auth plumbing and have already diverged in missing-encryption-key handling.

MCP application-level `isError` results, structured content, untrusted labels,
approval cancellation, and recovery catalog invalidation are implemented and
tested. Pending approvals remain process-memory across restart.

## Observability

The Harness configures OpenTelemetry SDK/exporter modes, Flue instrumentation, GenAI content capture with redaction when explicitly enabled, structured JSON logs, trace/span correlation, safe errors, and error counters. Capture is off by default. No separate OpenTelemetry deployment or end-to-end user/session correlation is implemented.

Gateway logging is basic structured logging; `src/lib/telemetry.ts` is a no-op with no callers, request IDs are not populated, and there is no equivalent trace propagation from Harness to Gateway. The desktop has no product telemetry path.

## Authentication, Security, And Isolation

Implemented authentication includes outbound/product-login support and the local
Harness admission verifier: Google PKCE, keychain-backed access/refresh tokens,
per-launch bearer sessions, and Gateway bearer key verification. The local
client/session identity reaches `ExecutionScope`; `StudioUser.id` is not yet
account-bound to grants.

The following security boundaries are real:

- Keychain storage for provider, MCP, and session secrets.
- Migration guard against secret-looking database columns.
- No shell execution for native command vectors and explicit `shell: false`.
- Workspace path containment for native filesystem operations.
- Destination judging, DNS pinning, redirect re-judging, and own-port registration for direct Harness HTTP.
- PermissionKernel plus CallGate for gated native/MCP capabilities.
- Flue durable run identity and one-process ownership assumptions.

The following are conceptual, conditional, or missing:

- Explicit loopback listener/Host bootstrap for Harness admission.
- Account-backed user/project identity binding.
- OS containment for external MCP processes.
- Pending approval durability across restart.
- Desktop-to-Harness authentication and transport.

## Concurrency And Isolation

The Harness uses Flue's durable lease/recovery model, a process-wide application DB, single-flight extension reconciliation, one supervisor entry per launch key, per-gate FIFO bounds, and per-runtime in-memory catalogs. The current `StudioRuntime` is constructed for one project root/project id, although the generic extension spine accepts multiple project ids.

There is no durable account/user store or production desktop concurrency path.
The local admission boundary is one Host session; shared multi-user execution and
caller-supplied tenant identity are not supported. Pending approvals, catalog
state, supervisor state, and file observations are process-local.

## Dependency And Build Inventory

| Package | Direct dependencies | Use and issues |
| --- | --- | --- |
| Harness | Flue/Pi, Hono, Valibot, keyring, OTel API/core/exporters/SDK, TypeScript/Vitest/tsx | Imports show active use; no obvious unused runtime dependency confirmed. OTel versions span API 1.x, core/resources 2.x, SDK/exporter 0.x and should be compatibility-validated. |
| Gateway | Hono; Workers types, Wrangler, TypeScript, Oxlint, Vitest, Drizzle dev packages | Hono/Wrangler/raw D1 are active. Drizzle and `db:generate` have no source/config usage. Vitest has no test files. |
| Desktop | React 19, Vite 8, Tailwind 4, Tauri 2, UI/markdown/motion/icon dependencies | Demo UI uses the runtime packages; no test script. `components.json` says Lucide while code uses Phosphor. |

Each application has an independent lockfile. There is no workspace-level shared package. That is consistent with the explicit architecture boundary, not accidental duplication.

## Dead, Orphaned, And Duplicate Material

The following are confirmed orphaned or placeholder-only after repository-wide reference checks:

| Item | Classification | Evidence |
| --- | --- | --- |
| Gateway `gatewayAuth()` | Dead placeholder; dangerous if reused | `STUDIO Gateway/src/middleware/auth.ts`, no caller |
| Gateway `telemetry.ts` | No-op/unintegrated | No callers |
| Gateway `hashGatewayKey()` | Unused unsafe helper | Raw-key return in `src/lib/encryption.ts`; async hash is used |
| Gateway `providerDefinitions`/`getProviderDefinition()` | Unused duplicate registry | `src/providers/registry.ts`; provider inventory also lives in D1 migrations |
| Gateway `providers/anthropic/adapter.ts` and `providers/openai/adapter.ts` | Legacy/orphan duplicate adapters | Active registry uses `src/adapters/*` implementations |
| Gateway Drizzle packages/script | Legacy/config residue | No Drizzle import or config; raw D1 is active |
| Desktop brand barrel and `public/icons.svg` | Orphaned assets | No inbound imports; live icon path is elsewhere |
| Native registrar functions | Implemented and wired in dirty tree | `registerNativeTools()` is called by `StudioRuntime.createAgentSandbox()` |
| `PassthroughContextOptimizer` | Intentional unintegrated seam | Roadmap explicitly retains it for future context optimization |
| Desktop demo hooks/provider | Intentional transitional implementation | Files explicitly label demo behavior and are the current UI seam |

There is no duplicate MCP server implementation. The duplicate MCP-looking layers are protocol client code, management HTTP routes, and internal capability adapters, and they have different roles.

## Testing And Deployment

Harness coverage is broad across permissions, paths, process, snapshots, credentials, auth, model adapters, retrieval, observability, native tools, MCP wire/lifecycle/registry/supervisor/reconcile, and real generated-server integration. The current dirty tree reports 62 Harness test files, 1,077 passing tests, and 9 skipped tests; the Gateway has one auth test file with 4 passing tests.

Important missing coverage:

- Packaged Harness Host ownership and desktop readiness handoff. Headless listener/readiness is covered by `tests/integration/harness-listener.test.ts`.
- Desktop-to-Harness transport and product auth.
- Harness-to-current-Gateway Worker contract.
- Approval restart recovery and cross-store atomicity.
- Project/artifact/transcript projection ownership.
- Deployed Gateway Worker/D1 behavior and the current Worker/Harness wire contract.
- Desktop UI and Tauri end-to-end behavior.

Gateway typecheck can pass when dependencies are installed, but its Vitest command finds no test files. Desktop has no test script or test directory. Rust validation depends on unavailable Cargo/Rust tooling in the audit environment.

## Complete Runtime Flows

### No-Tool Request

`Flue route -> studio agent definition -> sandbox/model setup -> turn-boundary reconciliation -> Pi adapter -> model stream -> Flue event stream/settlement -> Flue SQLite -> client observation`.

### MCP Tool Request

`model -> injective mcp tool name -> retained catalog closure -> CallGate.parse/resource -> PermissionKernel.evaluate/authorize -> approval broker if needed -> LocalSandbox policy -> TurnSnapshots -> CallBounds -> McpConnection.request(tools/call) -> stdio/HTTP server -> normalized untrusted result -> Flue tool result -> model continuation`.

### Disable Request

`HTTP PUT selection -> extension generation increment -> next turn reconcile -> MCP supervisor stop/onStop -> catalog availability removal -> retained sandbox tool returns unavailable; a new sandbox omits it`.

### Native Tool Request

The production path is `agent -> native registrar -> CallGate -> native tool`.
`src/agents/studio.ts` exposes only the sandbox factory; no direct Flue tool is
registered there.

### Gateway Request

`Harness StudioCloud client -> custom expected `/v1/chat/completions` SSE -> current Worker bearer check/model lookup/decrypt/provider adapter -> OpenAI-compatible upstream`. The two sides disagree on bearer identity, request field names, model metadata, image shape, and stream event shape; this flow is not proven against the current Worker.

### Failed Or Cancelled Request

Flue and Pi have typed streaming/cancellation behavior. Native subprocess calls receive signals and bounds. MCP connection failure rejects pending requests and supervisor schedules retry. Approval waits now observe the tool/run signal; pending approvals are still process-memory across restart. MCP application errors retain structured content and `isError`.

## Capability Matrix

| Capability | Status | Implementation location | Runtime path | Evidence | Issues |
| --- | --- | --- | --- | --- | --- |
| Agent loop | Implemented | Flue runtime, `src/agents/studio.ts`, `src/transport/http/create-app.ts` | Authenticated Flue route -> continuing agent | Harness integration tests and admission tests | Listener/Host lifecycle remains incomplete |
| Planner | Designed only | None | None | No source caller | Phase 13/16 design only |
| Execution Runtime | Partial | `tools/gate.ts`, `bounds.ts`, `sandbox/`, snapshots | MCP calls and intended native calls | Unit tests, MCP integration | No separate worker/pool |
| Agent Runtime | Partial | `agents/studio.ts`, `application/studio-runtime.ts`, ADR 0030 | Flue composes Project Studio sandbox | Integration tests | Account-backed child authority is deferred |
| Sub-agents | Partial/upstream | Flue task surface | Framework task delegation | Upstream behavior inspected | Child authority/profile not implemented |
| Tool execution | Partial | `CallGate`, native registrars, MCP catalog | Native and MCP production dirty tree | Gate/MCP/native tests | External MCP OS containment remains deferred |
| Parallel tools | Unknown/Flue-owned | Flue/Pi | No Project Studio pool | Multiple-call adapter tests | No explicit policy/isolation |
| MCP | Partial-to-implemented core | `src/extend/mcp/`, dirty application files | Flue sandbox -> gate -> external MCP | Real stdio/Flue and P1/P2 tests | Listener/Host, OAuth/library/management-tool scope remain |
| Skills | Designed only | Generic `skill` kind only | None | No skill source | Phase 12 |
| Agent registry | Minimal | Flue `studio` agent | Flue name lookup | Agent definition | No Project Studio registry |
| Tool registry | Partial | Gate map and native registrars | Native/MCP gate | Gate and native tests | Discovery UI remains deferred |
| Connector registry | Missing | None | None | No Composio/imports | Mental-model-only |
| Context Engine | Designed only | `context/context-optimizer.ts` | No production caller | Unit seam only | No registry/memory assembly |
| Memory | Missing | None | None | No store | Phase 15 |
| Sandbox | Partial | `sandbox/local-sandbox.ts` | Native path/policy and MCP gate | Sandbox tests | In-process only; external MCP uncontained |
| Trust engine | Implemented library | `permissions/trust.ts`, policy | Gate authorization | Trust/mode tests | Mode selection not product-wired |
| Artifact system | Missing at product layer | Flue upstream only | None | No app route/store | Phase 14/18 |
| Transcript system | Implemented by Flue | Flue DB/client | Flue observation/history | Harness tests | No product projection |
| Studio Data | Partial configuration store | `storage/` | DB config/grants/MCP | Storage tests | Not conversations/artifacts/projects |
| Gateway | Partial independent worker | `STUDIO Gateway/src/` | External HTTP Worker | Source/typecheck | Auth and wire mismatch; no tests |
| Model inference | Implemented in Harness | Pi adapters/bootstrap | Flue -> Pi -> provider | Provider tests | Current Worker mismatch |
| Streaming | Implemented Harness-side | `studio-cloud/sse-parser`, mapper | Adapter -> Pi -> Flue | Integration tests | Desktop not connected |
| Thinking/reasoning | Implemented backend, demo UI | Event mapper, desktop reasoning block | Provider events -> Flue/Pi | Adapter tests | UI only supports demo shape |
| Tool-call parsing | Implemented per adapter | Request/event mappers, MCP JSON-RPC | Provider/MCP -> Flue | Tests | Gateway contract mismatch |
| Error handling | Partial | Harness errors/reporter; Gateway errors | Reports/logs/spans | Harness/Gateway tests | Raw Gateway helper errors; Worker contract gaps |
| Logging | Implemented Harness; basic Gateway | `observability/logger.ts`, Gateway logger | stdout/stderr or Worker logs | Observability tests | No end-to-end request IDs |
| OpenTelemetry | Implemented foundation | `observability/` | Flue instrumentation and errors | OTel tests | Gateway telemetry no-op |
| Authentication | Partial | Harness admission/auth client/keychain; Gateway auth | Local admission and outbound/provider auth | Auth/admission tests | Packaged listener/desktop handoff pending |
| User isolation | Local-session only | `ExecutionScope`, ADR 0030 | One Host client/session | Scope/kernel tests | Account-backed multi-user mode deferred |
| Session isolation | Partial | Flue thread IDs, grants, client/session scope | Per-agent/conversation/local-session grants | Permission tests | Approval state remains process-memory |
| Persistence | Partial | Flue DB, Studio DB, keychain, snapshots | Separate ownership boundaries | Storage/recovery tests | No product project/artifact data |
| Testing | Harness strong; other apps weak | Harness tests; no Gateway/UI tests | CI absent | Test inventory | Important cross-boundary paths untested |
| Deployment | Partial | Wrangler/Tauri configs | Independent Worker/desktop/Harness | Config inspection | No CI/public API/container; Rust unavailable |

## Project Map

| Component | Purpose/owner | Consumers | Environment | Persistence | Public/internal | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Flue runtime | Loop, durability, continuation, canonical stream; upstream owner | `src/app.ts`, agent definition | Node generated server | `flue.db` | Internal runtime + local HTTP | Working backend dependency |
| Pi AI | Provider/model protocols; upstream owner | Harness adapters and local runtime | Node | Keychain through bridge | Internal | Working dependency |
| `StudioRuntime` | Compose MCP, policy, sandbox, snapshots, DB | App bootstrap and agent | Harness process | Studio DB plus memory | Internal | Dirty-tree production composition |
| `PermissionKernel` | Decide authorization | CallGate | Harness process | Grants/trust in Studio DB | Internal | Working foundation |
| `CallGate` | Single execution door | MCP and native paths | Harness process | Snapshot side effects | Internal | Working; external MCP OS containment remains |
| `McpServerRegistry` | Installed MCP configuration | Management/reconcile | Harness process | `mcp_server` | Internal HTTP control surface | Working |
| `McpSupervisor` | Live MCP lifecycle | Reconciler/catalog | Harness process | None | Internal | Working with catalog callbacks/retry recovery |
| `McpCapabilityCatalog` | MCP definitions to gated tools | StudioRuntime | Harness process | None | Internal | Dirty-tree implementation |
| Native tools | Filesystem/search/Git/shell/web | `registerNativeTools()` -> CallGate | Harness process/child processes | Project files, snapshots | Internal model surface | Wired in dirty tree; local/manual posture |
| Retrieval service | Search/reader providers | Native web registrars | Harness process + external HTTP | Provider settings/keychain | Internal | Library implemented |
| Auth/session | Google login and Studio token refresh | Bootstrap/CLI | Harness process | Keychain | Outbound auth | Working library |
| Observability | Logs, OTel, redaction, reports | App and subsystems | Harness process | Exporter-dependent | Internal/optional external | Foundation working |
| Studio Gateway | Provider proxy/discovery | External clients, intended Harness | Cloudflare Worker | D1/secrets | Public/admin routes as configured | Independent and security-incomplete |
| STUDIO desktop | UI and Tauri shell | User | React WebView/Rust | React memory only | User-facing | Demo-only |
| Project Studio auth worker | Public API/session authority | Intended desktop/Harness/Gateway | Not present | Not present | Intended public | Designed/absent |

## Architectural Decisions Currently In Force

| ADR | Current classification |
| --- | --- |
| 0001 | Harness boundaries and Flue/Pi ownership enforced; current business-route addition needs amendment |
| 0002 | Two-gateway model intended, but public proxy is absent and current Worker contract is separate |
| 0003 | Context optimizer seam retained; production optimization deferred |
| 0004 | Observability foundation enforced; `app.ts` no-business-route clause contradicted by dirty tree |
| 0005 | Provider composition retained; local/cloud availability text superseded by ADRs 0006/0009 |
| 0006 | Studio Cloud Harness adapter implemented; current Worker compatibility not proven |
| 0007 | Keychain-only secret storage enforced in Harness |
| 0008 | Harness-owned PKCE/session refresh implemented; account identity remains outside local execution scope |
| 0009 | Local BYOK implemented in Harness |
| 0010 | Separate application SQLite and Flue SQLite implemented |
| 0011 | Harness shared error contract implemented with CLI/raw-error gaps |
| 0012 | Permission/containment foundation implemented; remote isolation deferred; amended by 0018/0019/0025 |
| 0013 | Explicit process substrate implemented with P-05/P-06 and managed-binary verification limits |
| 0014 | Installation, `~/.studio`, and project ownership paths implemented |
| 0015 | Approval scope ladder implemented |
| 0016 | Shadow Git undo implemented with accepted ignored-build/user-Git limits |
| 0017 | Bounds, cancellation, FIFO, and unknown-outcome handling implemented; non-cooperative JS remains accepted |
| 0018 | Trust/modes implemented in kernel; selected mode and product posture not fully wired |
| 0019 | Native chosen-program rules and shell exposure implemented; per-call Git network effects remain a known policy limit |
| 0020 | Single effect table implemented; K-04 remains open |
| 0021 | Project-scoped grants implemented |
| 0022 | Network destination/untrusted-content rule implemented for native web and MCP results |
| 0023 | Retrieval provider slots and native web registration implemented |
| 0024 | Capability switches and withheld-list reporting implemented in dirty tree |
| 0025 | `author` replaces overloaded `trusted`; third-party elevated calls require policy approval |
| 0026 | Redirect author, credential stripping, and DNS pinning implemented |
| 0027 | Streamable HTTP transport failure semantics implemented |
| 0028 | Harness client admission/local access boundary; 006.1-006.3 implemented, listener/Host/desktop pending |
| 0029 | MCP session tool membership is append-only; retained unavailable tools and boundary refresh |
| 0030 | Local client/session execution identity; account-backed multi-user scope deferred |
| 0031 | Harness custom Gateway and current Worker contracts are separate; cross-project integration deferred |

## Known Limitations And Deferred Capabilities

The following are intentionally not claimed as implemented: skills, connectors/Composio, planner, Project Studio subagent profiles, remote OS/VM sandbox, memory, RAG, product project/artifact model, product transcript projections, public API/auth worker, desktop transport, workflows, schedules, evals, bundled MCP library, MCP OAuth, MCP resources/prompts/server routes, and Gateway media execution.

The following are valid limitations but are not harmless production gaps: local control-plane listener/Host lifecycle, current Worker/Harness contract mismatch, pending approval restart behavior, user/account ownership, and remote OS containment.

## Authoritative Snapshot

### Baseline Architecture

As of this audit, the authoritative implemented architecture is: Flue owns durable agent execution and canonical conversation; Pi owns provider protocol behavior; Project Studio owns policy, permissions, credentials, native/MCP tool composition, application configuration, snapshots, and observability; external MCP servers are user-installed capabilities entered through the single CallGate; the desktop is a separate future client; the Gateway is an independent Worker until a compatible public-proxy contract is restored.

### Baseline Implementation

The Harness foundation, provider/auth/keychain/storage/permission/snapshot/observability libraries, native tool libraries, MCP client stack, and dirty-tree MCP/native runtime composition exist. Native and MCP capabilities are exposed through the production sandbox factory and share the CallGate. Flue remains the only canonical conversation system.

### Known Limitations

No packaged Host lifecycle or desktop connection, no account-backed product boundary, no product project/artifact/memory model, no remote isolation, and no complete Phase 11 OAuth/library/management-tool surface. The standalone/headless loopback/readiness path is implemented.

### Active Decisions

ADR 0001-0031 remain the decision record set, with later ADRs amending earlier ones. ADR 0028-0031 define the local admission, append-only membership, local execution identity, and explicit Gateway contract boundary.

### Invalidated Or Superseded Text

Older local-BYOK-unavailable statements in ADRs 0005/0006 and README/roadmap snapshots are superseded by ADR 0009 and current local provider code. Phase 11 zero-caller statements, the Harness no-custom-API statement, Phase 10 tool counts, and the absent-local-provider statements are stale for the current dirty tree.

### Safe Next-Phase Assumptions

The next phase may safely assume that Flue is the loop/transcript owner, Studio DB is separate from Flue DB, keychain is the secret store, CallGate is the single execution door, MCP/native tools can be driven through authenticated local Harness routes in the dirty tree, append-only membership is decided, headless loopback/readiness is tested, and supervisor/catalog recovery is tested. It may not assume packaged Host ownership, account-backed user scope, desktop transport, product project/artifact persistence, remote OS containment, or a compatible Gateway wire contract.
