> **Superseded — archived 2026-08-15.** Kept for provenance, not as current
> guidance. The live source of truth is
> `documentation/work/phases-1-11-remediation.md`.

# Task 007 - Phase 0–11 Audit Remediation

**Status:** supporting audit record; active closure order is
`tasks/phase-11-mcp/008-phase-1-11-completion.md`.

**Scope:** close the Harness MCP/permission P1 and P2 findings without starting
Skills, connectors, planner, memory, artifacts/projects, remote sandbox, MCP
OAuth, or the bundled MCP library.

**Architecture records:**

- `STUDIO HARNESS/docs/decisions/0028-harness-client-admission-and-local-access.md`
- `STUDIO HARNESS/docs/decisions/0029-mcp-session-tool-membership.md`
- `STUDIO HARNESS/docs/decisions/0030-local-execution-identity-and-deferred-multi-user.md`
- `STUDIO HARNESS/docs/decisions/0031-harness-gateway-contract-is-not-current-worker-contract.md`

## Implemented In The Dirty Tree

- Global Harness bearer admission and operation scopes precede Flue, MCP, and
  approval routes.
- MCP configuration rejects nested secret-shaped fields, secret arguments, URL
  credentials, and sensitive query parameters before durable projection.
- MCP credential set/delete/remove operations stop live servers and clean the
  keychain in safe ordering.
- Supervisor retries notify catalog lifecycle owners; failed edits do not leave
  old retry timers alive; terminal attempt counts remain observable.
- Server `tools/list_changed` notifications mark the catalog dirty and refresh at
  the next model-turn boundary.
- MCP tool names use the documented 64-character grammar and injective
  model-facing names.
- MCP `isError`, structured content, non-text content, and untrusted-content
  labeling survive the gate result projection.
- Existing sandboxes use append-only MCP membership with dispatch-time
  unavailable results; new sandboxes rebuild from current selection.
- Native filesystem, search, Git, shell, web, and workspace-summary tools are
  registered through the same CallGate; the direct Flue bypass is removed.
- Execution scopes carry the admitted local client/session and distinct agent
  and conversation fields; account-backed multi-user identity remains deferred.
- Approval waits are abort-aware and cannot write a grant after cancellation.
- Model-supplied Git configuration injection (`-c`, attached forms, and
  `--config-env`) is rejected.
- Gateway consumer/admin admission fails closed outside explicit development/test
  environments, discovery is protected, model/provider enabled flags are
  honored, and Responses validates encryption-key configuration.

## Remaining Boundary Work

- The pinned Flue beta.9 generator is now patched by
  `patches/@flue__cli@1.0.0-beta.9.patch` for Project Studio's explicit hostname
  and actual-address readiness frame; `src/host/harness-launcher.ts` consumes it
  for standalone/headless launches. An upstream public start/readiness API is
  still preferable and remains follow-up work.
- Tauri Studio Host lifecycle, packaged Harness sidecar, and desktop SDK client
  remain disconnected until that listener/bootstrap seam is available.
- Pending approvals remain process-memory state across a Harness restart.
- External MCP execute/network remains user-approved but not OS-contained; remote
  sandbox work is intentionally deferred.
- The current Worker/Harness custom SSE contract is explicitly not declared
  compatible with the independent Gateway API by ADR 0031; contract translation
  is a separate deferred decision.

## Supporting Exit Gates

- P1/P2 Harness regression tests and real MCP stdio/Streamable HTTP tests pass.
- Gateway auth/model-state tests pass.
- `CI=true pnpm check` passes in `STUDIO HARNESS`.
- `pnpm check` and `pnpm test` pass in `STUDIO Gateway`.
- Audit documents identify only the remaining boundary/deferred items above.
