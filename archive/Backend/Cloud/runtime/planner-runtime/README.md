# Studio Planner Runtime

A separate agent loop designed for planning rather than execution. Investigates the
project or environment, identifies requirements and risks, breaks work into phases,
and produces structured `Plan` records for the
Studio Execution Runtime to act on.

## Responsibilities

- Understand the user's goal; ask necessary clarifying questions
- Investigate the environment: read files, documentation, limited research
- Identify requirements, constraints, risks, and dependencies
- Break work into phases and produce implementation plans
- Prepare structured instructions for Studio Execution Runtime

## Must NOT

- Modify files, execute destructive actions, or make permanent system changes —
  the planner operates with **read-only access by default** (enforced in
  `src/tools/readonly.ts`)
- Execute plans (Execution Runtime's job)
- Own callable capability discovery (Registry/Tool Pool's job)

## Open decision

The loop model — custom planning loop, ReAct with read-only tools, staged workflow,
or hybrid — is open decision #2 and is decided after these boundaries are stable.

## Status

Implemented: Durable Object run state, Context Engine handoff, direct Tool Pool
discovery/resolve, read-only tool gating, plan finalization scaffold, and Studio
Data transcript-event persistence.

Still pending: real planning model loop, provider-neutral request builder,
streaming, checkpoint recovery, approval flow, and richer plan-to-execution
handoff.

## Structure

```
src/
  index.ts        Worker entry
  server/         HTTP surface
  planner/        The planning loop and plan assembly
  tools/          Read-only tool policy
  system/         Env bindings
```
