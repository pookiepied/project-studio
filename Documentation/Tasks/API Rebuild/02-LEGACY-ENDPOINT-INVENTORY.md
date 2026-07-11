# Legacy API Endpoint Inventory

Date: 2026-07-11

This inventory records the API routes that existed before the Studio API rebuild. They
should not be expanded. New public routes should be added under the `/studio` product
namespace after the new structure is in place.

## Root / Legacy Direct Routing

```text
/agents/*
```

Directly forwarded to the legacy `studio-chat` worker before Hono routing. This should be
replaced by `/studio/conversations/:conversationId/events`.

## Health / Status

```text
GET /health
GET /system/status
```

Target replacement:

```text
GET /studio/system/health
GET /studio/system/status
```

## OpenAI Adapter / Legacy AI Surface

```text
POST /adapters/openai/v1/chat/completions
GET  /adapters/openai/v1/modes
GET  /adapters/openai/v1/models
*    /adapters/openai/v1/admin/*
POST /adapters/openai/v1/audio/transcriptions
POST /adapters/openai/v1/audio/speech
GET  /adapters/openai/v1/mcp/catalog
GET  /adapters/openai/v1/mcp/servers
POST /adapters/openai/v1/mcp/servers
POST /adapters/openai/v1/mcp/sync/:name
PATCH /adapters/openai/v1/mcp/servers/:name
DELETE /adapters/openai/v1/mcp/servers/:name
GET  /adapters/openai/v1/composio/apps
GET  /adapters/openai/v1/composio/connections
POST /adapters/openai/v1/composio/connect
PATCH /adapters/openai/v1/composio/connections/:id
DELETE /adapters/openai/v1/composio/connections/:id
DELETE /adapters/openai/v1/composio/apps/cache
GET  /adapters/openai/v1/composio/apps/config
PUT  /adapters/openai/v1/composio/apps/config
DELETE /adapters/openai/v1/composio/apps/config/cache
GET  /adapters/openai/v1/user/chats/:path
HEAD /adapters/openai/v1/user/chats/:path
PUT  /adapters/openai/v1/user/chats/:path
DELETE /adapters/openai/v1/user/chats/:path
GET  /adapters/openai/v1/images/:id
DELETE /adapters/openai/v1/images/:id
GET  /adapters/openai/v1/tracking/summary
GET  /adapters/openai/v1/tracking/usage
GET  /adapters/openai/v1/tracking/logs
GET  /adapters/openai/v1/tracking/credits
GET  /adapters/openai/v1/tracking/me
POST /adapters/openai/v1/docs/index
POST /adapters/openai/v1/local/chat/save
POST /adapters/openai/v1/local/tool/execute
GET  /adapters/openai/v1/user/memories
DELETE /adapters/openai/v1/user/memories/:id
```

Target replacement starts at:

```text
/studio/adapters/openai/...
```

Native Studio runtime sessions do not belong in the OpenAI adapter namespace.

## Connectors / Preferences / Skills

```text
*    /adapters/openai/v1/connectors/*
GET  /adapters/openai/v1/user/preferences
PUT  /adapters/openai/v1/user/preferences
GET  /v1/skills
GET  /v1/skills/index
GET  /v1/skills/:key
GET  /v1/skills/search
POST /v1/skills/validate
POST /v1/skills/install-plan
POST /v1/skills/local
DELETE /v1/skills/local/:key
POST /v1/skills/local/:key/heartbeat
```

Target replacement:

```text
/studio/integrations/...
/studio/registry/skills/...
/studio/preferences/...
```

Exact ownership depends on Registry, Context, and Integrations boundaries.

## Jobs / Tasks / Engine

```text
POST /run
GET  /jobs
GET  /jobs/:id
DELETE /jobs/:id
GET  /tasks
GET  /internal/jobs/next
POST /internal/jobs/:id/result
POST /internal/jobs/:id/heartbeat
POST /internal/jobs/:id/progress
POST /internal/tasks/register
```

This is legacy job-engine infrastructure. The target design should decide whether any
part remains public, moves to Agent Runtime scheduling, or is removed.

## Tracker

```text
GET /tracker/events
GET /tracker/runs
GET /tracker/runs/:runId
GET /tracker/summary
GET /tracker/tail-events
GET /tracker/usage/summary
GET /tracker/usage/data
GET /tracker/usage/logs
GET /tracker/usage/credits
```

Target replacement:

```text
/studio/usage/...
/studio/system/telemetry/...
```

## Updates / Releases

```text
GET /v1/updates/latest
GET /v1/releases/*
```

Target replacement:

```text
/studio/system/updates/latest
/studio/system/releases/*
```

## Current Bindings

```text
AI              legacy studio-chat
GATEWAY         studio-gateway
CHATS_SERVICE   chats
STUDIO          studio
CONNECTORS      connectors
SKILLS          studio-skills
TRACKER         tracker
DB              studio-jobs D1
KV              API KV
REVOKED_KV      token revocation
RELEASES_KV     update manifests
RELEASES_BUCKET release files
```

The rebuilt API may still bind to multiple workers. That is acceptable if the API remains
a transport/auth facade and does not absorb domain logic.
