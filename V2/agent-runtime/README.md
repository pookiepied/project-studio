# Studio Agent Runtime

Executes registered `AgentDefinition` records (see `@studio/v2-contracts`): loads the
definition from the Registry, resolves the model, applies the system prompt and
permissions, loads the permitted toolset and skills via Studio Context, runs the agent
loop, enforces limits, and returns a structured result to the requesting user or
parent agent (delegation — ARCHITECTURE.md §17).

## Open architecture question (decision #3)

Whether this remains a separate worker or reuses Studio Execution Runtime's engine is
unresolved. The guiding principle: **do not build a second agent engine** — prefer one
reusable execution engine with different runtime configurations. `src/engine/` is
written as a configuration layer over a shared engine for exactly that reason. If the
decision lands on "execute inside Execution Runtime", this worker folds into it.

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
