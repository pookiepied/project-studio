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

### Phase 6: Provider Bootstrap

- One lifecycle for selecting and registering model sources.
- Gateway-neutral `project-studio/default` model identity.
- Deterministic provider behind the shared adapter contract.
- Capability metadata, configuration validation, and startup rejection for unavailable sources.

### Phase 7: Studio Gateway Integration

- Operational `studio-cloud` model source, selected at process bootstrap.
- Native Pi-facing Studio Gateway adapter parsing the gateway's own SSE contract, with streamed
  reasoning/text, preserved multiple tool calls, tool-result continuation, finish reasons, usage,
  safe typed errors, and cancellation, proven against a real generated Flue server.
- Injected `AccessTokenProvider` boundary; `PROJECT_STUDIO_GATEWAY_TOKEN` is a development-only
  bootstrap token, not credential storage.
- Required explicit default model; catalog loading is an explicit callable service.
- No automatic fallback between sources; `local`/BYOK recognized but not operational.
- Gateway trust boundary documented: private worker behind the public API's service binding; the
  public API owns end-user authentication.

### Phase 7.5: Architecture And Modularity Review

An audit pass over the real code after the first external model transport, not a feature phase.

- Removed `contracts/events.ts`: a product event envelope with no importer in `src/` or `tests/`,
  and already inaccurate (it modelled no reasoning event while reasoning streaming was shipping).
  The UI projection will be designed against a real consumer in Phase 18.
- Split the gateway wire vocabulary out of `event-mapper.ts` into `stream-events.ts`. Decoding what
  the gateway emits and projecting it onto Pi are separate responsibilities that change for
  different reasons; an architecture test now fails if the wire module imports Pi or Flue.
- Confirmed the deferred Phase 7 review gates: `tests/integration/studio-flue.test.ts` spawns the
  generated `dist/server.mjs` and drives it over HTTP, and the documentation claims no account/
  per-run switching and no automatic catalog loading.

Recorded, deliberately not changed:

- `application/harness-client.ts` returns Flue's `FlueConversationSnapshot`,
  `AgentConversationObservation`, and `AgentPromptResponse` directly. Product-owned projections are
  Phase 18 work with a real UI consumer; inventing them now would repeat the dead-abstraction
  mistake.
- `PassthroughContextOptimizer` has no production caller. It is a declared port from ADR 0003, kept
  as a decided seam, and it is exercised only by a unit test today.

## Next

### Phase 8: Product Authentication, Secure Credentials, And Local BYOK

Separable pieces:

1. **Production Studio authentication.** Inject an `AccessTokenProvider` backed by the authenticated
   public-application session (the API proxy contract), replacing the development bootstrap token,
   and define trusted identity propagation from the API to the gateway.
2. **Account settings and per-run routing.** Product-owned account model/source preference and, only
   if a real requirement emerges, a run-level routing record. Not built speculatively in Phase 7.
3. **Secure OS credential storage.** Keychain-backed storage for user-controlled provider keys. No
   plaintext-on-disk fallback. No key may reach a model-visible value, log line, event, telemetry
   attribute, or persisted conversation.
4. **Local BYOK provider runtime.** A `LocalModelProviderAdapter` behind the Phase 6 contract,
   selectable via the `local` source. Local and Studio gateway internals and catalogs stay separate.

Until secure storage and the local runtime land, `local` remains a deliberate, typed startup
failure.

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
