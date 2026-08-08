# Studio Execution Runtime

Studio's main cloud execution worker runs the reasoning-and-action loop for
cloud conversations and cloud-safe tool execution. Coding-harness behavior,
local files, terminal execution, and repository edits are reserved for the
future local runtime.

## Responsibilities

- Receive user requests and run the main execution loop.
- Call models through Gateway (`GATEWAY` service binding), never direct providers.
- Receive model-facing context from Studio Context Engine (`CONTEXT` binding).
- Start with default tools supplied through Context Engine's Tool Pool projection.
- Call Studio Tool Pool directly for dynamic tool discovery and schema materialization.
- Execute selected tools through Studio Tool Execution Worker.
- Persist runtime transcript events through Studio Data.
- Own durable, resumable execution state through the `ExecutionSession` Durable Object.

## Must NOT

- Manage registries or own callable discovery; Registry and Tool Pool own that.
- Manually assemble model context; Context Engine owns that.
- Store conversations, uploads, or artifacts; Studio Data owns that.
- Execute selected tools directly when a service owns them; Tool Execution routes them.
- Implement provider logic; Gateway owns provider access.

## Runtime Flow

1. `POST /runs` routes to the conversation's `ExecutionSession` Durable Object.
2. The runtime persists `run.started` and user-message transcript events.
3. The runtime asks Context Engine for a `ContextPackage`.
4. Context Engine reads canonical transcript/projection data from Studio Data and a default tool projection from Tool Pool.
5. The runtime sends the model the prepared context and default materialized tools.
6. If the model calls `discover_tools`, the runtime calls Tool Pool `/discover`.
7. If the model calls `resolve_tool`, the runtime calls Tool Pool `/resolve` and stores returned tool descriptors in the active run state.
8. When the model calls a materialized non-client tool, the runtime sends that explicit call to Tool Execution Worker.
9. Tool results are persisted back to Studio Data as transcript events and returned to the model loop.
10. The final assistant output is persisted as an assistant transcript event.

## Status

Implemented: Durable Object run state, Context Engine handoff, default tool
registration, direct Tool Pool discovery/resolve, active resolved-tool caching,
Tool Execution Worker dispatch for explicit tool calls, local runtime event
storage, and Studio Data transcript-event persistence.

Still pending: real model loop/Gateway invocation, provider-neutral request
builder, streaming, checkpoint recovery, approval parking, frontend gap
detection, artifact-aware message parts, and end-to-end browser integration.

