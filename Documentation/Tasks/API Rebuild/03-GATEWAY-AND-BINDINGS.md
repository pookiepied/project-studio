# API Gateway and Worker Binding Policy

Date: 2026-07-11

The API worker is the public transport edge for Studio. It can talk to multiple internal
workers through service bindings, but it must not become the place where domain logic
lives.

## Recommended Model

Use the API worker as a thin facade:

```text
Client
  -> API worker: auth, CORS, request limits, identity injection, stable routes
  -> Domain worker: Execution Runtime, Data, Registry, Context, Integrations, Gateway
```

This means the API worker may have bindings to several workers:

```text
EXECUTION_RUNTIME
PLANNER_RUNTIME
DATA
REGISTRY
CONTEXT
INTEGRATIONS
GATEWAY
TRACKER
SYSTEM / UPDATES
```

That is acceptable because service bindings are a transport mechanism. The risk is not
"many bindings"; the risk is the API worker learning too much and doing the workers'
jobs.

## API Worker May Do

- Authenticate the public request.
- Check token revocation.
- Inject `X-User-ID`.
- Enforce request size / method / content-type rules.
- Forward HTTP requests.
- Forward WebSocket upgrades.
- Normalize public error envelopes.
- Preserve stable external route names while internals move.

## API Worker Must Not Do

- Build context packages.
- Search registries or decide which tools exist.
- Read/write artifact bytes directly when Studio Data owns that.
- Execute tools.
- Run agent loops.
- Decide permissions.
- Implement provider/model routing.
- Store conversations.

## Example: Uploads

Public route:

```text
POST /studio/uploads
```

API responsibility:

1. Authenticate.
2. Inject `X-User-ID`.
3. Forward body/metadata to Studio Data or an Upload/Data worker.
4. Return the worker response.

Data worker responsibility:

1. Validate upload ownership.
2. Store bytes in R2.
3. Write metadata.
4. Return an upload/artifact reference.

API should not directly choose R2 keys, mutate upload metadata, or build context around
the uploaded file.

## Example: Runtime WebSocket

Public route:

```text
GET /studio/conversations/:conversationId/events
```

API responsibility:

1. Authenticate.
2. Inject `X-User-ID`.
3. Forward the WebSocket upgrade to Execution Runtime.

Execution Runtime responsibility:

1. Check that `X-User-ID` owns the conversation/run.
2. Send snapshot/replay/live Studio Runtime Protocol events.
3. Persist events before broadcast.

## Example: Context

Public route:

```text
POST /studio/context/preview
```

API responsibility:

1. Authenticate.
2. Inject `X-User-ID`.
3. Forward to Studio Context.

Context worker responsibility:

1. Ask Registry/Data for relevant inputs.
2. Pack/summarize/select context.
3. Return a `ContextPackage` or preview.

Normal execution should not require the frontend to call Context directly. Execution
Runtime asks Context internally for the package it needs.

## When Not to Bind Directly

Avoid direct API bindings only when:

- the worker is not a public product capability;
- calls should only happen from another internal worker;
- the public route would expose confusing internal concepts;
- the API would need to coordinate a multi-worker transaction.

In those cases, route through the owning domain worker. Example: a run should not require
the API to call Registry, Context, and Data in sequence. API forwards to Execution
Runtime; Execution Runtime asks Context; Context asks Registry/Data.

## Final Rule

Current first-slice API bindings:

```text
EXECUTION_RUNTIME
PLANNER_RUNTIME     configured but not mounted yet
DATA
REVOKED_KV
```

Many bindings are fine. Many responsibilities are not.
