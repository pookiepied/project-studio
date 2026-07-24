# Project Studio V2 Harness

Local-first TypeScript agent harness built on Flue and Pi. This repository currently contains the
backend runtime foundation only. It does not contain the existing React UI, a custom application
API, or either production model gateway.

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
  agents/
    studio.ts                 First continuing Flue agent
  application/
    harness-client.ts         UI-facing send/wait/observe/cancel/history boundary
  app.ts                      Model-provider bootstrap + telemetry init + Flue mount
  context/
    context-optimizer.ts      Passthrough optimizer and future Headroom port
  contracts/
    events.ts                 Product event envelope
    models.ts                 Gateway-neutral model references, capability, adapter contract
  models/
    adapters/
      test-adapter.ts         Deterministic Pi provider behind the adapter contract
    bootstrap.ts              Provider bootstrap coordinator and startup validation
    model-registry.ts         Model-source resolver and capability aggregator
    provider-config.ts        Validated model-source configuration
  observability/
    config.ts                 Validated exporter and content-capture config
    errors.ts                 Safe error normalization/serialization
    flue.ts                   One-time Flue OpenTelemetry registration
    index.ts                  initialize/shutdown boundary
    logger.ts                 Structured logger with trace correlation
    redaction.ts              GenAI content redaction transform
    sdk.ts                    OpenTelemetry Node SDK lifecycle
  tools/
    workspace-summary.ts      Typed tool used to prove tool continuation
  db.ts                       File-backed Flue SQLite adapter
tests/
  integration/
    harness.test.ts           Real server, SQLite, cancellation, and restart tests
    observability.test.ts     Span hierarchy, metrics, redaction, cancellation
  unit/
    architecture.test.ts      Boundary tests
    model-providers.test.ts   Provider config, adapters, registry, bootstrap
    observability.test.ts     Config, init-once, logger, errors, redaction
docs/
  decisions/                  Architecture decision records
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
- Context optimization port with a fail-open passthrough implementation.
- OpenTelemetry foundation with Flue GenAI instrumentation, structured logs, and safe errors.

The deterministic provider is intentionally in-process. It makes the harness fully testable
without credentials or network calls and sits behind the same `ModelProviderAdapter` contract
that the future local and studio-cloud gateways will implement. Agent and persistence code will
not change when those adapters arrive.

`src/app.ts` validates and bootstraps model providers before initializing observability, then
mounts Flue's standard application. It does not add business HTTP routes. Authentication must be
added to the agent route admission middleware before the server is exposed outside a trusted
local environment.

## Commands

Use Node 22.19 or newer. The repository pins the intended local version in `.node-version`.

```powershell
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm check
```

`pnpm test` builds the generated Flue server before running tests. The restart test intentionally
waits for Flue's expired lease to be reclaimed, so the full suite takes about one minute.

To run the generated server:

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

Project Studio selects a model source at bootstrap through `PROJECT_STUDIO_MODEL_SOURCE`
(default: `test`). Config parsing recognizes all three source identities. A
`ProviderBootstrapCoordinator` runs once, creates the adapter for the selected source, registers
it with Flue, builds a `ModelRegistry`, and validates the default model reference through it.

| Source | Operational | Description |
| --- | --- | --- |
| `test` | Yes | In-process deterministic Pi provider; network-free |
| `local` | No | Recognized by config; bootstrap fails immediately with `ProviderConfigurationError` until Phase 7 |
| `studio-cloud` | No | Recognized by config; bootstrap fails immediately with `ProviderConfigurationError` until Phase 8 |

Selecting `local` or `studio-cloud` today is a deliberate startup failure, not a silent no-op:
there is no placeholder adapter that reports success without being able to serve a model.

The `studio` agent references `STUDIO_MODEL_ID` (`"project-studio/default"`), a stable,
gateway-neutral constant that names no source, provider, or implementation. Selecting `test`
requires only a config change; the agent definition is not edited. Phase 7 and 8 adapters must
resolve the same alias.

## Persistence And Recovery

`src/db.ts` defaults to `./data/flue.db`. Set `PROJECT_STUDIO_DB_PATH` to use another file.
The database and accepted-run record are both required for recovery:

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

1. Local model gateway registration with user-controlled credentials, added as a new
   `ModelProviderAdapter` selectable via the `local` source.
2. Studio cloud gateway registration and centralized authentication, added as a new
   `ModelProviderAdapter` selectable via the `studio-cloud` source.
3. MCP connection registry for local and authenticated cloud servers.
4. Skill catalog, subagent profiles, sandbox adapters, and schedules.
5. Product-owned event projections over Flue envelopes.
6. Optional Headroom sidecar behind `ContextOptimizer`.

Headroom is not installed in this phase. Its TypeScript package is a client for a separate
Python/Rust proxy and does not directly wrap Flue's Pi loop. A future adapter must preserve the
canonical conversation, fail open, use reversible compression, and avoid compressing system
instructions, recent turns, or incomplete tool-call pairs.

## Architecture Decisions

- [Harness boundaries](docs/decisions/0001-harness-boundaries.md)
- [Two-gateway model](docs/decisions/0002-two-gateway-model.md)
- [Context optimization](docs/decisions/0003-context-optimization.md)
- [Observability foundation](docs/decisions/0004-observability.md)
- [Model-provider composition](docs/decisions/0005-model-provider-composition.md)
