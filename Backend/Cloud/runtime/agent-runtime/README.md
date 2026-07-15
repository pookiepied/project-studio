# Studio Agent Runtime

Executes registered `AgentDefinition` records: loads the definition from the
Registry, resolves the model, applies the system prompt and permissions, loads
the initial context via Studio Context Engine, resolves callable capabilities
through Studio Tool Pool, runs the agent loop,
enforces limits, and returns a structured result to the requesting user or
parent agent.

## Architecture Decision

This worker is a separate deployable and owns its local durable `RuntimeSession`
implementation. `AgentSession` (`src/session/`) subclasses it and specializes
three points: `composeSystemPrompt`, `gateTools`, and `finalize`.

`src/engine/config.ts` maps an `AgentDefinition` and delegation request into
runtime inputs such as model, limits, and narrowed permissions. State machine,
checkpoints, recovery, and streaming behavior remain local to this worker.

## Status

Implemented: local runtime session scaffold, Context Engine handoff, direct Tool
Pool discovery/resolve, delegated agent configuration mapping, default tool
gating, Tool Execution Worker dispatch, and Studio Data transcript-event
persistence.

Still pending: real delegated model loop, agent definition loading from the final
Agent Library/Registry boundary, report-back storage, streaming, checkpoint
recovery, and provider-neutral request building.

## Must Not

- Duplicate another worker's implementation by importing its source code.
- Grant a delegated agent the parent's full conversation or toolset.
- Store agent definitions. That remains the Registry and Agent Library boundary.

## Structure

```text
src/
  index.ts        Worker entry.
  server/         HTTP surface for invoke and delegation.
  engine/         Configuration layer over the local runtime session.
  system/         Env bindings.
```
