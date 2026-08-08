# Studio Context Engine

The Context Engine assembles user-scoped runtime context for Studio agent loops.
It gathers memory, agent configuration, conversation, artifact, attachment, and
other contextual signals, then returns a deterministic projection for the
requesting runtime.

It does not execute tools. Tool calls are still routed through the Tool
Execution Worker after a model selects a specific tool.

## Responsibilities

- Request a compact default tool projection from Studio Tool Pool.
- Combine stable context with dynamic request context such as memory,
  model transcript slices, context references, attachments, and the latest user
  message.
- Produce compact sendable projections for Execution Runtime, Planner Runtime,
  and Agent Runtime.
- Include Tool Pool's small default tool tier with full schemas.
- Include Tool Pool's lightweight capability summaries for non-default
  capabilities.
- Keep `/expand-tool` as a compatibility proxy to Tool Pool discovery. New
  runtimes should call Tool Pool directly for `discover_tools` and
  `resolve_tool`.
- Inject memory categories such as `recent_memory` and `user_profile`.
- Keep output deterministic so provider-side prompt caching can reuse stable
  prefixes.
- Maintain scoped warm cache entries and durable context assembly records in
  Context Engine-owned storage.

## API

- `POST /context` - compatibility route for current runtimes.
- `POST /context-engine` - canonical Context Engine projection route.
- `POST /expand-tool` - compatibility proxy to Tool Pool discovery.
- `POST /cache/invalidate` - invalidates scoped warm cache entries.
- `POST /cache/warm` - prebuilds a scoped stable capability snapshot.
- `GET /health` - health check.

## Sendable Section Order

The runtime owns the base system prompt and agent loop. Context Engine supplies
the rest of the prompt-adjacent package in this deterministic order:

1. `capability_catalog` - stable lightweight capability summaries.
2. `default_tools` - stable full schemas for the small default tool tier.
3. `user_profile` - semi-stable user facts and preferences.
4. `recent_memory` - semi-stable relevant memory.
5. `model_transcript` - dynamic transcript projection from Studio Data.
6. `context_references` - dynamic references to artifacts, attachments, and
   retrieved context.
7. `resolved_resources` - resolved artifact and attachment metadata plus safe
   provider-neutral text snippets when the payload is text-like and small enough
   to include.
8. `current_message` - the current user request.

Provider-specific adapters should preserve this ordering so stable prefix
sections remain cache-friendly while dynamic turn data stays near the end.

## Structure

```text
src/
  assembly/       Coordinates builders, Tool Pool projection, and state records.
  builders/       Domain fetchers for MCP, connectors, conversation, memory,
                  project, skills, and agents.
  cache/          Scoped warm cache for context snapshots.
  expansion/      Compatibility proxy to Tool Pool discovery.
  projection/     Sendable context shape.
  state/          Context Engine-owned durable assembly/baseline records.
  toolPool/       Tool Pool service-binding client.
  server/         HTTP routes.
  system/         Worker bindings.
```

## Current limits

This worker now separates context construction from callable capability
discovery. Studio Data owns canonical transcript/projection data. Tool Pool owns
tool discovery and materialization. Context Engine owns only internal
context-construction state such as assembly records, baselines, and future
compaction snapshots.
