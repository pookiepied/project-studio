# Studio Execution Runtime

Studio's main agent execution worker — the primary replacement for the `chat` service.
Runs the reasoning-and-action loop for conversations, tool execution, coding tasks,
file operations, research, and other general-purpose work.

## Responsibilities

- Receive user requests and run the main agent loop (ReAct-style)
- Call models through Gateway v2 (`GATEWAY` service binding) — never direct providers
- Stream output and reasoning states to clients
- Perform tool calls, including parallel tool calls, across multi-step tasks
- Receive its context package from Studio Context (`CONTEXT` binding)
- Invoke task-scoped tools selected by Studio Context, including connectors,
  native cloud tools, remote MCP tools, and eventually local relay tools
- Report progress; handle retries and failures; return final results
- Own durable, resumable execution state via the `ExecutionSession` Durable Object

## Must NOT

- Manage registries or discover integrations (Studio Registry's job)
- Manually assemble context (Studio Context's job)
- Store conversations, uploads, or artifacts itself (Studio Data's job)
- Implement provider logic (Gateway v2's job)

## Structure

```
src/
  index.ts        Worker entry: Hono app + ExecutionSession export
  server/         HTTP/WebSocket surface (routes, middleware)
  agent/          loop.ts (AI SDK step loop), lifecycle.ts (transition/retry/stall
                  rules), tools.ts (context -> ToolSet boundary, policy,
                  idempotency, approvals, timeout/result limits)
  state/          ExecutionSession DO + SessionStore (SQLite event log, run
                  projection, checkpoints, operation and approval records)
  gateway/        AI SDK openai-compatible provider over the GATEWAY binding
  streaming/      WebSocket message shapes and broadcast (views over the log)
  system/         Env bindings, error taxonomy
```

## How execution works

1. `POST /runs` routes to the conversation's `ExecutionSession` DO. The DO rejects
   a second active run (single-threaded duplicate guard) and starts the loop.
2. Every event is appended to the SQLite event log **before** any WebSocket
   broadcast — the log is the source of truth, connections are views.
3. Before the loop starts, the runtime asks Studio Context for a `ContextPackage`.
   The runtime consumes the supplied prompt/history/tool package/limit profile; it
   does not scan registries, buckets, uploads, or conversation storage itself.
4. Before every model attempt and after each completed step, the message history
   and checkpoint metadata are persisted. Recovery and resume restore from the
   latest checkpoint (hybrid model: log + checkpoints).
5. Context supplies `tools: StudioToolDescriptor[]`. The runtime converts those
   descriptors into AI SDK tools. It does not discover connectors, MCP servers,
   or skills by itself.
6. Every exposed tool passes through the runtime wrapper. The wrapper atomically
   reserves the operation, enforces the tool policy, parks for frontend approval
   when required, clamps large results, and refuses unsafe replay of
   non-idempotent side effects after a crash.
7. Approval is a permission boundary, not a runtime decision: the runtime emits
   `approval.required`, waits for the frontend/parent verdict, records exactly
   one resolution, and resumes from durable state if the DO restarted while
   parked.
8. Runtime limits are optional. Undefined means unlimited; configured limits are
   safety rails for a specific mode/agent/task, not product caps.
9. An alarm-driven watchdog re-arms every 30s while a run is active: it restarts
   the loop from checkpoint if the DO was evicted, aborts stalled runs (120s
   without progress), and applies exponential-backoff retries (max 3) before
   failing with a summary.
10. Clients reconnect with `?lastSeq=N` or a `subscribe` frame and receive a
   snapshot + replay. Cloud runs keep executing with zero clients connected.

## Tool Sources

Studio uses product-facing names for what the user sees and runtime-facing names
for how calls execute:

- `connector`: app integrations such as Gmail, Drive, Slack, Calendar, and Docs.
  These are Composio-backed internally, but the product/runtime contract calls
  them connectors. Execution goes through the Studio MCP hub.
- `native-cloud`: first-party hosted MCP services, such as memory, web/search/RAG,
  HTTP fetch, image/video generation, YouTube transcript, and skills. Execution
  goes through the Studio MCP hub's native-service endpoint.
- `user-mcp`: user-installed remote MCP servers. Execution goes through the Studio
  MCP hub remote endpoint.
- `native-local`: bundled desktop MCP servers, currently Studio Harness and
  Computer Use. These require the local relay/result protocol because the cloud
  runtime cannot directly touch local files or desktop state.
- `client`: rare frontend-native actions, such as updating visible UI state.

Connector, native-cloud, and remote MCP descriptors resolve through the MCP hub.
Local relay descriptors emit durable external-tool requests, park the run, and
resume when the authenticated desktop resolver returns the Tauri MCP result.
Client-native actions remain deferred.

## Status

Implemented: granular run state machine, Studio Runtime Protocol event log,
WebSocket replay/ack/snapshot flow, checkpoint recovery, cancellation,
submission idempotency, tool-operation idempotency, approval parking/resolution,
runtime-side Context handoff, optional execution limit observation/enforcement,
gateway client, lifecycle rules, and watchdog recovery.

Next runtime-owned work: richer tool-boundary checkpoints and client-native
actions. Still pending outside or at the surface: Context relevance ranking and
packing/caching, cost accounting source, and frontend/client gap detection.
