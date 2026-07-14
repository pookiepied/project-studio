# Studio Agent Runtime

Executes registered `AgentDefinition` records: loads the definition from the
Registry, resolves the model, applies the system prompt and permissions, loads
the permitted toolset and skills via Studio Context Engine, runs the agent loop,
enforces limits, and returns a structured result to the requesting user or
parent agent.

## Architecture Decision

This worker is a separate deployable and owns its local durable `RuntimeSession`
implementation. `AgentSession` (`src/session/`) subclasses it and specializes
three points: `composeSystemPrompt`, `gateTools`, and `finalize`.

`src/engine/config.ts` maps an `AgentDefinition` and delegation request into
runtime inputs such as model, limits, and narrowed permissions. State machine,
checkpoints, recovery, and streaming behavior remain local to this worker.

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
