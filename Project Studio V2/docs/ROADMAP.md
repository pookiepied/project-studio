# Project Studio V2 Roadmap

This roadmap is the canonical implementation order for the local-first harness. Cross-cutting
work may be added when it removes risk from the next milestones, but it must not reorder the
capability path without an architecture decision.

## Completed

### Phases 1-4: Harness Foundation

- Strict TypeScript workspace.
- Flue/Pi continuing-agent loop.
- File-backed SQLite canonical persistence.
- Accepted submissions, observation, cancellation, continuity, and restart recovery.
- Deterministic provider and typed tool continuation.
- Gateway-neutral model and context-optimizer boundaries.

### Phase 5: Observability Foundation

- OpenTelemetry traces and metrics through Flue instrumentation.
- No-network, in-memory, and OTLP exporter modes.
- Structured correlated logs, safe errors, and content redaction.
- Runtime composition through `src/app.ts`.

## Next

### Phase 6: Provider Bootstrap

Create one lifecycle for selecting and registering `test`, `local`, and `studio-cloud` model
sources. Keep concrete gateway transports out of the agent definition. Move the deterministic
provider behind the same adapter contract. Add model identity, capability, configuration, and
startup-validation tests.

### Phase 7: Local Gateway

Implement the user-controlled local/BYOK gateway adapter against the Phase 6 contract. Keep keys
out of model-visible values, logs, events, and persisted conversations.

### Phase 8: Studio Cloud Gateway

Connect the existing Studio gateway through its own adapter and centralized authentication.
Do not merge local and cloud gateway internals or catalogs.

### Phase 9: Capability And Permission Kernel

Define the shared execution policy used by native tools and MCP tools:

- capability identity and provenance;
- trusted application-bound scope;
- permission decisions and approval states;
- cancellation, timeout, and concurrency policy;
- idempotency and unknown-outcome handling;
- safe result/error serialization;
- audit and telemetry attributes.

### Phase 10: Native Agent Tools

Audit Flue sandbox tools and the read-only OpenCode reference before adding anything. Do not
duplicate capabilities Flue already supplies. Implement only product-required primitives and
prove them through the Phase 9 policy boundary.

### Phase 11: MCP

Add a registry and separate transports for local MCP and authenticated cloud MCP. Reuse the same
capability, permission, cancellation, telemetry, and result policy as native tools. Include tool
provenance, collision handling, health, reconnect, and connection teardown.

### Phase 12: Skills

Add application-owned and workspace-discovered skills, validation, catalog metadata, and agent
assignment. Skills provide instructions and resources, not permissions or executable authority.

### Phase 13: Subagents And Tasks

Define specialized profiles and delegation policy. Preserve parent-owned durability and restrict
each subagent to its explicitly declared tools, skills, and context.

### Phase 14: Projects, Workspaces, And Sandboxes

Bind conversations to Project Studio projects, define artifact ownership, and add sandbox
lifecycle policy. Conversation durability and workspace durability remain separate decisions.

### Phase 15: Memory And Context

Add project/user memory contracts and the authenticated cloud memory MCP adapter. Preserve Flue's
canonical transcript. Headroom remains an optional fail-open context optimizer.

### Phase 16: Workflows And Schedules

Use workflows for finite application-controlled jobs and continuing-agent dispatch for durable
conversation work. Add schedule admission, idempotency, retry, and inspection policy.

### Phase 17: Evals

Create deterministic regression suites for model selection, tool policy, MCP behavior, recovery,
permissions, context construction, and end-to-end task quality.

### Phase 18: Product Integration

Connect authentication and the existing React application to the stable harness contracts. Add
product-owned read models for agents, projects, capabilities, telemetry, and administration.

## Working Rules

1. Complete and review one phase before beginning the next.
2. Keep one implementation task active against the shared `main` worktree.
3. Run `pnpm check` before every checkpoint.
4. Commit a reviewed phase before delegation continues.
5. Never rebuild Flue's agent loop, canonical transcript, or submission journal.
6. Never place credentials or tenant authority in model-selected arguments.
7. Use OpenCode only as a behavioral reference, not as the harness architecture.
8. Add no empty subsystem directories or speculative abstractions.
