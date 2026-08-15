# ADR 0029 - MCP Session Tool Membership Is Append-Only

**Status:** accepted

**Amends:** the current implementation of ADR 0024 and resolves the conflict
with `documentation/mental-model.md` section 3.4.

## Context

Flue supplies operation-scoped tool options, but the model's tool list is part of
the cached prompt prefix. Removing a tool during an existing conversation
invalidates that prefix and can make a long conversation pay for its entire
context again. The previous MCP runtime unregistered every MCP source whenever
selection changed, so code and the mental model disagreed.

## Decision

1. A `StudioRuntime` agent sandbox owns an append-only set of discovered tool
   memberships for its lifetime.
2. Native tools are registered when the sandbox is created. MCP tools are added
   when they are first discovered. A disabled, removed, or disconnected MCP
   server does not remove its previously exposed tool from that sandbox.
3. A retained MCP tool has a dispatch-time availability predicate. If its server
   is disabled, disconnected, or no longer advertises that tool, the call returns
   a normal unavailable tool result and never reaches `PermissionKernel` or the
   external connection.
4. A new sandbox starts from the current durable registry and selection state.
   This is the only ordinary removal boundary.
5. A changed tool definition may replace the old registration at a turn boundary.
   The definition hash on grants forces a new approval; replacement is a schema
   change, not a selection toggle.
6. `notifications/tools/list_changed` marks a catalog dirty and refreshes it at
   the next model-turn boundary. It does not mutate the current model operation.

## Consequences

- Disabling a server preserves the prompt prefix and makes the next stale call
  fail safely rather than execute.
- A session may retain schemas for tools that are no longer available. This is
  deliberate cached context, not a claim that the provider is still live.
- New sessions do not inherit stale tool membership.
- The CallGate remains the only effect execution door. Availability is checked
  before effect execution and does not replace capability authorization for a
  tool that is available.

## Required proof

- A disabled MCP tool remains listed in its existing sandbox but cannot call the
  server.
- A new sandbox does not list the disabled tool.
- A recovered server refreshes definitions and replaces the old connection
  closure without duplicating model names.
- A definition change invalidates the old grant through its definition hash.
- A list-changed notification refreshes only at the next turn boundary.
