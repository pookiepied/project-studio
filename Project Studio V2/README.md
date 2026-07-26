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
    models.ts                 Gateway-neutral model references, capability, adapter contract
  models/
    adapters/
      test-adapter.ts         Deterministic Pi provider behind the adapter contract
      studio-cloud-adapter.ts Studio Gateway source and its Pi wire protocol
    studio-cloud/
      config.ts               Validated gateway URL, required default model, timeout
      access-token.ts         Injected outbound token provider and header safety
                              (calling the gateway, not user login)
      client.ts               Origin-scoped HTTPS transport for the gateway
      sse-parser.ts           Server-sent event framing
      stream-events.ts        Gateway SSE vocabulary, parsing, duplicate collapsing
      event-mapper.ts         Gateway events projected onto Pi's event protocol
      request-mapper.ts       Pi transcript and tools to the gateway chat contract
      catalog.ts              /v1/models to ModelDescriptor and capabilities
      errors.ts               Safe typed gateway errors
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
    studio-gateway.test.ts    Adapter unit slice: catalog, streaming, tools, errors, cancellation
    studio-flue.test.ts       Real generated Flue server against a mock gateway
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
- Process-level model-source selection with no automatic cross-source fallback.
- Studio Gateway source with its native Pi wire protocol, streaming, and tool continuation.
- Context optimization port with a fail-open passthrough implementation.
- OpenTelemetry foundation with Flue GenAI instrumentation, structured logs, and safe errors.

The deterministic provider is intentionally in-process. It makes the harness fully testable
without credentials or network calls and sits behind the same `ModelProviderAdapter` contract the
Studio Gateway adapter now implements and the future local/BYOK adapter will implement. Agent and
persistence code do not change when the source changes.

`src/app.ts` validates and bootstraps model providers before initializing observability, then
mounts Flue's standard application. It does not add business HTTP routes. Inbound authentication
must be added to the agent route admission middleware before the server is exposed outside a
trusted local environment; the bearer token described below is outbound authentication to the
Studio Gateway, not admission control for this harness.

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

The model source is a process-level bootstrap decision read from `PROJECT_STUDIO_MODEL_SOURCE`
(default: `test`). It is deliberately not an account preference or a per-run switch. There is no
account model and no run router in this phase, so the harness makes no claim that a settings change
can reroute an accepted run; account-level settings and per-run routing are deferred to product
integration (see the ADR and the roadmap).

| Source | Operational | Description |
| --- | --- | --- |
| `test` | Yes | In-process deterministic Pi provider; network-free default |
| `studio-cloud` | Yes | Studio Gateway over its native SSE contract |
| `local` (BYOK) | No | Recognized by config; bootstrap fails with `ProviderConfigurationError` until secure OS credential storage and the BYOK runtime ship |

A `ProviderBootstrapCoordinator` runs once, creates the adapter for the selected source, registers
it with Flue, builds a `ModelRegistry`, and validates the default model reference through it.
Selecting `local`, or selecting `studio-cloud` without a valid URL, default model, and token, is a
deliberate startup failure, not a silent no-op: there is no placeholder adapter that reports
success without being able to serve a model, and no source is ever automatically substituted for
another. Studio configuration is validated before Flue registration, registry construction, and
OpenTelemetry initialization.

The `studio` agent references `STUDIO_MODEL_ID` (`"project-studio/default"`), a stable,
gateway-neutral constant that names no source, provider, or implementation. Switching sources
requires only a config change; the agent definition is not edited, and the Studio adapter resolves
the same alias.

### Studio Gateway Settings

| Setting | Required | Purpose |
| --- | --- | --- |
| `PROJECT_STUDIO_GATEWAY_URL` | Yes | Gateway root; HTTPS required except for loopback hosts |
| `PROJECT_STUDIO_GATEWAY_TOKEN` | Dev only | Development bootstrap access token (see below) |
| `PROJECT_STUDIO_GATEWAY_DEFAULT_MODEL` | Yes | Gateway model id the stable alias routes to |
| `PROJECT_STUDIO_GATEWAY_TIMEOUT_MS` | No | Response (connect + headers) timeout, default `120000` (1s to 600s) |

There is no canonical default model in the gateway contract, so `PROJECT_STUDIO_GATEWAY_DEFAULT_MODEL`
must be set explicitly rather than guessed; when the catalog is loaded it is checked to exist. A
base URL carrying embedded credentials, a query string, a fragment, or a non-HTTPS scheme on a
non-loopback host is rejected.

The access token is pulled from an injected `AccessTokenProvider` at request time, never from a
prompt, a model reference, or mutable global model state, and is attached only to requests whose
resolved URL is on the configured gateway origin. Redirects are not followed.

The timeout guards establishing the response (connect plus headers) and is cleared once headers
arrive; from then on the caller's `AbortSignal` governs the body. A long but healthy generation is
therefore never truncated by the connect budget, while cancelling a run still tears down the
upstream connection.

`PROJECT_STUDIO_GATEWAY_TOKEN` backs a **development-only** bootstrap token provider. It is a
convenience for pointing a local harness at a gateway; it is not secure credential storage and not
the BYOK mechanism. In production the public Project Studio application injects an
`AccessTokenProvider` backed by the authenticated Studio session; that integration is deferred.

### Studio Gateway Deployment Assumption

Studio Gateway is a **private** Cloudflare Worker: no `workers.dev` subdomain and no custom route.
It is invoked only through a Cloudflare **service binding** from the public API, and the public API
owns end-user authentication. The gateway therefore performs no inbound end-user auth of its own
and must not trust arbitrary public identity headers. Propagating trusted user identity from the
API to the gateway is deferred until the API proxy contract is implemented.

### Catalog Lifecycle

Production Phase 7 behavior is scoped to the stable default alias, which resolves without a network
round trip, so bootstrap never blocks on catalog loading. Discovering the full model list is an
explicit, callable service: `StudioCloudModelProviderAdapter.loadCatalog()` fetches and normalizes
`/v1/models`, registers per-model context/token limits, and verifies the configured default model
exists. Wiring an application lifecycle component that calls and refreshes it is deferred to product
integration.

### Studio Gateway Adapter

The gateway keeps its Vercel AI SDK implementation and no AI SDK type crosses into the harness.
The adapter registers a dedicated Pi wire protocol, `project-studio-gateway`, and parses the
gateway's own SSE contract directly rather than treating it as OpenAI streaming. It maps
`stream.started`, text deltas, reasoning deltas, completed tool calls, usage, `model.completed`,
`stream.error`, and `[DONE]` into Pi events, preserving tool-call ids and order, usage, and finish
reason.

The gateway publishes each semantic event twice, under a compatibility name and a canonical
`model.*` name. The mapper holds a compatibility event for exactly one event: if its canonical
twin follows with an identical payload the compatibility copy is dropped, otherwise it is released
unchanged, so a gateway emitting only one form still produces exactly one unit of output. The
terminal `tool_calls` aggregate is reconciled against already-seen ids rather than re-emitted.

The adapter never executes a tool. A turn containing tool calls settles as `toolUse` and Flue owns
execution and continuation. Cancellation closes the upstream stream. Gateway failures become typed
`StudioGatewayError`s built from status and the gateway's own normalized error code; raw upstream
bodies are never surfaced.

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

1. **Production Studio authentication.** Inject an `AccessTokenProvider` backed by the authenticated
   public-application session (the API proxy contract), replacing the development bootstrap token.
2. **Account settings and per-run routing.** Product-owned account model/source preference and,
   only if a real requirement emerges, a run-level routing record. This phase intentionally ships
   no such abstraction rather than a dead one that tests cover but nothing calls.
3. **Secure OS credential storage.** A keychain-backed store for user-controlled provider keys,
   with no plaintext-on-disk fallback and no key ever reaching a model-visible value, log, event,
   telemetry attribute, or persisted conversation. Prerequisite for the next item.
4. **Local BYOK provider runtime.** A `LocalModelProviderAdapter` behind the same contract,
   selectable via the `local` source. Local and Studio gateway internals and catalogs stay separate.
5. MCP connection registry for local and authenticated cloud servers.
6. Skill catalog, subagent profiles, sandbox adapters, and schedules.
7. Product-owned event projections over Flue envelopes.
8. Optional Headroom sidecar behind `ContextOptimizer`.

Until secure storage and the local runtime land, selecting `local` fails with
`ProviderConfigurationError` and is never answered by routing the run to the Studio gateway
instead.

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
- [Studio Gateway integration](docs/decisions/0006-studio-gateway-integration.md)
