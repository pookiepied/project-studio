# Studio Tool Execution Worker

The Tool Execution Worker is the centralized entry point for model-generated
tool calls. It does not replace the main agent loop and does not own every
tool's business logic.

Flow:

1. Execution Runtime receives a user request and runs the main agent loop.
2. Context Worker prepares context and visible tool definitions.
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
  request to the resolved endpoint.

Native tools, memory, local relay, and connector dispatch routes are explicit
placeholders until their target services expose stable contracts.
