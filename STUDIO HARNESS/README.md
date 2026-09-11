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
  admission/
    context.ts                AuthContext, client types, session identity
    credential.ts             Per-launch bearer credential generation and validation
    errors.ts                 Typed admission errors
    scopes.ts                 Named admission scopes and their lookup
    verifier.ts               Timing-safe bearer verification and session construction
  agents/
    studio.ts                 First continuing Flue agent
  application/
    approval-broker.ts        Durable approval broker over the pending store
    harness-client.ts         UI-facing send/wait/observe/cancel/history boundary
    mcp-management.ts         McpAdministration port and service the routes take
    provider-management.ts    ProviderAdministration port and service the routes take
    studio-runtime.ts         Runtime composition: MCP registry, supervisor, sandbox
    tool-name.ts              Stable model-facing tool names across MCP identities
  app.ts                      Model-provider bootstrap + telemetry init + Flue mount
  auth/
    cli.ts                    pnpm auth sign-in / status / sign-out
    config.ts                 Validated auth service URL and desktop OAuth client id
    errors.ts                 Typed sign-in errors, never carrying a token or code
    google-login.ts           PKCE loopback flow against Google
    auth-client.ts            HTTP boundary for the Studio auth service
    session.ts                Session storage over the keychain, JWT expiry reading
    login.ts                  Sign-in/out orchestration
  context/
    context-optimizer.ts      Passthrough optimizer and future Headroom port
  contracts/
    agents.ts                 Agent identity
    capabilities.ts           Capability identity, effects, provenance, execution scope
    effects.ts                What each effect requires; the one table that answers
    errors.ts                 StudioError base, domain taxonomy, safe report shape
    models.ts                 Gateway-neutral model references, capability, adapter contract
    providers.ts              ProviderConnection/ProviderPort contract over language,
                              media, and retrieval providers
  credentials/
    credential-store.ts       SecureCredentialStore port, key/secret validation, typed errors
    keyring-store.ts          OS keychain implementation; no plaintext fallback
    memory-store.ts           In-memory store for tests, same validation rules
  db.ts                       File-backed Flue SQLite adapter
  execution/
    context.ts                AsyncLocalStorage execution context and operation ids
    outcomes.ts               Stop/timeout/cancellation outcome classification
  extend/
    errors.ts                 How the extend spine fails
    inventory.ts              What exists on this machine, and what this project chose
    reconcile.ts              Making what runs match what the user chose
    selection.ts              What the user chose to switch on, per project
    mcp/
      capabilities.ts         MCP tools presented through the capability contract
      connection.ts           One MCP connection: framing, JSON-RPC, pending correlation
      handshake.ts            The first exchange with an MCP server, and the era probe
      http-channel.ts         HTTP transport channel for MCP servers
      input-security.ts       Scrubbing secret-shaped fields from server arguments
      launcher.ts             Launching MCP servers under sandbox containment
      reconcile.ts            MCP flavor of the reconcile plan
      registry.ts             Persisted MCP server registry
      stdio-channel.ts        stdio transport channel for MCP servers
      supervisor.ts           MCP server lifecycle: start, handshake, retry, stop
      wire/
        backoff.ts            Retry backoff for a server that fails to start
        definition-hash.ts    Stable hash of a tool definition
        era.ts                Era probe deciding which wire era to speak
        framing.ts            Newline-delimited JSON framing over stdio
        jsonrpc.ts            JSON-RPC 2.0 shapes as MCP uses them
        lifecycle.ts          Connection lifecycle for one MCP server
        pending.ts            Correlation for JSON-RPC requests over one connection
  host/
    harness-launcher.ts       Headless launcher seam the Tauri Host consumes
    readiness.ts              Structured readiness frames on the launcher channel
  identity/
    uuid.ts                   UUIDs for records and operations Project Studio owns
  models/
    adapters/
      test-adapter.ts         Deterministic Pi provider behind the adapter contract
      local-adapter.ts        Local BYOK source; alias protocol over Pi's Models
    local/
      apis.ts                 Supported custom-provider wire protocols
      config.ts               Default model and user-declared custom providers
      credential-bridge.ts    OS keychain presented as Pi's CredentialStore
      runtime.ts              Pi Models collection: built-ins plus custom providers
      catalog.ts              Pi models to ModelDescriptor and capabilities
      settings-store.ts       Durable provider settings; the non-secret half of BYOK
      provider-service.ts     Connect/disconnect/select contracts for settings
      cli.ts                  pnpm providers list / models / connect / add / select
    bootstrap.ts              Provider bootstrap coordinator and startup validation
    model-registry.ts         Model-source resolver and capability aggregator
    provider-config.ts        Validated model-source configuration
  net/
    destination.ts            Destination judgment: loopback, own ports, DNS
    http.ts                   Typed HTTP client with destination checks and timeouts
    own-ports.ts              The ports this process listens on
  observability/
    config.ts                 Validated exporter and content-capture config
    error-reporter.ts         The one path a failure takes: log, span, counter
    errors.ts                 Safe error normalization/serialization
    flue.ts                   One-time Flue OpenTelemetry registration
    index.ts                  initialize/shutdown boundary
    logger.ts                 Structured logger with trace correlation
    redaction.ts              GenAI content redaction transform
    redaction-rules.ts        The redaction catalog
    sdk.ts                    OpenTelemetry Node SDK lifecycle
    telemetry-errors.ts       Failures in the telemetry subsystem itself
  permissions/
    kernel.ts                 The single source of authority for every capability
    policy.ts                 Verdicts, decision sources, base rules, defaults
    grant-store.ts            Persisted, listable, revocable user approvals
    matcher.ts                Matching a call's resource against a permission pattern
    mode.ts                   What "ask" means right now
    pending-approvals.ts      Durable pending approval queue
    scopes.ts                 The choices offered when the user is asked to approve
    trust.ts                  Per-project trust decisions
    errors.ts                 Typed permission errors, never carrying arguments
  platform/
    paths.ts                  The Studio home, install, and project locations
    runtime.ts                Which Node the project requires, and which runs it
  process/
    environment.ts            What a child may inherit, in one place
    errors.ts                 Typed process errors
    exec.ts                   Spawning and killing child processes
  providers/
    connection-store.ts       Provider connection records; keychain-first removal
    model-catalog.ts          Built-in, manual, and overridden models; defaults
  retrieval/
    errors.ts                 How a retrieval provider failed
    http.ts                   The one HTTP call every provider adapter makes
    registry.ts               Registered search and reader providers
    service.ts                RetrievalService over providers and settings
    settings.ts               Persisted retrieval provider settings
    slots.ts                  Two slots, and the rule for moving between them
    types.ts                  What a retrieval provider is
    providers/
      brave.ts                Brave Search
      exa.ts                  Exa search
      firecrawl.ts            Firecrawl reader
      jina.ts                 Jina reader
      tavily.ts               Tavily search (the default)
  sandbox/
    cli.ts                    pnpm sandbox:prepare / list / release
    policy.ts                 Closed-by-default containment policy and isolation levels
    paths.ts                  Path containment: traversal, symlinks, prefixes, Windows
    local-sandbox.ts          Path containment, and the one door to a contained child
    isolation/                OS containment: kinds, backends, and the single verdict
      backend.ts              The backend contract and support probing
      contain.ts              Asserting availability and containing a command
      index.ts                The isolation seam
      kinds.ts                Which children need containment
      program-roots.ts        Directories a contained program must read to run
      registry.ts             The registered backends, per platform
      windows/                AppContainer, via the studio-contain launcher we ship
        appcontainer.ts       The Windows AppContainer backend
        launcher.ts           The studio-contain launcher we ship
        ledger.ts             Persisted record of what was contained
        traversal.ts          Getting a contained program to its first line
      linux/                  bwrap and pasta, as the distribution ships them
        apparmor.ts           One-time machine setup a Linux sandbox needs
        bwrap.ts              The bubblewrap backend
        identity.ts           Whose ability is being measured
        network.ts            The pasta network backend
    errors.ts                 Typed sandbox errors, never echoing the attempted path
  snapshots/
    errors.ts                 Typed snapshot errors
    index.ts                  The snapshots public surface
    shadow-repo.ts            Per-project shadow git repositories
    store.ts                  Snapshot storage under the Studio home
    turn.ts                   Turn snapshots and restore hooks
  storage/
    app-settings.ts           The one owner of the app_setting table
    database.ts               Application-owned SQLite connection and transactions
    migrations.ts             Versioned schema, applied once, with a no-secrets guard
    errors.ts                 Typed storage errors and driver-failure classification
  tools/
    bounds.ts                 Per-capability call bounds
    errors.ts                 Typed tool errors
    gate.ts                   The call gate: who may call what, and how often
    types.ts                  Tool definition shape and registration
    workspace-summary.ts      Typed tool used to prove tool continuation
    filesystem/               Read, write, and edit tools, and the access log
    git/                      Git tools: argv building and subcommand classification
    native/                   Native tools over the product runtime
    search/                   Glob and ripgrep-backed grep tools
    shell/                    Shell tools with command resolution
    web/                      Fetch and web-search tools, untrusted content labeled
  transport/
    http/
      create-app.ts           HTTP composition: admission middleware, routes, Flue mount
      middleware/
        admission.ts          Bearer verification and scope checking middleware
      routes/
        mcp.ts                MCP management routes
        permissions.ts        Approval routes
        providers.ts          Provider administration routes
  vendor/
    errors.ts                 Typed vendor errors
    resolver.ts               Resolving shipped or managed binaries
tests/
  integration/
    harness.test.ts           Real server, SQLite, cancellation, and restart tests
    observability.test.ts     Span hierarchy, metrics, redaction, cancellation
    credential-keyring.test.ts Real OS credential store; skips where none exists
    auth-login.test.ts        Full PKCE flow against a mock Google and auth service
    local-byok.test.ts        Stored key to the wire against a mock OpenAI-compatible server
  unit/
    architecture.test.ts      Boundary tests
    credentials.test.ts       Key namespacing, secret limits, in-memory store
    local-providers.test.ts   Credential chunking, serialized writes, specifiers
    model-providers.test.ts   Provider config, adapters, registry, bootstrap
    observability.test.ts     Config, init-once, logger, errors, redaction
```

There are no placeholder directories. New capability folders should be added only when they
contain an implemented boundary.

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
- `src/gateway/media/` — Studio's own drivers for speech and transcription (and, as the gateway
  plan lands, image, image editing and video), speaking to each vendor directly.
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
