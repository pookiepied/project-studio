# V2 completion implementation decisions

Date: 2026-07-12

This log records the implementation judgments made while executing
`V2-COMPLETION-HANDOFF.md`. The handoff's locked decisions remain authoritative.

1. Context remains the only context playmaker. The runtime consumes a finished,
   category-ordered package and does not discover capabilities or choose policy.
2. Memory is retrieved through the MCP hub with trusted user identity, while
   project availability comes from Registry metadata. Context never reaches into
   another worker's storage.
3. Conversation context uses the visible Data transcript with generous count and
   per-message length limits. No semantic history selector was introduced.
4. Skills use keyword relevance and progressive disclosure. Registry and Context
   carry summaries, activation hints, and instruction references, never bodies.
5. Registry skill and agent primary keys are composite `(id, user_id)` keys. Skill
   availability and enablement are independent persisted states.
6. Local skills use the same revisioned desktop-to-cloud sync envelope as MCP
   registrations. The payload contains metadata and `local-skill://` references,
   never skill bodies, private commands, endpoints, or credentials.
7. The desktop exclusively owns local registry SQLite and OS-keyring access.
   System MCP servers receive a per-launch loopback URL and ephemeral bearer token
   and call the desktop control surface instead of opening either store.
8. The three system MCP servers use MCP stdio because the existing desktop MCP
   manager and both bundled reference servers use stdio. Their desktop control
   plane is authenticated loopback HTTP. This preserves the established launcher
   contract while satisfying the ownership boundary.
9. GitHub MCP installation produces a reviewable plan and requires confirmation;
   it never executes repository install scripts automatically.
10. `skill_run` executes only declared manifest behavior and rejects skills that
    do not declare an executable entry. It is not an arbitrary command runner.
11. Runtime errors use the locked twelve-class taxonomy. Only explicitly transient
    failures are retryable; tool retry additionally requires idempotency and a
    non-destructive effect.
12. Client actions reuse the durable external-result waiter and SQLite record,
    with a distinct route identity and user-owned resolution endpoint.
13. Tracker emission is best-effort and uses the existing ingest contract. A
    telemetry outage cannot alter execution state or fail a run.
14. The Durable Object event log remains the live execution source of truth. Data
    receives a canonical post-run transcript projection with ordered reasoning,
    text, tool inputs, and tool results; it does not duplicate runtime recovery
    state.
15. Real D1 databases were created in APAC for `studio-registry` and `studio-data`,
    their IDs replaced the placeholders, and both local and remote schemas were
    applied. No synthetic database IDs remain.

## Verification record

- All eight V2 TypeScript packages pass `tsc --noEmit`.
- Registry and Data schemas apply successfully to local and remote D1.
- Registry, Data, Context, Execution, Planner, and Agent workers pass Wrangler
  deployment dry-runs with their declared bindings.
- All five bundled MCP servers build from the categorized paths.
- Studio frontend TypeScript passes its typecheck.
- Studio Tauri passes `cargo check`.
- `git diff --check` passes and executable/config references to the old MCP paths
  are absent.

## Explicit hand-back (locked non-goal)

The API worker was not modified. Its public V2 surface still needs the owner-led
forwarding pass for every runtime control, approval, external-tool, and
client-action route before those routes are reachable through the public API.
The runtime-owned endpoints themselves are implemented and user-scoped.
