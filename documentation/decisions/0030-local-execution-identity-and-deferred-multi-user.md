# ADR 0030 - Local Execution Identity And Deferred Multi-User Scope

**Status:** accepted for the local v1 boundary

**Amends:** ADR 0008 and ADR 0028 by defining what identity is available inside
the single local Harness process. It does not claim account-backed tenancy.

> **Amended 2026-09-29.** Two of the five points have moved since this ADR was
> written, and both are recorded here rather than rewritten into the list.
> **Point 2** described 1.0: Flue 2.0 exposes the canonical conversation id to
> the authored initializer, and it IS the agent instance id — the caller passes
> the product's conversation id bare, the `conversation:` prefix is gone from
> the scope vocabulary, and `conversationId` is required with no default (ADR
> 0038, which landed the change under #69 and carries its tests). Measured, not
> inferred: the sandbox factory's `createSandbox` receives the instance id in
> `options.id`, and the scope is built from it directly. **Point 5's** subagent
> half is answered by [ADR 0058](0058-agent-definitions-and-delegation.md) —
> the runtime derives the child scope from the parent conversation's settled
> row plus the definition, within the local boundary this ADR names. The
> multi-user deferral itself stays deferred.

## Decision

1. One Harness launch has one admitted local client identity and one session id.
   `StudioRuntime` places both values in every `ExecutionScope` it creates.
2. Agent and conversation identities are separate fields. The current Flue
   direct-agent seam derives the conversation key from the agent instance id with
   a distinct prefix until Flue exposes the canonical conversation id to the
   authored initializer.
3. Project identity is derived from the runtime's bound project root. Model
   input, URL headers, and tool results cannot supply or widen it.
4. `clientId` is a local process-client identity, not an authenticated account
   or user id. The local admission boundary intentionally has no multi-user mode.
5. Account identity, durable user ownership, multi-project routing, and subagent
   authority derivation remain deferred. They require a trusted application
   context, grant-store schema changes, and a separate product/API decision;
   caller-supplied ids are not accepted as a substitute.

## Consequences

- Grants and policy evaluations execute under an explicit local client/session
  scope rather than an unlabelled process.
- The current product can safely claim one Host-owned local session, not shared
  multi-user execution.
- Phase 13 subagents and Phase 18 account/project integration must extend the
  trusted context before using the Harness as a shared service.
