# Studio Agent Runtime

Executes registered `AgentDefinition` records: loads the
definition from the Registry, resolves the model, applies the system prompt and
permissions, loads the permitted toolset and skills via Studio Context, runs the agent
loop, enforces limits, and returns a structured result to the requesting user or
parent agent (delegation — ARCHITECTURE.md §17).

## Architecture decision #3 — resolved: reuse the shared engine

This worker is a separate deployable, but it does **not** contain its own loop. It runs
on its local durable `RuntimeSession` engine. `AgentSession` (`src/session/`)
subclasses it and specializes three points:
`composeSystemPrompt` (the agent's prompt/personality/output format), `gateTools` (the
agent's permission allowlist + read/write gate), and `finalize` (store a
`DelegationResult`). `src/engine/config.ts` is the pure configuration layer that maps an
`AgentDefinition` + delegation request into engine inputs (model, limits, narrowed
permissions). State machine, checkpoints, recovery, and streaming are inherited, so a
correctness fix in the engine lands here for free.

## Must NOT

- Duplicate the Execution Runtime's loop implementation
- Grant a delegated agent the parent's full conversation or toolset
- Store agent definitions (Registry's job)

## Structure

```
src/
  index.ts        Worker entry
  server/         HTTP surface (invoke, delegation)
  engine/         Configuration layer over the shared execution engine
  system/         Env bindings
```
