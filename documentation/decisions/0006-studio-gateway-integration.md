# ADR 0006: Studio Gateway Integration

Status: Superseded by [ADR 0009](0009-local-byok-providers.md) — 2026-08-24.
The Studio Cloud gateway is cancelled and the client this made operational —
adapter, SSE parser, event mapper, catalog, session-token provider — was
removed in `45233d5`. `studio-cloud` is no longer a model source; `local`
BYOK, recorded by ADR 0009, is the operational source. The name "gateway"
stays reserved in `ProviderSource` for a possible future user-hosted source.
The text below is left as written.

Status: Accepted

## Context

Project Studio has two model access paths (ADR 0002): the centrally operated
Studio Gateway and a future local runtime using the user's own provider
credentials. Phase 6 left both unimplemented and failed at bootstrap when
either was selected.

This phase makes `studio-cloud` operational. It deliberately does **not**
introduce an account preference model, a per-run gateway switch, or a routing
snapshot: at runtime, Flue model-provider selection happens once at process
bootstrap. There is no production code path that switches gateways per run, so
a "run-level routing snapshot" would be an abstraction that tests cover but
nothing calls. Honest scope beats a dead abstraction.

The Studio Gateway is a private Cloudflare Worker built on the Vercel AI SDK.
It publishes its own SSE contract: named events, tool calls delivered complete
rather than as argument deltas, and every semantic event emitted twice under a
compatibility name and a canonical `model.*` name. It is not OpenAI streaming
and does not become OpenAI streaming by being read as if it were.

## Decision

### Process-level source selection, no fallback

The model source stays a single bootstrap decision read from
`PROJECT_STUDIO_MODEL_SOURCE` (default: `test`):

- `test` — in-process deterministic provider; the network-free default;
- `studio-cloud` — the Studio Gateway, now operational;
- `local` — recognized but not operational (BYOK), failing at bootstrap.

No source is ever automatically substituted for another. Selecting `local`, or
selecting `studio-cloud` without a valid URL, default model, and token, is a
deliberate, visible startup failure. Account-level model preference and any
per-run routing are product-integration concerns and are deferred; this ADR
makes no claim that a settings change can reroute an accepted run.

### A native Pi-facing Studio Gateway adapter

The gateway keeps its Vercel AI SDK implementation; the harness does not
rewrite it to Pi and no AI SDK type crosses into the harness. Instead the
harness registers a dedicated Pi wire protocol, `project-studio-gateway`, and
parses the gateway's SSE contract directly:

- `stream.started` opens the assistant turn;
- text and reasoning deltas become Pi text and thinking blocks;
- completed tool calls become `toolCall` content, preserving id and order;
- usage and finish reason are carried onto the settled message;
- `stream.error` and non-2xx responses become typed `StudioGatewayError`s;
- `[DONE]` and `stream.completed` settle the turn.

Compatibility and canonical duplicates are collapsed by holding a
compatibility event for exactly one event: if its canonical twin follows with
an identical payload the compatibility copy is dropped, otherwise it is
released unchanged. A gateway that emits only one of the two forms still
produces exactly one unit of output. The terminal `tool_calls` aggregate is
reconciled against already-seen ids rather than re-emitted.

The adapter never executes a tool. A turn containing tool calls settles as
`toolUse` and Flue owns execution and continuation. A real generated Flue
server, driven against a mock gateway, proves the full loop end to end:
streamed reasoning and text, Flue executing the registered tool, the next
gateway request carrying the assistant tool calls and correlated tool results,
successful settlement, multiple tool calls preserved, cancellation closing the
upstream request, and no token in history, events, or logs.

### Authentication composition

The access token is supplied through an injected `AccessTokenProvider`, pulled
at request time — never from a prompt, a model reference, or mutable global
model state — and attached only to requests whose resolved URL is on the
configured gateway origin. Redirects are not followed.

`PROJECT_STUDIO_GATEWAY_TOKEN` backs a development-only bootstrap provider. It
is a convenience for local development, explicitly not secure credential
storage and not the BYOK mechanism. Production injects a provider backed by the
authenticated Studio application session; that integration, and any secure OS
credential storage BYOK requires, are deferred.

### Explicit default model, explicit catalog lifecycle

The gateway contract defines no canonical default model, so
`PROJECT_STUDIO_GATEWAY_DEFAULT_MODEL` is required rather than guessed. The
stable `project-studio/default` alias routes to it and resolves without a
network round trip, so bootstrap never blocks on catalog loading.

Loading the full catalog is an explicit, callable service —
`StudioCloudModelProviderAdapter.loadCatalog()` — that normalizes `/v1/models`
through the existing `ModelDescriptor` and capability contracts and verifies
the configured default model exists. Production Phase 7 behavior is scoped to
the default alias; wiring a lifecycle component that loads and refreshes the
catalog is deferred to product integration.

### Gateway trust boundary

Studio Gateway is a private Worker with no `workers.dev` subdomain and no
custom route, invoked only through a Cloudflare service binding from the public
API. The public API owns end-user authentication. The gateway performs no
inbound end-user auth of its own and must not trust arbitrary public identity
headers. Propagating trusted user identity from the API to the gateway is
deferred to the API proxy contract. The gateway's optional `user` passthrough
field is forwarded to providers as-is and carries no trust decision.

## Consequences

- `studio-cloud` reaches real models through the Studio Gateway without editing
  the agent definition; `STUDIO_MODEL_ID` is unchanged and the adapter resolves
  the same `project-studio/default` alias.
- Transport, SSE parsing, event mapping, request mapping, catalog
  normalization, configuration, the authentication boundary, adapter
  composition, and errors are separate cohesive modules.
- The gateway gained an optional assistant `toolCalls` field and tool-result
  correlation on its chat contract; without them a multi-turn tool exchange
  could not be replayed faithfully.
- No routing snapshot, gateway-mode enum, or account-selection layer ships in
  this phase. They are named as deferred product-integration work instead of
  implemented speculatively.
