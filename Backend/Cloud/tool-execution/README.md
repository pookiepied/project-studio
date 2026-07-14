# Studio Tool Execution Worker

The Tool Execution Worker is the centralized entry point for model-generated
tool calls. It does not replace the main agent loop and does not own every
tool's business logic.

Flow:

1. Execution Runtime receives a user request and runs the main agent loop.
2. Context Engine prepares context and visible tool definitions.
3. The model returns a tool call.
4. Execution Runtime sends the explicit tool call to this worker.
5. Tool Execution Worker validates, resolves, dispatches, tracks, and normalizes
   the result.
6. The owning runtime or service performs the actual work.
7. Execution Runtime adds the tool result back to the agent loop.

The worker is user-scoped and stateless. Every call is recorded in D1 using
user, session, conversation, agent execution, tool-call, and job identifiers so
parallel requests from different users or conversations remain isolated.

Current dispatch support:

- `agent-runtime`: forwards supported delegated-agent calls to Agent Runtime.
- `skill-library`: supports bundled system skill listing/search/read.
- `mcp-server` / `remote-mcp`: sends a standard MCP `tools/call` JSON-RPC
  request to HTTP(S) endpoints.
- Studio service-bound MCP facades: dispatches `studio-agent-execution-mcp`
  tools to Agent Runtime and `studio-skill-library-mcp` tools to Skill Library.
- MCP registry lookup: when a route is not supplied, the worker can resolve an
  active registered MCP tool by its namespaced tool name.

Native tools, memory, local relay, and connector dispatch routes are explicit
placeholders until their target services expose stable contracts.

## Runtime Access

Execution Runtime, Planner Runtime, and Agent Runtime each bind this worker as
`TOOL_EXECUTION`. Their runtime session bases expose local helper methods for:

- a single scoped tool call
- a batch of independent scoped tool calls

Every request carries the caller's `userId`, optional `workspaceId`,
`sessionId`, `conversationId`, optional `agentId`, optional
`agentExecutionId`, `toolCallId`, and idempotency key. The Tool Execution Worker
records those values in D1 and never stores process-global execution state.

The current runtime loops are still model-loop scaffolds, so these helpers are
the integration point used when actual model tool-call handling is implemented.

Each runtime also exposes authenticated session proxy routes for exercising the
same path:

- Execution Runtime: `POST /runs/:conversationId/tools/execute`
- Execution Runtime: `POST /runs/:conversationId/tools/execute/batch`
- Planner Runtime: `POST /plans/:conversationId/tools/execute`
- Planner Runtime: `POST /plans/:conversationId/tools/execute/batch`
- Agent Runtime: `POST /invoke/:agentId/:conversationId/tools/execute`
- Agent Runtime: `POST /invoke/:agentId/:conversationId/tools/execute/batch`

The runtime session reloads its current Context package, gates the visible tools
for that runtime, and only forwards calls for tools present in that gated set.
The Tool Execution Worker then performs destination dispatch and job tracking.
