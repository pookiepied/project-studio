# Studio Context

Assembles the information an agent runtime needs for one task and returns it as a
structured, compact, permission-aware context payload owned by this worker.

The Context worker answers: *What is relevant to this task? Which tools should be
exposed? Which skills should be loaded? Which agents can be delegated to? Which files,
memories, and prior events matter?* (The Registry answers what *exists* — see
ARCHITECTURE.md §20.)

## Consumers

Studio Execution Runtime, Studio Planner Runtime, Studio Agent Runtime, and other
authorized agent systems. Runtimes never search for capabilities themselves.

## Rules

- Retrieve only information belonging to the current user
- Return task-scoped `StudioToolDescriptor[]` entries; runtimes execute only the
  tools Context selected
- Select the relevant subset — never put every capability into every model request
- Skills load progressively: summaries by default, full instructions on activation
- Runtime prompts and optional execution limit profiles are selected here, not
  hardcoded into the execution loop. Undefined limits mean unlimited.

## Current Status

The worker refreshes platform metadata through Registry, loads enabled
connectors and MCP servers in parallel, and translates validated manifests into
runtime tool descriptors. Relevance ranking, data/artifact lookup, context-window
packing, caching, summarization, and skills remain pending.

## Structure

```
src/
  index.ts        Worker entry
  server/         HTTP surface
  builders/       One builder per context layer (ARCHITECTURE.md §19):
                  conversation, connectors, mcp, skills, agents, user, project
  assembly/       Combines builder outputs into the final ContextPackage
  system/         Env bindings
```
