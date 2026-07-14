# Studio Version 2

Version 2 is an architecture modernization phase, not a public release. The overloaded
`chat` worker is being replaced by focused workers with clear boundaries. The full plan
lives in [ARCHITECTURE.md](ARCHITECTURE.md).

## Workers

| Folder | Worker | Responsibility |
| --- | --- | --- |
| `execution-runtime/` | Studio Execution Runtime | Main agent loop: model calls, streaming, tool execution, multi-step tasks, resumable runs |
| `planner-runtime/` | Studio Planner Runtime | Planning loop with read-only access; produces structured plans for the execution runtime |
| `registry/` | Studio Cloud Library Registry | Cloud-only registry for MCP servers, skills, and agents (user-scoped) |
| `agent-library/` | Studio Cloud Agent Library | Stores and resolves full cloud agent definitions for Agent Runtime |
| `skill-library/` | Studio Cloud Skill Library | Stores and resolves full cloud skill definitions in Anthropic skill format |
| `mcp-library/` | Studio Cloud MCP Library | Stores discoverable cloud MCP server definitions |
| `context/` | Studio Context | Assembles task-specific context packages for agent runtimes |
| `agent-runtime/` | Studio Agent Runtime | Executes user-created and Studio-provided agent definitions |
| `data/` | Studio Data | User-owned content: conversations, uploads, generated artifacts, object storage |

Existing services (Gateway, auth, API, tracking) continue to operate
alongside these workers. All model access goes through Gateway — no worker in V2
implements its own provider logic.

## Principles

- **Separation of responsibility.** Execution executes, planning plans, the agent,
  skill, and MCP libraries store full definitions, the cloud library registry
  tracks resource registrations, context decides what is relevant, data manages
  user content.
- **User isolation.** Every registry and context query is scoped to a single user.
- **Stable interfaces.** Workers communicate through explicit APIs, service
  bindings, and locally owned request/response schemas, not by importing another
  worker's implementation.
- **SDKs behind abstractions.** Open decision #1 is resolved (2026-07-11): the Vercel
  AI SDK handles model interaction inside a step (streaming, tools, structured output);
  the state/session layer is custom, built directly on Durable Objects (storage, alarms,
  WebSocket hibernation) — the Cloudflare Agents SDK is not used. Both sides stay behind
  Studio-owned interfaces and plain contract types.

## Status

Phase 1–2 scaffold: boundaries, folder structure, typed stubs. No production logic yet.
