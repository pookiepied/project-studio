# Project Studio V2 Harness

Local-first TypeScript agent harness built on Flue and Pi. This repository currently contains the
backend runtime foundation only. It does not contain the existing React UI or either production
model gateway; the HTTP surface it does serve (`src/transport/http`) is the harness's own API.

## Runtime Ownership

Flue owns the agent loop, canonical conversations, accepted submissions, model and tool events,
cancellation, and restart recovery. Pi provides the model protocol layer underneath Flue.
Project Studio owns product contracts, model-source selection, UI integration, authorization,
tools, MCP connections, skills, sandbox policy, and observability composition.

Project Studio terminology maps to Flue as follows:

| Project Studio | Flue |
| --- | --- |
| Thread | Persistent agent instance |
| Run | Durable direct-agent submission |
| Run events | Materialized conversation updates and settlement |
| Resume | Reconnect using the accepted stream URL and offset |

Direct agent submissions are deliberately used instead of Flue workflows for the main chat loop.
On Node, Flue can recover accepted agent submissions after restart; interrupted programmatic
workflow functions are not resumable.

## Structure

```text
src/
  app.ts                  what starts: providers, telemetry, the HTTP composition, the Flue mount
  server.ts               the process entry that listens
  db.ts                   Flue's SQLite adapter and where the file lives
  virtual-flue-server.d.ts ambient types for the module only the Vite graph can resolve

  admission/     who is calling: the per-launch bearer credential, scopes, the session it earns
  agents/        the Flue agents: studio (the continuing one), title, improve
  application/   wiring and the ports the routes take: runtime, brokers, management services
  auth/          sign-in to the Studio account: PKCE against Google, the session in the keychain
  browser/       the browser capability, as an MCP server in its own process
  context/       what the model is told: system, title and improve prompts, the capability inventory
  contracts/     shared types and the tables that decide: capabilities, effects, errors, models,
                 providers, conversations, media, and the UUID Studio-owned records carry
  conversations/ the one owner of conversation rows: store, titling, context usage, export, purge
  credentials/   the OS credential store behind one port; never a database column
  execution/     the turn as it runs: AsyncLocalStorage context, closing turns, outcomes
  extend/        what the user switched on per project, and making what runs match it
    mcp/         MCP servers: registry, launcher, supervisor, handshake, channels, wire/
  gateway/       every outside provider, behind one word
    language/    model providers and adapters; local/ is BYOK over Pi's Models
    media/       image, speech and transcription providers: adapters, drivers, jobs that outlive a call
    retrieval/   web search and readers: providers/, two slots, settings
    connections/ a connection to a provider: credentials, probe, the models it serves, defaults
    catalog/     the models Studio names itself, and icons/ for the marks providers wear
  host/          the process as the desktop Host sees it: bootstrap, readiness, shutdown
  net/           destination rules every caller shares; outside tools/ on purpose
  observability/ logging, tracing, redaction, safe error reports
  permissions/   the kernel: policy, grants, modes, trust, pending approvals
  plan/          the conversation's plan: its shape and its durable rows
  platform/      paths, the Node this needs, the boot log
  process/       running a child: exec, background, environment, interpreter
  projects/      the owner of project and project_folder
  questions/     a question a run puts to the person, and the durable queue it waits in
  reliability/   retry backoff and the per-class retry budget
  sandbox/       containment: policy, presets, scope, isolation/ per platform
  snapshots/     undo history: the shadow repo and the turn it records
  storage/       SQLite: database, migrations, app settings, the Flue journal
  tools/         the gate, the bounds, and one folder per native tool:
                 ask, discover, filesystem, git, media, native, plan, search, shell, web
  transport/
    http/        the harness's own API: create-app, middleware/, routes/
  vendor/        pinned binaries: resolving shipped or managed ones
tests/
  unit/          one file per subject; tools/ mirrors src/tools
  integration/   a real server, real SQLite, real OS stores; skipped where the machine cannot
  helpers/       what several tests share: can this machine contain a child, where the desktop
                 Host's sources are, the sandbox profiles global setup
  fixtures/      declared data tests read
```

The map stops at folders on purpose. A folder's files change often and each one
carries its own header saying what it is; the folder line says what belongs
there and, by omission, what does not.

Two names deserve a word. `plan/` and `questions/` are the durable domain halves;
`tools/plan/` and `tools/ask/` are the tool surfaces a run calls, and they are
kept apart because the rows outlive the call. `admission/` decides who is calling
and `permissions/` decides what a call may do; both have a `scopes.ts`, and they
are different scopes.

There are no placeholder directories. A folder exists when something is in it.

## Current Vertical Slice

- Strict TypeScript workspace on Node 22.19 or newer.
- One continuing `studio` agent discovered by Flue.
- File-backed SQLite canonical persistence.
- Accepted asynchronous submissions with stable submission IDs.
- UI-ready conversation observation through `@flue/sdk`.
- Thread history and multi-message continuity.
- Durable cancellation with an `aborted` settlement.
- Process-restart recovery from the same SQLite database.
- Pi streaming and typed tool-call continuation.
- Gateway-neutral model contracts with provider adapter composition.
- Process-level model-source selection with no automatic cross-source fallback.
- Context optimization port with a fail-open passthrough implementation.
- OpenTelemetry foundation with Flue GenAI instrumentation, structured logs, and safe errors.

The deterministic provider is intentionally in-process. It makes the harness fully testable
without credentials or network calls and sits behind the same `ModelProviderAdapter` contract the
local/BYOK adapter implements. Agent and persistence code do not change when the
source changes.

`src/app.ts` validates and bootstraps model providers before initializing observability, then
creates the authenticated HTTP composition in `src/transport/http/create-app.ts`. One admission
middleware protects Flue, MCP management, approval, and provider-administration routes; operation
scopes remain separate from capability policy. The headless launcher in `src/host/` now supplies
the explicit loopback and structured readiness seam recorded in ADR 0028; packaged Tauri Host
ownership remains a separate task.

## Commands

Use Node 22.19 or newer — that floor is not ours, it is what `@flue/runtime`,
`@flue/cli`, `@flue/opentelemetry` and `@earendil-works/pi-ai` each declare.
`.node-version` pins `24.19.0`, the current patch of the Krypton LTS line, which
is the version the project is meant to be developed and verified on.

Nothing in this repository enforces either number: there is no CI, and neither
pnpm's warning nor `.node-version` stops a build. So the Harness reports its own
runtime at startup instead — `src/platform/runtime.ts` owns both numbers and
`tests/unit/runtime-version.test.ts` fails if the copies drift apart or fall
below what a dependency requires (meta-task #79).

```powershell
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm check
```

`pnpm test` builds the generated Flue server before running tests. The restart test intentionally
waits for Flue's expired lease to be reclaimed, so the full suite takes several minutes.

To run the generated server for local development, inject a private per-launch admission
credential. The value is never a URL or product setting; tests pass it through the child process
environment. Production Host bootstrap is tracked in task 006.

```powershell
pnpm build
$env:PORT = "3000"
node dist/server.mjs
```

## Observability

Project Studio configures the OpenTelemetry Node SDK, then registers `@flue/opentelemetry` once.
Flue owns agent/model/tool span projection; Project Studio owns resource attributes, exporters,
content policy, logs, and error serialization.

| Setting | Default | Purpose |
| --- | --- | --- |
| `PROJECT_STUDIO_SERVICE_NAME` | `project-studio-v2` | `service.name` |
| `PROJECT_STUDIO_SERVICE_VERSION` | `0.1.0` | `service.version` |
| `PROJECT_STUDIO_DEPLOYMENT_ENVIRONMENT` | `NODE_ENV` or `development` | `deployment.environment` |
| `PROJECT_STUDIO_OTEL_EXPORTER` | `none` | `none`, `memory`, or `otlp` |
| `PROJECT_STUDIO_OTEL_ENDPOINT` / `OTEL_EXPORTER_OTLP_ENDPOINT` | unset | Enables OTLP when set |
| `PROJECT_STUDIO_OTEL_CAPTURE_CONTENT` / `OTEL_GENAI_CAPTURE_CONTENT` | `false` | Opt-in GenAI content capture with redaction |

There is no network exporter by default. GenAI content capture is off unless explicitly enabled,
and enabled capture always runs through the redaction transform. Application logs are structured
JSON on stdout/stderr with optional `trace_id` / `span_id` fields when a span is active.

## Model-Provider Composition

The model source is a process-level bootstrap decision read from `PROJECT_STUDIO_MODEL_SOURCE`
(default: `test`). It is deliberately not an account preference or a per-run switch. There is no
account model and no run router in this phase, so the harness makes no claim that a settings change
can reroute an accepted run; account-level settings and per-run routing are deferred to product
integration (see the ADR and the roadmap).

| Source | Operational | Description |
| --- | --- | --- |
| `test` | Yes | In-process deterministic Pi provider; network-free default |
| `local` (BYOK) | Yes | Built-in Pi providers plus user-declared custom providers; keys in the OS keychain |

A `ProviderBootstrapCoordinator` runs once, creates the adapter for the selected source, registers
it with Flue, builds a `ModelRegistry`, and validates the default model reference through it.
Selecting `local` with no default model or an unreadable settings database is a deliberate startup
failure, not a silent no-op: there is no placeholder adapter that reports success without being
able to serve a model, and no source is ever automatically substituted for another. Configuration
is validated before Flue registration, registry construction, and OpenTelemetry initialization.

The `studio` agent references `STUDIO_MODEL_ID` (`"project-studio/default"`), a stable,
gateway-neutral constant that names no source, provider, or implementation. Switching sources
requires only a config change; the agent definition is not edited, and the local adapter resolves
the same alias.

> **The Studio Cloud gateway was cancelled.** Its Worker source was removed in commit `bd4d389`,
> and the Harness's client for it — the `studio-cloud` model source, adapter, SSE parser, and
> catalog — has been removed with it. The sign-in flow in `src/auth/` remains: it is the
> harness-owned Project Studio account session, distinct from any model gateway. The name
> "gateway" stays reserved in the provider contract for a possible future user-hosted source;
> ADR 0031 records that the cancelled contract was already wrong.

## The Gateway

Everything that talks to a model vendor lives under `src/gateway/`, one folder per kind of
gateway, and the rule that makes it a subsystem rather than a folder is enforced by lint: the
language gateway is the only place that may import `@earendil-works/pi-ai`.

- `src/gateway/language/` — Pi, confined to text: the model registry, the local and test
  adapters, the Pi runtime and credential bridge, the prompt trace, and `pi-catalog.ts`, which
  answers for Pi's models in contract types so no Pi type leaves the folder.
- `src/gateway/media/` — Studio's own adapters, one per vendor media wire (`adapters/`), the
  speech and transcription drivers, and `jobs.ts`, the registry every generation runs in as a job
  whose bytes land in the conversation's artifacts directory. The model reaches it through
  `src/tools/media/` (`studio_image`, `studio_video`); the app through `/api/media`.
- `src/gateway/retrieval/` — the five web providers (Tavily, Brave, Exa for search; Jina,
  Firecrawl for reading a page) behind `web_search` and `web_fetch`.
- `src/gateway/catalog/` — the provider library: the declared catalog for everything beyond
  language, joined with the language gateway's, plus the provider icons.
- `src/gateway/connections/` — `ConnectionStore` persists connection records (keys live in the
  OS keychain, never the database), `ModelCatalog` serves catalogs, manual models, overrides
  and per-slot defaults, and the probe checks a connection is live.

Separate from the model source (which is one process-level choice), the connection half
administers user-declared connections to language, media, and retrieval providers and the models
they expose:

- `src/contracts/providers.ts` — `ProviderConnection` / `ProviderPort` contract: connections,
  models, capability slots, and defaults, shared by the stores and the HTTP surface.
- `src/application/provider-management.ts` — `ProviderAdministration`, the port the HTTP surface
  takes, composed over the two stores in `app.ts`.
- `src/transport/http/routes/providers.ts` — routes under `/api/providers`, behind the
  `provider-management` admission scope.
- Migrations 11–13: `provider_connection_record` (11), the model tables
  `provider_model_override` / `provider_model_manual` / `provider_default` (12), and the rebuild
  that gives all three foreign keys with `ON DELETE CASCADE` to the connection record (13).

## Persistence And Recovery

There are two databases, deliberately.

`src/db.ts` is Flue's, defaulting to `~/.studio/data/flue.db` (the Studio home, via
`flueDatabasePath()`) and overridden by `PROJECT_STUDIO_DB_PATH`. It holds the canonical
transcript, the submission journal, and run state, behind an opaque persistence adapter Flue owns.

`src/storage/` is the product's, defaulting to `~/.studio/data/studio.db` (the Studio home, via
`databasePath()`) and overridden by `PROJECT_STUDIO_STORE_PATH`. It holds provider settings and
connection records, the MCP server registry, and the approval and trust tables. Secrets never go
in it — those are in the OS keychain, and a migration fails if a column name looks like credential
storage. See ADR 0010.

The Flue database and accepted-run record are both required for recovery:

```ts
{
  threadId,
  submissionId,
  streamUrl,
  offset
}
```

The stream URL is deployment-specific. When a replacement server moves to another origin, retain
the path but rebase it to the replacement origin before waiting. Flue uses conservative recovery:
completed tool results are reused, and a tool with an unknown outcome is not blindly repeated.
Only one live Node process may own a given agent instance.

## Deferred Boundaries

The next implementation phase should add adapters, not replace the harness:

1. **Account settings and per-run routing.** Product-owned account model/source preference and,
   only if a real requirement emerges, a run-level routing record. This phase intentionally ships
   no such abstraction rather than a dead one that tests cover but nothing calls.
2. **Skill catalog, subagent profiles, sandbox adapters, and schedules.**
3. **Product-owned event projections over Flue envelopes.**
4. **Optional Headroom sidecar behind `ContextOptimizer`.**

Headroom is not installed in this phase. Its TypeScript package is a client for a separate
Python/Rust proxy and does not directly wrap Flue's Pi loop. A future adapter must preserve the
canonical conversation, fail open, use reversible compression, and avoid compressing system
instructions, recent turns, or incomplete tool-call pairs.

## Architecture Decisions

- [Harness boundaries](../documentation/decisions/0001-harness-boundaries.md)
- [Two-gateway model](../documentation/decisions/0002-two-gateway-model.md)
- [Context optimization](../documentation/decisions/0003-context-optimization.md)
- [Observability foundation](../documentation/decisions/0004-observability.md)
- [Model-provider composition](../documentation/decisions/0005-model-provider-composition.md)
- [Studio Gateway integration](../documentation/decisions/0006-studio-gateway-integration.md)
