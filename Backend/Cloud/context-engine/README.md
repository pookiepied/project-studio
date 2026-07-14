# Studio Context Engine

The Context Engine assembles user-scoped runtime context for Studio agent loops.
It gathers registry, memory, connector, skill, MCP, agent, conversation, and
workspace signals, then returns a deterministic projection for the requesting
runtime.

It does not execute tools. Tool calls are still routed through the Tool
Execution Worker after a model selects a specific tool.

## Responsibilities

- Build a normalized internal capability snapshot for the current user,
  workspace, agent, and runtime.
- Combine that stable snapshot with dynamic request context such as memory,
  conversation history, attachments, and the latest user message.
- Produce compact sendable projections for Execution Runtime, Planner Runtime,
  and Agent Runtime.
- Include a small default tool tier with full schemas.
- Include lightweight capability summaries for non-default capabilities.
- Support `expand_tool` as a runtime-internal capability so runtimes can request
  complete schemas on demand without routing through Tool Execution.
- Inject memory categories such as `recent_memory` and `user_profile`.
- Keep output deterministic so provider-side prompt caching can reuse stable
  prefixes.
- Maintain scoped warm cache entries and support explicit invalidation.

## API

- `POST /context` - compatibility route for current runtimes.
- `POST /context-engine` - canonical Context Engine projection route.
- `POST /expand-tool` - expands summarized capabilities into full schemas or
  detailed metadata.
- `POST /cache/invalidate` - invalidates scoped warm cache entries.
- `POST /cache/warm` - prebuilds a scoped stable capability snapshot.
- `GET /health` - health check.

## Structure

```text
src/
  assembly/       Coordinates builders and cache.
  builders/       Domain fetchers for MCP, connectors, conversation, memory,
                  project, skills, and agents.
  cache/          Scoped warm cache for stable capability snapshots.
  expansion/      On-demand capability expansion.
  projection/     Default tools, capability catalog, sendable context shape.
  server/         HTTP routes.
  system/         Worker bindings.
```

## Current limits

This worker now separates stable capability snapshots from dynamic turn context.
Cache invalidation and warming are exposed as APIs and use local warm cache for
now, not yet a cross-worker event bus or durable cache. Native tools, connector
status, and memory freshness will become more accurate as those services mature.
