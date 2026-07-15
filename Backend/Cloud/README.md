# Studio Cloud Backend

This folder contains Studio's cloud worker architecture. The cloud product is
intentionally smaller than the future local/coding runtime: it supports normal
conversation, text and vision input, uploaded files, connectors, web search,
image generation, artifacts, memory, tool discovery, and cloud agent execution.
It does not directly access local files, edit repositories, run terminal
commands, or perform coding-harness operations.

## Workers

| Folder | Worker | Responsibility |
| --- | --- | --- |
| `gateways/gateway/` | Studio Gateway | Provider routing and model access |
| `data/` | Studio Data | User-owned conversations, transcript events/projections, uploads, artifacts, object metadata |
| `context-engine/` | Studio Context Engine | Model-facing context construction and internal context baseline/snapshot state |
| `tool-pool/` | Studio Tool Pool | Callable capability discovery, filtering, default tool projection, and lazy schema materialization |
| `tool-execution/` | Studio Tool Execution Worker | On-demand execution/routing for explicit selected tool calls |
| `registry/` | Studio Cloud Library Registry | System/user-scoped registrations for skills, MCP servers, and agents |
| `skill-library/` | Studio Cloud Skill Library | Full skill definitions in portable `SKILL.md` format |
| `mcp-library/` | Studio Cloud MCP Library | Cloud MCP server definitions |
| `agent-library/` | Studio Cloud Agent Library | Full cloud agent definitions |
| `runtime/execution-runtime/` | Studio Execution Runtime | Main cloud agent loop |
| `runtime/planner-runtime/` | Studio Planner Runtime | Planning loop |
| `runtime/agent-runtime/` | Studio Agent Runtime | Generic sub-agent execution loop |
| `connectors/` | Studio Connectors | User connector authorization and connector metadata |
| `tracker/` | Studio Tracker | Usage and telemetry ingestion/querying |

## Ownership

- Studio Data owns canonical user-facing conversation state.
- Context Engine owns context construction and internal baseline/snapshot state.
- Tool Pool owns callable capability discovery and materialization.
- Tool Execution owns explicit selected tool execution.
- Runtimes own agent loops and active run state.
- Gateway owns provider access.
- Workers share contracts over APIs/service bindings, not implementation code.

## Current Status

Cloud runtime foundation is in progress. Studio Data has revision-aware
conversation events and active projections. Context Engine consumes Studio Data
and Tool Pool. Tool Pool is scaffolded as a separate worker. Runtimes can call
Tool Pool for discovery/materialization and Tool Execution for selected calls.

Still pending: real model loop/Gateway invocation, full artifact-aware message
parts, frontend integration, streaming, checkpoint recovery, and full
end-to-end verification.

