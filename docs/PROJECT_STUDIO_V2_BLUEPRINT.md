# Project Studio V2: Complete Project Blueprint And Handoff

Last reconciled: 2026-07-25

This document is the durable project brain for Project Studio V2. It is intended to give a new
engineering conversation enough context to continue without reconstructing the project from chat
history.

It distinguishes:

- what exists and has been verified;
- what is present elsewhere in the repository as reference or legacy code;
- what has been decided but not implemented;
- what remains a candidate rather than a commitment;
- mistakes already encountered and the rules derived from them.

When this document conflicts with checked-in ADRs or current code, inspect the code and update this
document. Do not silently build from an outdated assumption.

## 1. Product Vision

Project Studio is intended to be a local-first, extensible agent product with one integrated UI.
Users should eventually be able to:

- hold durable, streaming conversations with a main agent;
- use the centrally operated Studio model gateway by default;
- explicitly switch to user-owned provider credentials and local models;
- see text, reasoning summaries when providers expose them, tool activity, results, errors, and
  run state in the Studio UI;
- connect local and authenticated cloud MCP servers;
- use native tools, skills, subagents, tasks, workflows, schedules, sandboxes, projects, memory,
  files, generated media, and connectors;
- inspect telemetry, logs, traces, metrics, failures, architecture, and runtime state inside Studio
  rather than depending permanently on external dashboards;
- run locally first and later deploy selected cloud services without being locked to a proprietary
  agent SDK, state service, database, or hosting platform.

The current effort is not a rewrite of the existing frontend. It is the construction of a clean
backend harness and runtime foundation that the existing Studio application can consume later.

## 2. Non-Negotiable Principles

1. TypeScript is the primary implementation language. Python is not part of the core harness.
2. Do not rebuild the agent loop from a handwritten `while` loop.
3. Do not depend on OpenAI's agent SDK, Anthropic's agent SDK, Cloudflare Agents SDK state,
   Vercel-hosted durability, or another proprietary orchestration runtime.
4. Open-source provider protocol libraries are acceptable when they do not impose hosted
   infrastructure. The Vercel AI SDK inside Studio Gateway is acceptable under this rule.
5. Flue owns the durable continuing-agent loop. Pi owns model protocol normalization beneath Flue.
6. Project Studio owns product policy: authorization, permissions, model-source selection, tools,
   MCP, skills, subagents, sandboxes, memory, UI projections, and observability composition.
7. Flue's canonical transcript and accepted-submission journal must not be duplicated.
8. Credentials and tenant authority must never be model-visible or model-selected.
9. Local and Studio-cloud model access remain separate implementations and separate catalogs.
10. No silent fallback between Studio-paid model access and user-paid BYOK access.
11. Add boundaries when a real responsibility exists. Do not pre-create empty directories or
    speculative abstractions.
12. Complete, review, test, and commit one phase before delegating the next.
13. OpenCode is a read-only behavioral reference, not Project Studio's harness architecture.

## 3. Runtime Ownership

### Flue

Flue is the harness runtime. It owns:

- continuing agent execution;
- canonical conversation events and transcript;
- accepted asynchronous submissions;
- durable submission identifiers and stream offsets;
- tool-call continuation;
- cancellation;
- recovery coordination after process restart;
- generated Node routing used by `@flue/sdk`.

The main conversation uses direct continuing-agent submissions, not programmatic Flue workflows.
On Node, accepted agent submissions can be recovered after restart. Interrupted programmatic
workflow functions do not currently provide the same resumption semantics.

### Pi

Pi is consumed through Flue and owns the model protocol layer:

- normalized model definitions;
- streaming text;
- provider-exposed thinking/reasoning blocks;
- tool-call and tool-result message shapes;
- usage and finish reasons;
- cancellation signals;
- provider-specific request and response protocols;
- built-in and custom model providers.

Project Studio does not run a second Pi agent loop beside Flue.

### Project Studio

Project Studio owns:

- agent definitions and product instructions;
- model-source composition and provider adapters;
- local BYOK policy and secure credentials;
- application authentication and admission;
- capability and permission policy;
- native tools and MCP;
- skills, subagents, projects, workspaces, and sandboxes;
- memory and context optimization;
- workflows, schedules, and evals;
- product event projections and frontend APIs;
- telemetry configuration, logs, redaction, and safe errors.

## 4. Current End-To-End Shape

```text
Existing React/Tauri Studio UI (integration deferred)
                    |
                    v
Future product API and admission boundary
                    |
                    v
Project Studio V2 Harness
  Hono application composition
  Flue continuing-agent runtime
  Pi model protocol
  SQLite canonical local persistence
                    |
        +-----------+------------+
        |                        |
        v                        v
Deterministic test source   Studio-cloud source
in process, network-free    custom Pi protocol adapter
                             |
                             v
                  Public API proxy, future contract
                             |
                    Cloudflare service binding
                             |
                             v
                  Private Studio Gateway Worker
                  Vercel AI SDK internally
                  Cloudflare AI Gateway routing
                  centrally managed provider keys

Future:
Local BYOK source -> Pi provider collection -> provider APIs / Ollama / LM Studio
```

## 5. Current Project Status

### Completed and committed

- Phases 1-4: harness foundation.
- Phase 5: observability foundation.
- Phase 6: model-provider bootstrap and composition.
- Phase 7 plus its 7.1 correction: Studio Gateway integration, committed as `8898458` after both
  suites were re-run green.

### Next

- Phase 7.5: architecture and modularity review.

Phase 7.5 is not a feature-expansion phase. It should audit the real code after the first external
model transport and correct structural pressure before secure credentials and local BYOK increase
the surface area.

## 6. What The Harness Can Do Today

| Capability | Current status |
| --- | --- |
| Continuing main agent loop | Implemented through Flue |
| Multi-turn conversation continuity | Implemented |
| Text streaming | Implemented |
| SQLite canonical persistence | Implemented |
| Accepted asynchronous runs | Implemented |
| Cancellation | Implemented |
| Restart recovery | Implemented |
| Typed tool calling | Implemented |
| Tool result returned to model | Implemented |
| Model continuation after a tool result | Implemented |
| Multiple tool calls represented | Implemented and tested through Studio adapter |
| Parallel tool execution policy | Not implemented; belongs to permission/execution kernel |
| Provider-exposed thinking events | Pi and Studio adapter support them |
| Product UI thinking projection | Not implemented |
| Product UI tool progress/results | Not implemented as stable Project Studio projections |
| Deterministic offline provider | Implemented |
| Studio Gateway model source | Implemented in current uncommitted Phase 7 tree |
| Full Studio catalog lifecycle | Callable adapter service; no production refresh lifecycle yet |
| Local BYOK providers | Not implemented |
| Secure OS credential vault | Not implemented |
| Native production tool set | Not implemented |
| Permission/approval kernel | Not implemented |
| MCP | Not implemented |
| Skills/subagents/workflows/schedules/evals | Not implemented in V2 |

## 7. Project Studio V2 Structure

Current authoritative harness root:

```text
Project Studio V2/
  src/
    agents/
      studio.ts
    application/
      harness-client.ts
    context/
      context-optimizer.ts
    contracts/
      events.ts
      models.ts
    models/
      adapters/
        test-adapter.ts
        studio-cloud-adapter.ts
      studio-cloud/
        auth.ts
        catalog.ts
        client.ts
        config.ts
        errors.ts
        event-mapper.ts
        request-mapper.ts
        sse-parser.ts
      bootstrap.ts
      model-registry.ts
      provider-config.ts
    observability/
      config.ts
      errors.ts
      flue.ts
      index.ts
      logger.ts
      redaction.ts
      sdk.ts
    tools/
      workspace-summary.ts
    app.ts
    db.ts
  tests/
    integration/
      harness.test.ts
      observability.test.ts
      studio-gateway.test.ts
      studio-flue.test.ts
    unit/
      architecture.test.ts
      model-providers.test.ts
      observability.test.ts
  docs/
    ROADMAP.md
    decisions/
      0001-harness-boundaries.md
      0002-two-gateway-model.md
      0003-context-optimization.md
      0004-observability.md
      0005-model-provider-composition.md
      0006-studio-gateway-integration.md
```

Important ownership rules:

- `agents/` defines agent behavior but does not import concrete providers.
- `application/` exposes UI-facing harness operations without owning Flue internals.
- `contracts/` contains product-owned stable types.
- `models/` composes sources and protocol adapters.
- provider-specific configuration, transport, catalog, mapping, and errors stay in provider
  subfolders instead of accumulating in one adapter file.
- `observability/` owns telemetry composition, not model or tool behavior.
- future execution policy must not be embedded in `studio.ts`.
- future native and MCP tools must share one permission/execution policy but retain distinct
  transports and provenance.

## 8. Main Agent Definition

The first agent is `studio`.

- It is discovered and hosted by Flue.
- It references only the stable model alias `project-studio/default`.
- It does not know whether the active source is deterministic, Studio cloud, or future local BYOK.
- It currently has one deterministic `workspace_summary` tool used to prove tool continuation.
- It configures durability attempts and timeout through Flue.

The agent definition must remain free of:

- provider SDK imports;
- gateway URLs;
- API keys or bearer tokens;
- Cloudflare headers;
- model-source switching logic;
- tool execution policy;
- MCP connection logic.

## 9. Persistence And Durability

### Local

- Flue's file-backed SQLite adapter is canonical.
- Default path: `./data/flue.db`.
- Override: `PROJECT_STUDIO_DB_PATH`.
- The UI/application must retain `threadId`, `submissionId`, `streamUrl`, and `offset` for accepted
  work.
- A recovered deployment may need to rebase the stream URL origin while preserving its path.
- Only one live Node process may own a particular agent instance.
- Completed tool results are reused during conservative recovery.
- A tool with an unknown outcome is not blindly repeated.

### Cloud, later

- D1 is the expected Cloudflare SQL store where a cloud service requires relational persistence.
- R2 remains appropriate for uploads and generated artifacts.
- KV is appropriate for caches, release metadata, and short-lived lookup state, not canonical
  relational records.
- Durable Objects are not a required foundation for the local harness. Existing older cloud
  services may use them, but V2 must not become dependent on them merely to preserve agent state.

### ORM/query layer

- V2 currently does not use Drizzle.
- Drizzle is a reasonable candidate for Project Studio-owned SQLite/D1 tables when those tables
  appear.
- Do not wrap Flue's internal SQLite schema with a second ORM.

## 10. Model Sources And Gateways

### Stable identity

The agent always uses:

```text
project-studio/default
```

The selected source resolves that alias. Source-specific IDs do not leak into the agent
definition.

### Current process-level sources

| Source | State |
| --- | --- |
| `test` | Operational, default, deterministic and network-free |
| `studio-cloud` | Operational in current Phase 7 working tree |
| `local` | Recognized but deliberately fails at startup |

Source selection is currently process-level through `PROJECT_STUDIO_MODEL_SOURCE`. It is not yet
an account preference or per-run switch. Earlier code attempted to introduce account-level
gateway modes and immutable per-run snapshots, but no production admission path used them. That
dead abstraction was removed in Phase 7.1.

No source may silently substitute another source. This prevents accidental changes in:

- who pays for the request;
- which provider sees the data;
- which credentials authorize the request;
- which catalog and capability claims apply.

### Studio Gateway

The active cloud gateway lives at:

```text
Backend/Cloud/gateways/gateway/
```

It currently has 15 provider adapters and 109 curated models. It supports normalized operations
for chat plus selected embeddings, speech, transcription, image, and video capabilities.

Current gateway providers:

1. OpenAI
2. Google
3. Anthropic
4. Groq
5. xAI
6. DeepSeek
7. Mistral
8. Fal
9. Replicate
10. ElevenLabs
11. OpenRouter
12. Alibaba
13. MiniMax
14. Z.AI
15. Xiaomi

It uses:

- Cloudflare Workers;
- Hono;
- Vercel AI SDK core and provider packages;
- Cloudflare AI Gateway for upstream routing and centrally managed provider credentials;
- a curated static model catalog;
- normalized gateway errors;
- custom SSE events for text, reasoning, tool calls, usage, completion, and errors.

Using Vercel AI SDK here is acceptable. It is an internal open-source protocol/provider adapter,
not a dependency on Vercel hosting, Vercel Gateway, Vercel Workflows, or proprietary durability.
Rewriting the working gateway to Pi would add risk without improving the HTTP service boundary.

The harness does not consume Vercel AI SDK types. It uses a native Pi protocol adapter for the
gateway's custom SSE contract.

### Studio Gateway trust boundary

The intended deployment is:

```text
Client -> api.example.com/gateway -> private Studio Gateway service binding
```

- The public API verifies the user's Project Studio token.
- Studio Gateway has no public `workers.dev` subdomain and no custom public route.
- Studio Gateway does not independently implement Google login or end-user JWT verification.
- Trusted identity propagation from API to private gateway remains to be designed with the API
  proxy contract.
- Arbitrary public identity headers must never become trusted identity.

The first Phase 7 delegation incorrectly added JWT middleware directly to Studio Gateway. Phase
7.1 removed that approach.

### Studio Gateway Pi adapter

The gateway emits SSE, but its event payloads are Project Studio events rather than OpenAI
`choices[].delta` chunks. The adapter translates:

```text
model.message.delta       -> Pi text events
model.reasoning.delta     -> Pi thinking events
model.tool_call.completed -> Pi tool-call completion
model.usage               -> Pi usage
model.completed           -> Pi final finish reason
stream.error              -> safe Pi error
stream.completed/[DONE]   -> Pi settlement
```

SSE is the default transport for ordinary chat because it is simple, observable, cancellation
friendly, and supported well through Cloudflare. WebSocket remains a future option for realtime
voice, continuous multimodal input, or another genuinely bidirectional session. It is not needed
for normal agent chat and tool continuation.

### Local BYOK runtime

Local BYOK is not a local HTTP proxy by definition. It is a local provider runtime that bypasses
Studio Gateway and uses the user's provider account.

The recommended implementation is Pi's provider system, not a transplant of OpenCode's Vercel AI
SDK provider registry. Pi already supports many providers, mixed protocols, OAuth, dynamic model
lists, OpenAI-compatible endpoints, Ollama, LM Studio, and an injectable credential-store
contract.

Expected path:

```text
LocalModelProviderAdapter
  -> Pi Models/provider collection
  -> secure Project Studio CredentialStore
  -> OpenAI / Anthropic / Google / OpenRouter / Bedrock / Groq / others
  -> Ollama / LM Studio / vLLM / custom OpenAI-compatible endpoints
```

Local and Studio catalogs remain separate. The UI may present a unified view, but the underlying
ownership and credentials do not merge.

## 11. Secure Credential Plan

BYOK keys must not be stored in plaintext JSON, SQLite, environment files, logs, telemetry,
events, snapshots, prompts, or persisted conversations.

Implement Pi's small credential-store contract behind an application abstraction:

```text
SecureCredentialStore
  Windows -> Windows Credential Manager
  macOS   -> Keychain
  Linux   -> Secret Service/libsecret
  tests   -> in-memory implementation
```

`@napi-rs/keyring` is the current leading implementation candidate. It must be validated for
supported platforms, packaging, Tauri/Node distribution, and failure behavior before adoption.
Archived `keytar` should not be selected as the default.

SQLite may store non-secret metadata:

- provider ID;
- credential type;
- display label;
- keychain entry identifier;
- creation/update time;
- connection status.

The Studio access token is conceptually different from BYOK provider keys. In production it should
come from the authenticated application session and refresh path. The current
`PROJECT_STUDIO_GATEWAY_TOKEN` is development-only bootstrap configuration.

## 12. Tool Calling And Future Execution Kernel

Flue currently executes tools and returns results to the model. The deterministic and Studio
integration tests prove continuation.

The future execution kernel must define:

- capability identity and provenance;
- application-trusted scope;
- permissions and user approval;
- read-only versus mutating behavior;
- cancellation and timeout;
- concurrency and parallel tool policy;
- idempotency keys;
- unknown-outcome handling;
- safe result and error serialization;
- audit and telemetry attributes.

Parallel tool calls must not be enabled merely because a model emits multiple calls. The policy
must decide whether calls are:

- safely parallel;
- sequential because of dependencies;
- blocked pending approval;
- incompatible because they mutate the same resource.

Native tools and MCP tools should reuse this policy. They should not share one transport
implementation or lose provenance.

Prompt/tool ordering should preserve a cache-friendly stable prefix:

1. stable system/developer instructions;
2. stable, deterministically ordered tool definitions;
3. stable skill/context instructions;
4. conversation history;
5. latest user message;
6. tool calls and their matched results;
7. model continuation.

Provider adapters own exact wire serialization. MCP discovery must eventually produce stable,
deterministically ordered registry snapshots so frequently changing tool lists do not destroy
prompt-cache reuse.

## 13. Context, Memory, And Headroom

The canonical Flue transcript is never overwritten by optimized context.

`ContextOptimizer` currently uses a passthrough implementation. Headroom was researched and is
reserved as an optional future sidecar:

- it is not installed;
- it is not the harness;
- its TypeScript package communicates with a separate Python/Rust proxy;
- it must remain optional and fail open;
- compression must be reversible;
- system instructions, recent turns, and incomplete tool-call/result pairs must be preserved.

Future memory has two distinct concerns:

- local project/user memory and context assembly;
- an authenticated cloud memory MCP server for centralized memory.

Memory must not become a replacement transcript.

## 14. Observability And Errors

### Implemented

- Official OpenTelemetry Node SDK.
- `@flue/opentelemetry` registered once after SDK initialization.
- Flue GenAI agent/model/tool span projection.
- `none`, `memory`, and OTLP exporter modes.
- traces and metrics.
- structured JSON application logging.
- active `trace_id` and `span_id` correlation.
- safe error normalization and serialization.
- content capture off by default.
- explicit opt-in content capture with redaction.
- stable resource fields:
  - `service.name`;
  - `service.version`;
  - `deployment.environment`.
- exporter shutdown and flush hooks.

### Local observability stack planned

The vendor-neutral local stack is:

- OpenTelemetry Collector for receiving and routing telemetry;
- Grafana for dashboards;
- Tempo for traces;
- Loki for logs;
- Prometheus for initial metrics;
- Mimir only if longer retention or larger scale justifies it.

The first external dashboards are operational tools, not permanent product UI. Studio should later
query its own telemetry/read-model APIs and present the useful views inside the application.

### Logging clarification

V2 currently uses a small application-owned structured logger, not Pino or "Pino Plus". Pino may
be evaluated later if log transport, performance, or ecosystem requirements justify replacing the
small logger. Do not list Pino as an installed dependency today.

### Error policy

- Errors are categorized and safe by default.
- Stacks, environment values, credentials, prompt bodies, and tool arguments are omitted by
  default.
- Unknown values, arbitrary strings, and `bigint` values must serialize safely.
- Gateway errors use status plus known normalized codes, never raw provider response bodies.
- A future error reporter may aggregate failures for the product UI, but it should consume the
  same error taxonomy rather than create a second one.

## 15. Validation And Data Contracts

- V2 currently uses Valibot.
- The cloud gateway uses TypeScript contracts and its existing validation approach.
- Zod was discussed as a possible general validation library but is not the V2 choice today.
- Do not add both Zod and Valibot without a concrete interoperability reason.
- Structured provider/model/catalog data must be parsed with schemas or structured APIs, not
  ad-hoc string manipulation.

Model capabilities explicitly distinguish:

- `supported`;
- `unsupported`;
- `unknown`.

Unknown numeric limits are `"unknown"`, not zero.

Current modeled dimensions include:

- text generation;
- streaming;
- reasoning;
- tool calling;
- vision;
- embeddings;
- reranking;
- image generation;
- video generation;
- speech generation;
- transcription;
- context window;
- maximum output tokens.

## 16. MCP, Skills, Subagents, Sandboxes, Workflows, And Evals

### MCP

Planned:

- official Model Context Protocol TypeScript SDK;
- local stdio/process transports where appropriate;
- authenticated cloud HTTP MCP;
- registry, health, reconnect, collision handling, and teardown;
- cloud endpoints such as web/media and centralized memory;
- common permission/execution policy shared with native tools.

MCP servers do not grant permission merely by being connected.

### Skills

Skills are reusable instructions and resources. They:

- may be application-owned or workspace-discovered;
- require validation and catalog metadata;
- can be assigned to agents;
- do not grant executable authority.

### Subagents and tasks

- specialized profiles;
- explicit delegation policy;
- parent-owned durability;
- restricted tools, skills, and context;
- bounded task definitions and results.

### Sandboxes

- workspace and artifact ownership;
- filesystem/process/network policy;
- explicit lifecycle;
- local and cloud adapters where needed;
- separate conversation durability from workspace durability.

### Workflows and schedules

- Flue continuing-agent submissions remain the main chat mechanism.
- Workflows are for finite, application-controlled jobs.
- Scheduling needs admission, idempotency, retries, inspection, and cancellation.
- Local candidates include `node-cron` for simple triggers or a lightweight scheduler over a
  database-backed jobs table.
- The database-backed job table is preferred before introducing a separate queue product.
- No scheduler library is committed yet.

### Evals

Evals are repeatable tests of agent behavior, not ordinary unit tests alone.

Planned:

- deterministic regression runner;
- model selection tests;
- permission and tool-policy tests;
- MCP behavior;
- cancellation and recovery;
- context construction;
- prompt/tool-call quality;
- end-to-end task outcomes.

Start with an application-owned runner and portable result format. Braintrust or LangSmith-style
export may be added later if useful. No paid eval platform is required, and "BrainDraft" is not a
current dependency.

## 17. Authentication And Payments

Project Studio already has an application-owned authentication service:

- Google OAuth login;
- Project Studio access and refresh JWTs;
- API-token support;
- user records and whitelist behavior;
- public API validation.

V2 must integrate with this existing identity system rather than adopt Clerk, Supabase Auth, or a
provider-specific agent authentication service.

The public API owns browser/client authentication. Internal workers are reached through service
bindings and receive only trusted context established by the API contract.

Payments are not part of the current harness roadmap. Stripe is not required now. Billing,
credits, quotas, or subscriptions should be designed only when product requirements are concrete.
The old gateway credit functionality was intentionally removed.

## 18. Repository And Service Inventory

The Git root is:

```text
C:\pookiepied\Project Studio
```

`Project Studio V2` is part of the root repository, not a nested Git repository.

### Active product and entry projects

| Path | Role | Relationship to V2 |
| --- | --- | --- |
| `Project Studio V2/` | New local-first harness | Current authoritative runtime work |
| `STUDIO/` | Existing React 19, Vite, Tauri desktop/web UI | Future consumer of V2 contracts |
| `api/` | Public Cloudflare Worker API gateway, Hono | Future auth/proxy boundary |
| `auth/` | Google OAuth and JWT worker | Existing identity system |
| `Backend/Cloud/gateways/gateway/` | Active Studio model gateway | Integrated by Phase 7 adapter |
| `Backend/shared/packages/jwt/` | Shared JWT package | Used by public API/auth, not private gateway auth |

### Existing Studio frontend

`STUDIO/` is not being rebuilt in this phase. It already contains:

- React 19;
- Vite;
- Tauri 2;
- TypeScript;
- Monaco editor;
- xterm;
- Markdown, syntax highlighting, Mermaid, KaTeX, PDF rendering;
- charts and 3D visualization;
- feature, runtime, run-event, design, core, and UI modules.

Eventually it should consume stable product projections for:

- conversations and streaming runs;
- text and provider-exposed reasoning;
- tool calls, approvals, progress, and results;
- models and gateway mode;
- agents, skills, MCP, projects, files, sandboxes, schedules, and evals;
- logs, traces, metrics, and errors;
- administrative and architecture views.

### Existing Studio daemon

`STUDIO/daemon/` is an older Express-based local bridge for Ollama and LM Studio. It is reference
and potential migration input, not automatically the V2 local BYOK architecture. The V2 decision
is to prefer Pi's provider runtime behind `LocalModelProviderAdapter`.

### Existing local MCP libraries

`STUDIO/library/mcp-servers/` contains earlier local MCP implementations and domain knowledge:

- `harness/studio-harness`: filesystem, search, Git, shell, REPL, and coding-project operations;
- `desktop/computer-use`: desktop automation, screenshots, UI control, input, and OS operations;
- `system/mcp-management`: MCP management;
- `system/skill-management`: skill management;
- `system/skill-execution`: skill execution.

These are audit/reference inputs for the future native-tool and MCP phases. They should not be
attached wholesale before the permission kernel exists. Some capabilities may become native
tools, some may remain MCP tools, and some may be removed as unnecessary duplication.

### Existing cloud workers

| Worker/folder | Intended ownership | Current relationship |
| --- | --- | --- |
| `data/` | Conversations, uploads, artifacts, object metadata | Cloud architecture/context |
| `context-engine/` | Context packages and internal snapshots | Cloud architecture/context |
| `tool-pool/` | Capability discovery and schema materialization | Behavioral reference |
| `tool-execution/` | Validate, route, execute, normalize selected calls | Behavioral reference |
| `registry/` | Registrations for agents, skills, MCP servers | Cloud library service |
| `skill-library/` | Full cloud skill definitions | Future cloud skill source |
| `mcp-library/` | Cloud MCP definitions and facades | Future cloud MCP source |
| `agent-library/` | Cloud agent definitions | Future cloud agent source |
| `connectors/` | Connected accounts and connector metadata | Must remain available |
| `tracker/` | Existing telemetry ingestion/querying | Old implementation/reference |
| `runtime/execution-runtime/` | Main cloud runtime scaffold | Not the V2 local Flue runtime |
| `runtime/planner-runtime/` | Planning runtime scaffold | Future behavior reference |
| `runtime/agent-runtime/` | Generic delegated-agent runtime scaffold | Future behavior reference |

These workers are not all part of the active V2 implementation path. They represent earlier cloud
architecture and domain knowledge. Reuse stable contracts and behavior selectively. Do not force
the V2 local harness to reproduce the old worker topology.

### Discord bot

`Discord Bot/` is a separate product integration. It is not part of the current harness
foundation. It may eventually consume stable Project Studio agent/application contracts, but it
must not drive the core runtime architecture.

### Documentation and research folders

- `docs/` contains repository-level architecture and this blueprint.
- `documentation/` contains prior rehabilitation/version research.
- `.claude/` contains assistant/project configuration and is not an application subsystem.
- `temp/` and `temp-v2/` contain temporary or upstream reference material.

### Legacy

`Backend/legacy (Will be removed)/chat/` contains the old cloud chat loop and Durable Object based
execution. It is context only and must not become the V2 harness.

### Reference checkouts

- `temp-v2/opencode/` is an OpenCode checkout used read-only.
- It was observed with pre-existing dirty files (`bun.lock` and `snow-war-poem.txt`); do not clean
  or modify them as part of V2.
- `temp/opencode/` is another reference checkout.

## 19. OpenCode Research And Inspiration

OpenCode is useful for studying:

- provider breadth and configuration UX;
- model discovery and `models.dev`;
- provider-specific compatibility behavior;
- native coding-tool selection;
- OAuth and provider connection flows;
- prompt and tool handling;
- session/event UX.

OpenCode's provider system should not be copied wholesale because it is coupled to:

- Vercel AI SDK model types;
- Effect services;
- OpenCode configuration;
- OpenCode plugins;
- OpenCode session transformations;
- its own HTTP and credential representations.

Its credential store uses a plaintext `auth.json` protected by filesystem permissions. Project
Studio requires native OS secret storage instead.

The correct reuse strategy is:

1. use Pi's provider runtime locally;
2. compare Pi coverage against OpenCode;
3. adapt missing provider quirks or tests selectively;
4. audit OpenCode's essential native coding tools before implementing Project Studio tools;
5. never import OpenCode's full runtime as the harness.

## 20. Technology Ledger

### Confirmed and active in V2

| Area | Choice |
| --- | --- |
| Language | TypeScript |
| Runtime | Node 22.19 or newer |
| Package manager | pnpm |
| Agent harness | Flue |
| Model protocol | Pi (`@earendil-works/pi-ai`) |
| HTTP composition | Hono |
| Local canonical database | SQLite through Flue |
| Validation | Valibot |
| Tests | Vitest |
| Telemetry | OpenTelemetry |
| Agent telemetry bridge | `@flue/opentelemetry` |
| Logs | Application-owned structured JSON logger |
| Errors | Central safe normalization/serialization |
| Cloud gateway | Cloudflare Worker + Hono + Vercel AI SDK + Cloudflare AI Gateway |
| Frontend | Existing React/Vite/Tauri Studio application |

### Decided direction, not implemented in V2

| Area | Direction |
| --- | --- |
| Local credentials | Native OS keychain through Pi CredentialStore |
| Local providers | Pi built-in/custom providers |
| Cloud relational storage | D1 |
| Product-owned local/cloud schema | Drizzle candidate, decide when first schema appears |
| Files/artifacts | R2 cloud, local project-owned storage locally |
| MCP | Official TypeScript SDK |
| Local telemetry UI | Grafana + Tempo + Loki + Prometheus, OTLP through Collector |
| Metrics scale-up | Mimir only if justified |
| Schedules | Simple trigger plus database-backed jobs first |
| Evals | Custom deterministic runner, optional external export |
| Context compression | Optional Headroom adapter |

### Not selected

- LangGraph as the main runtime;
- a new handwritten while-loop harness;
- Cloudflare Agents SDK as the local durability foundation;
- Vercel-hosted agent/durability products;
- OpenAI or Anthropic proprietary agent SDKs;
- Supabase as the database foundation;
- Clerk authentication;
- Stripe at this stage;
- plaintext BYOK storage;
- direct public access to Studio Gateway.

## 21. Implementation Phases

### Phases 1-4: Harness foundation, complete

- strict TypeScript workspace;
- Flue/Pi continuing agent;
- SQLite persistence;
- accepted runs and observation;
- history and continuity;
- cancellation;
- restart recovery;
- deterministic streaming provider;
- typed tool continuation;
- gateway-neutral model and context ports.

### Phase 5: Observability, complete

- OTel SDK lifecycle;
- Flue instrumentation;
- exporters;
- structured logging;
- safe errors;
- content redaction;
- shutdown behavior;
- telemetry tests and ADR.

### Phase 6: Provider composition, complete

- model-source configuration;
- stable alias;
- provider adapter contract;
- registry and bootstrap coordinator;
- complete capability representation;
- deterministic adapter behind contract;
- startup rejection for unavailable sources.

### Phase 7: Studio Gateway integration, implemented and awaiting final checkpoint

- operational `studio-cloud`;
- custom Pi wire protocol for Studio SSE;
- text/reasoning/tool/usage/error mapping;
- multiple tool calls;
- gateway tool-result continuation contract;
- cancellation;
- explicit default model;
- callable catalog loading;
- safe outbound access-token boundary;
- generated Flue server integration test.

### Phase 7.5: Architecture/modularity review, next

Audit:

- every file maps to one responsibility;
- adapter/config/transport/catalog/protocol/error boundaries;
- no dead abstractions;
- no accidental process-global state beyond required Flue/Pi registration;
- model runtime remains separate from agent definition;
- application contracts do not leak Flue or provider internals unnecessarily;
- future BYOK, permission, native tool, MCP, UI projection, and auth integrations have clear ports;
- large files are split only where responsibilities are genuinely mixed;
- no empty speculative trees.

### Phase 8: Product auth, secure credentials, and local BYOK

This roadmap item should likely be executed as reviewed subphases:

1. public API proxy and production Studio session token provider;
2. secure cross-platform credential vault;
3. Pi local provider collection and catalog;
4. `LocalModelProviderAdapter`;
5. settings-facing connect/disconnect/select contracts;
6. optional account preference and run metadata once a real admission path exists.

### Phase 9: Capability and permission kernel

Shared execution policy for native and MCP tools.

### Phase 10: Native tools

Audit Flue and OpenCode first. Implement only necessary primitives.

### Phase 11: MCP

Local and authenticated cloud transports, registry, health, provenance, reconnect, collision
handling, and common execution policy.

### Phase 12: Skills

Validated catalogs, discovery, instructions/resources, and agent assignment.

### Phase 13: Subagents and tasks

Profiles, delegation, parent durability, scoped capabilities and context.

### Phase 14: Projects, workspaces, and sandboxes

Artifact ownership, workspace lifecycle, sandbox policy, and local/cloud adapters.

### Phase 15: Memory and context

Project/user memory, cloud memory MCP, context construction, optional Headroom.

### Phase 16: Workflows and schedules

Finite application jobs, schedule admission, idempotency, retry, and inspection.

### Phase 17: Evals

Deterministic regressions plus end-to-end quality evaluation.

### Phase 18: Product integration

Connect the existing React/Tauri app to stable harness contracts and product read models.

The numbering may be refined after Phase 7.5, but the dependency order should remain:

```text
model transport
-> secure credentials/local providers
-> permission kernel
-> native tools
-> MCP
-> skills/subagents/projects/memory
-> workflows/schedules/evals
-> full product integration
```

## 22. Important Problems Already Encountered

### Problem 1: Confusing Flue and Pi

Early discussion treated them as competing choices.

Resolution:

- Flue is the durable harness/runtime.
- Pi is the model protocol layer used beneath Flue.
- Project Studio composes both rather than choosing one over the other.

### Problem 2: Recreating the engine

An early proposed direction resembled a custom TypeScript loop.

Resolution:

- do not repeat the previous handwritten-loop experiment;
- use Flue for the loop and durability;
- write Project Studio policy and adapters around it.

### Problem 3: Proprietary infrastructure coupling

Cloudflare Agents SDK and similar systems can bind durability to hosted primitives such as Durable
Objects.

Resolution:

- local-first Node and SQLite;
- vendor-neutral OTel;
- open protocols;
- cloud adapters later;
- no hosted service required to run the core locally.

### Problem 4: Observability delegation needed repair

The initial observability work passed tests but review found issues involving:

- sensitive-key redaction;
- arbitrary string redaction;
- `bigint` JSON safety;
- canonical logger metadata;
- exporter endpoint behavior;
- shutdown hooks and process behavior.

These were corrected before committing Phase 5.

### Problem 5: First Phase 6 provider composition was structurally wrong

The first implementation:

- allowed non-operational local/cloud sources to pass startup;
- did not enforce single-use bootstrap;
- rewrote mismatched references;
- had incomplete capability dimensions;
- represented unknown limits incorrectly;
- returned a registry disconnected from composition;
- used a test-specific stable model ID.

It was rejected, repaired in a fresh high-quality delegation, verified, and committed.

### Problem 6: First Phase 7 put authentication in the private gateway

The initial prompt and implementation added JWT verification directly to Studio Gateway.

The intended architecture authenticates at the public API, then calls the private gateway through
a service binding.

Phase 7.1 removed direct gateway JWT auth and documented the correct trust boundary.

### Problem 7: Dead routing abstraction

The first Phase 7 introduced account gateway modes and run routing snapshots, but:

- source selection was process-global;
- no production caller invoked snapshot capture;
- Flue did not consult the snapshot.

Phase 7.1 removed the unsupported claim and retained honest process-level source selection.

### Problem 8: Guessed default model and disconnected catalog

The first Phase 7 guessed a default model and implemented `loadCatalog()` without a production
caller.

Phase 7.1:

- requires explicit default-model configuration;
- validates it when the catalog is loaded;
- clearly scopes Phase 7 production to the default alias;
- defers catalog refresh lifecycle to product integration.

### Problem 9: Adapter-only tests were insufficient

Direct adapter tests did not prove Flue would execute a tool and continue through the gateway.

Phase 7.1 added a generated-server integration test covering:

- Flue to mock Studio Gateway;
- reasoning/text;
- tool call;
- Flue tool execution;
- correlated result in the next request;
- final settlement;
- multiple calls;
- cancellation;
- credential leakage checks.

### Problem 10: Tool and provider assumptions can become accidental architecture

Repeated lesson:

- passing tests are necessary but not sufficient;
- trace the production caller;
- verify lifecycle ownership;
- reject a feature that exists only in unit tests;
- do not advertise planned behavior as operational behavior.

## 23. Current Verification Record And Risks

Verified at the Phase 7 commit (`8898458`):

- Studio Gateway: 91 tests passed; `tsc --noEmit` passed.
- V2 harness: 92 tests passed across 7 files; build and typecheck passed.
- `git diff --check` clean.

Earlier revisions of this document recorded 108 and 105 tests. Those counts predate Phase 7.1 and
were never accurate for the current suites; do not read the present numbers as lost coverage.

Known environment issue:

- installed Node observed as `22.18.0`;
- V2 declares `>=22.19.0`;
- tests passed with an engine warning;
- update the local Node runtime rather than normalizing the project down to the older patch.

Known architectural deferrals:

- no production API proxy to private Studio Gateway yet;
- no application session-backed `AccessTokenProvider`;
- no automatic Studio catalog lifecycle;
- no account settings or per-run source selection;
- no secure credential vault;
- no local BYOK provider;
- no permission/approval kernel;
- no stable Project Studio UI event projection for thinking and tools.

## 24. Immediate Next Procedure

Phase 7 is committed. The checkpoint below is the standing procedure for every phase:

```powershell
# Harness
cd "C:\pookiepied\Project Studio\Project Studio V2"
pnpm check

# Gateway
cd "C:\pookiepied\Project Studio\Backend\Cloud\gateways\gateway"
npm run build
npm test

# Root
cd "C:\pookiepied\Project Studio"
git diff --check
git status --short
```

The current step is Phase 7.5: a focused architecture pass against the audit list in section 21.
Update this blueprint and `Project Studio V2/docs/ROADMAP.md` when it completes.

Phase 7 review gates, confirmed at commit time:

- no direct JWT middleware remains in Studio Gateway; the only auth-shaped code is upstream
  provider credential handling and `stripProviderAuthorization`;
- provider transport, config, catalog, mapping, and errors live in `src/models/studio-cloud/`
  rather than one adapter file.

Two gates were deferred into the Phase 7.5 audit rather than being verified before the commit:

- that `tests/integration/studio-flue.test.ts` exercises a generated Flue server rather than being
  an adapter test labelled end-to-end;
- that the Phase 7 documentation claims no account/per-run switching and no automatic catalog
  loading.

## 25. Guidance For A New LLM Conversation

Start by reading:

1. this document;
2. `Project Studio V2/docs/ROADMAP.md`;
3. all V2 ADRs;
4. `Project Studio V2/README.md`;
5. current `git status` and diff;
6. the files directly involved in the next phase.

Do not:

- restart architecture discovery from zero;
- propose a custom while-loop agent engine;
- merge local BYOK and Studio Gateway implementations;
- add direct public access or Google authentication to Studio Gateway;
- assume every older cloud worker is part of V2;
- copy OpenCode wholesale;
- add speculative folders or dead interfaces;
- call a phase complete because isolated tests pass;
- commit before the user or reviewing task approves the phase.

The current goal is not to maximize the number of subsystems quickly. It is to create a durable,
understandable harness whose boundaries remain stable as capabilities are added.
