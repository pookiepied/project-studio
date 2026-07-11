# Studio API Surface Doctrine

Date: 2026-07-11

This document defines the target shape for the public Studio API during the architecture
rework. `V2/` is an internal implementation name only. Public routes must not expose
`v2`, worker names, migration language, or implementation folders.

## Goals

- Present one clean Studio API surface to the app and future clients.
- Keep AI/runtime functionality organized inside the Studio product namespace, not as
  the root identity of the whole API.
- Make WebSocket the primary runtime transport.
- Keep HTTP and SSE available for request/response, compatibility, voice, callbacks, and
  places where a persistent socket is not the right tool.
- Keep adapter compatibility separate from native Studio runtime endpoints.
- Keep the API worker thin: authenticate, inject identity, route to workers, normalize
  errors, and preserve stable external contracts.

## Non-goals

- Do not expose `/v2`.
- Do not expose implementation nouns such as root-level `/runtime`, `/context`,
  `/registry`, or `/data` as top-level API products.
- Do not put new runtime WebSockets under old root `/agents/*` paths.
- Do not put native Studio runtime WebSockets under `/adapters/openai/*`; WebSocket is not
  an OpenAI-compatible API feature.
- Do not rebuild Context, Registry, Data, or runtime logic inside the API worker.
- Do not keep adding one-off root routes when a product area namespace exists.

## Naming Rules

- Public Studio functionality lives under `/studio`.
- Product nouns come after the product namespace: `/studio/conversations`,
  `/studio/runs`, `/studio/artifacts`, `/studio/uploads`, `/studio/integrations`,
  `/studio/adapters`, `/studio/system`.
- Avoid exposing internal subsystem nouns unless the user-facing concept really is that
  subsystem. For example, prefer `/studio/conversations/:id/events` over
  `/runtime/conversations/:id/events`.
- Transport should be explicit only where it matters:
  - WebSocket event streams use `/events`.
  - SSE streams use `/stream`.
  - HTTP command endpoints use command nouns or verbs.
- Keep route names stable even if the internal worker changes.
- Use `conversationId`, `runId`, `approvalId`, `artifactId` consistently.
- API names describe user-visible concepts, not Cloudflare bindings or internal services.

## Native Studio Runtime Routes

These are Studio-native, not adapter routes.

```text
POST /studio/runs
GET  /studio/conversations/:conversationId/state
GET  /studio/conversations/:conversationId/events        WebSocket primary transport
GET  /studio/conversations/:conversationId/stream        SSE fallback / HTTP streaming
POST /studio/conversations/:conversationId/pause
POST /studio/conversations/:conversationId/resume
POST /studio/conversations/:conversationId/cancel
POST /studio/conversations/:conversationId/approvals/:approvalId/resolve
```

### WebSocket Role

`/studio/conversations/:conversationId/events` is the primary live runtime channel.
It carries Studio Runtime Protocol frames:

- `connection.snapshot`
- replayed runtime events
- live runtime events
- client `subscribe`
- client `ack`
- client `ping`

Authentication happens at the API boundary. The API worker injects `X-User-ID` before
forwarding to the execution runtime. The execution runtime still enforces conversation
ownership using that injected identity.

### HTTP/SSE Role

HTTP remains first-class:

- Start and control commands are HTTP because they are discrete commands.
- Approval resolution is HTTP because it is a one-shot decision.
- SSE is useful for environments that cannot hold WebSockets cleanly or for simpler
  streaming consumers.
- Voice and low-latency interactive modes may use WebSocket, HTTP streaming, or a
  dedicated transport later, but should still live under a stable Studio product namespace.

## Adapter Routes

Adapters expose compatibility contracts for external protocols.

```text
POST /studio/adapters/openai/chat/completions
GET  /studio/adapters/openai/models
POST /studio/adapters/openai/audio/transcriptions
POST /studio/adapters/openai/audio/speech
...
```

The adapter namespace should not own native Studio runtime sessions. If an adapter needs
to start a Studio run, it should translate the request into the native runtime contract
internally, but the native WebSocket remains under `/studio/conversations/...`.

## Other Product Areas

These names are target public areas. Internal worker bindings can change without changing
these routes.

```text
/studio/context/...        Context inspection/debug/admin surfaces, not normal runtime fetches
/studio/registry/...       Connectors, MCP servers, skills, agents, availability, capabilities
/studio/conversations/...  Conversation records and state
/studio/artifacts/...      Generated artifacts and durable outputs
/studio/uploads/...        User-provided uploads
/studio/integrations/...   OAuth/app connector flows and user integration setup
/studio/system/updates...  Desktop/app update checks and release metadata
/studio/system/health...   Health/status
```

## API Worker Responsibilities

The API worker owns:

- JWT / Cloudflare Access validation
- token revocation checks
- identity injection (`X-User-ID`)
- request size and CORS/security headers
- stable route names
- forwarding to the correct worker
- consistent public error envelopes
- WebSocket upgrade forwarding for adapter-scoped or runtime-scoped routes

The API worker does not own:

- model/provider logic
- agent loop state
- context assembly
- registry discovery
- tool execution
- artifact storage
- permission decisions

## Refactor Strategy

1. Build the new route tree beside the legacy routes.
2. Move direct `/agents/*` forwarding behind native `/studio/conversations/...` or
   remove it when the frontend no longer uses it.
3. Move OpenAI-compatible routes to the cleaner `/studio/adapters/openai/...` names, with
   temporary compatibility aliases only if the frontend still needs them.
4. Add service binding for Studio Execution Runtime.
5. Forward native runtime HTTP and WebSocket requests through the API boundary with
   `X-User-ID`.
6. Keep system update routes stable under `/studio/system/updates`.
7. Inventory memory/data routes and move them under `/studio/artifacts`,
   `/studio/uploads`, `/studio/conversations`, `/studio/registry`, or internal Context
   calls based on ownership.
8. Delete old scattered routes only after the frontend has moved.

## Open Decisions

- Final native WebSocket path name:
  - Recommended: `/studio/conversations/:conversationId/events`
  - Alternative: `/studio/sessions/:conversationId/events`
- Whether SSE fallback is required immediately or can land after WebSocket.
- Whether OpenAI adapter keeps `/v1` compatibility aliases temporarily.
- Final placement of memory routes: `/studio/memories` vs Context-only internal use.
