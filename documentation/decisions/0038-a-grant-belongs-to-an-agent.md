# ADR 0038: A Grant Belongs To An Agent

Status: Accepted

**Builds on:** ADR 0015 (how wide an approval is), ADR 0021 (a grant belongs to
a project), ADR 0030 (local execution identity).

## Context

`ExecutionScope` carries three identities that a stored grant is filtered by:
`agentId`, `conversationId`, and `projectId`. The `permission_grant` table has
a column for each. The contract's own comment says what the first one is for:

> The agent making the call. A subagent runs under its own identity so its
> grants cannot be inherited from the parent by accident.

It was not carrying an agent. `agents/studio.ts` passed Flue's initializer `id`
as `agentId`, and that `id` is the agent **instance** — one per conversation
thread. Flue's own type says so (`FlueEventContext.id`: "stable agent instance
id during agent processing"), and it was measured before being acted on: a
probe in the initializer, run against a live harness across two threads,
reported `alpha` and `beta` rather than `studio`.

`conversationId` then defaulted to `` `conversation:${agentId}` ``, so both
fields held the same thing. Three columns, two of them the same identity, and
no agent dimension at all.

The consequence is in `grant-store.ts`: the lookup filters on `agent_id`, so a
`duration: "always"` grant was unreachable from any conversation other than the
one that created it. ADR 0015 keeps breadth and duration independent so that
"for now" and "from now on" are separable answers. They were not separable —
`always` and `conversation` were one answer wearing two labels.

This **fails closed**. The user is asked again; nothing is authorized that was
not approved. So it is a correctness and approval-fatigue defect, not a
security one, and it is recorded as #69 rather than as an incident.

An earlier reading of the same code (#68, withdrawn) concluded the opposite —
that all conversations shared one scope. It was wrong because it was read from
a default expression instead of measured. Both directions of this mistake come
from the same habit, which is why the measurement is written down here.

## Decision

### The agent is named; the thread is the conversation

`STUDIO_AGENT_ID` in `contracts/agents.ts` is what an agent is called.
`agents/studio.ts` passes it as `agentId` and passes Flue's `id` as
`conversationId`. The three columns now mean three different things, and
`always` reaches every conversation of one agent in one project.

There is one agent today, so the two readings of `agentId` produce identical
behaviour and nothing would have caught the confusion coming back. That is the
argument for a named constant and a test rather than an inline string.

### `conversationId` is required, with no default

The old default made a conversation identity out of an agent identity. Left in
place it would now be actively unsafe in the other direction: with `agentId`
correctly holding "studio", a caller omitting `conversationId` would collapse
every conversation of that agent into one permission scope, and a grant given
in one would apply silently in all of them.

Removing the default makes the caller state which conversation it is. This is
ADR 0015's reasoning one level down — a safety property that holds because the
types require it, not because a convention was remembered.

### Existing grants are not migrated

Rows written before this change hold a thread id in `agent_id` and will not
match any scope built after it. They are not migrated and not deleted.

Preserving them would mean preserving the defect's output: a row whose
`agent_id` is a conversation is not a standing approval the user gave, it is
the record of one they gave and did not get. Rewriting it to `studio` would
convert a grant the user made for one thread into a grant across all their
conversations — widening an approval on their behalf, which is precisely what
ADR 0015 forbids a dialog from doing and no less wrong done in a migration.

The cost is that a user is asked once more for something they had approved.
That is the direction this system is supposed to fail in.

## Consequences

- `always` and `conversation` are different durations, as ADR 0015 intended.
- A second agent cannot inherit the first one's approvals. Asserted now rather
  than discovered when one is added.
- `StudioAgentSandboxOptions.conversationId` is a required field; every call
  site says which conversation it is.
- Two tests carry this: `tests/unit/agent-scope.test.ts` covers how the scope
  is built (the call site, where the defect actually was) and is
  mutation-verified — restoring `agentId: id` fails it. `tests/unit/grant-
  identity.test.ts` covers what the store does with the scope, one test per
  boundary: conversation, agent, project.
- The grant store itself did not change. It was correct; it was being told the
  wrong thing.
