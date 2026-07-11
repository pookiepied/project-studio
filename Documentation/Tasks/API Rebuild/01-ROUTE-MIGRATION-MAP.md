# API Route Migration Map

Date: 2026-07-11

This is the implementation map for rebuilding the API worker around clean product
namespaces. Public routes should not expose `v2`.

## Target Folder Shape

```text
api/src/
  index.ts
  server/
    app.ts
    types.ts
  identity/
    resolveIdentity.ts
    requireUser.ts
  proxy/
    forward.ts
    websocket.ts
  studio/
    index.ts
    runs/
      index.ts
      routes/
        createRun.ts
    conversations/
      index.ts
      routes/
        state.ts
        control.ts
        events.ts
        stream.ts
        approvals.ts
    adapters/
      openai/
        index.ts
        routes/
          chat.ts
          audio.ts
          models.ts
          images.ts
    data/
      conversations/
      artifacts/
      uploads/
      memories/
    registry/
      capabilities/
      integrations/
      skills/
      agents/
    system/
      index.ts
      routes/
        health.ts
        updates.ts
```

`index.ts` should only call `createApiApp()`. `server/app.ts` composes subsystems.
Route-specific auth/proxy logic belongs in subsystem modules, not the entrypoint.

## Native Studio Runtime

Public route:

```text
POST /studio/runs
```

Forwards to execution-runtime:

```text
POST /runs
```

Public route:

```text
GET /studio/conversations/:conversationId/state
```

Forwards to execution-runtime:

```text
GET /runs/:conversationId
```

Public route:

```text
GET /studio/conversations/:conversationId/events
```

Forwards WebSocket upgrade to execution-runtime:

```text
GET /runs/:conversationId/ws
```

Public routes:

```text
POST /studio/conversations/:conversationId/pause
POST /studio/conversations/:conversationId/resume
POST /studio/conversations/:conversationId/cancel
POST /studio/conversations/:conversationId/approvals/:approvalId/resolve
```

Forward to the matching execution-runtime routes under `/runs/:conversationId/...`.

## HTTP Streaming / SSE

Target public route:

```text
GET /studio/conversations/:conversationId/stream
```

This can land after the WebSocket route unless a frontend path needs it immediately.
It should stream Studio Runtime Protocol events or an SSE projection of the same event log.
Do not invent a second event vocabulary.

## OpenAI Adapter

Target public routes:

```text
POST /studio/adapters/openai/chat/completions
GET  /studio/adapters/openai/models
POST /studio/adapters/openai/audio/transcriptions
POST /studio/adapters/openai/audio/speech
...
```

Current routes under `/adapters/openai/v1/...` can remain as temporary aliases while the
frontend migrates, but new code should import from the split adapter files above and mount
under `/studio/adapters/openai/...`.

## Legacy Direct Agent Route

Current behavior:

```text
/agents/*
```

This is legacy/root-level AI routing. Do not expand it. Move frontend runtime traffic to:

```text
/studio/conversations/:conversationId/events
```

Then remove `/agents/*` forwarding after migration.

## Service Bindings Needed

The API worker should gain a binding for the new execution runtime:

```toml
[[services]]
binding = "EXECUTION_RUNTIME"
service = "studio-execution-runtime"
```

The existing `AI` binding remains only for legacy routes until migrated.

## Identity Flow

1. API validates JWT or trusted Cloudflare Access identity.
2. API checks revocation where applicable.
3. API injects `X-User-ID`.
4. Downstream workers enforce ownership using `X-User-ID`.

No downstream worker should trust a client-supplied `userId` body field over `X-User-ID`.

## First Implementation Slice

1. Add `EXECUTION_RUNTIME` binding to `api/wrangler.toml` and `api/src/types/index.ts`.
2. Add shared identity resolver under `api/src/identity/`.
3. Add shared proxy helpers under `api/src/proxy/`.
4. Add `studio/` modules for runs, conversations, streaming, and approvals.
5. Add a pre-Hono WebSocket dispatcher for `/studio/conversations/:conversationId/events`.
6. Keep legacy routes untouched until the new runtime route is verified.

## Reset State

As of 2026-07-11, the API entrypoint has been reset to mount only:

```text
GET /studio/system/health
GET /studio/system/status
```

Then the first Studio entrypoints were added:

```text
POST /studio/runs
GET  /studio/conversations/:conversationId/state
GET  /studio/conversations/:conversationId/events   WebSocket pre-Hono dispatcher
GET  /studio/conversations/:conversationId/stream   Placeholder, SSE pending
POST /studio/conversations/:conversationId/pause
POST /studio/conversations/:conversationId/resume
POST /studio/conversations/:conversationId/cancel
POST /studio/conversations/:conversationId/approvals/:approvalId/resolve

GET    /studio/data/conversations
POST   /studio/data/conversations
GET    /studio/data/conversations/:id
DELETE /studio/data/conversations/:id
GET    /studio/data/conversations/:id/messages
POST   /studio/data/conversations/:id/messages

POST   /studio/data/uploads
GET    /studio/data/uploads/:id
DELETE /studio/data/uploads/:id

GET    /studio/data/artifacts
POST   /studio/data/artifacts
GET    /studio/data/artifacts/:id
DELETE /studio/data/artifacts/:id
```

Legacy route files and old bindings were removed from the API project. The planner
runtime binding exists in API config but is not mounted yet.

## Conversation Persistence Status

Execution Runtime now performs a minimal best-effort Studio Data handoff after a run
completes:

```text
POST /conversations
POST /conversations/:conversationId/messages  user request
POST /conversations/:conversationId/messages  final assistant output
```

This does not freeze the final transcript format. Rich transcripts can later be derived
from the runtime event log and stored as conversation exports, message metadata, tool-call
records, or generated artifacts.
