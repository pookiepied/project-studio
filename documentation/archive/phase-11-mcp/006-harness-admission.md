> **Superseded — archived 2026-08-15.** Kept for provenance, not as current
> guidance. The live source of truth is
> `documentation/work/phases-1-11-remediation.md`.

# Task 006 - Harness Admission And Local Client Boundary

**Status:** in progress; 006.1–006.6 implemented (006.5/006.6 require cargo verification), 006.7 reserved, 006.8 docs pending

**Architecture:** `STUDIO HARNESS/docs/decisions/0028-harness-client-admission-and-local-access.md`

**Scope:** make the local Studio client the authenticated caller of Harness.

This task does not add accounts, remote access, Tailscale support, skills,
connectors, or a new agent loop. It does not expose Harness to a browser. It
does not replace Flue's HTTP or Durable Streams protocol.

## Current facts

These are the starting conditions, measured from the repository:

- `STUDIO HARNESS/src/app.ts` composes Flue, MCP routes, and permission routes.
- `src/transport/http/create-app.ts` now installs one inbound admission
  middleware before Flue, MCP, and permission routes.
- `STUDIO HARNESS/src/application/harness-client.ts` accepts the per-launch
  bearer credential for headless/integration clients; `STUDIO/` still has no
  caller.
- `STUDIO/src/features/chat/session/useChatSession.ts` returns the demo session.
- Tauri exposes only `app_ready`; it does not start or supervise Harness.
- Flue's generated Node entrypoint reads `PORT` and starts its own listener.
- The Project Studio patch for pinned Flue beta.9 adds an explicit hostname,
  actual-address readiness callback, optional readiness file descriptor, and a
  bootstrap file descriptor for private admission material.
- `src/host/harness-launcher.ts` owns standalone/headless startup with
  `PORT=0`, `127.0.0.1`, a per-launch credential over FD 4, and a structured
  readiness frame over FD 3. Tauri Host bootstrap is not implemented yet.
- `@flue/sdk` supports bearer tokens and request headers on HTTP and stream
  reconnections.
- Flue Node persistence is SQLite with durable leases/recovery. Raft is not part
  of this system.

## Target project structure

The structure below separates pure policy from framework adapters and keeps
`app.ts` as a composition root.

```text
STUDIO HARNESS/src/
  admission/
    context.ts                 AuthContext and client identity types
    credential.ts              credential generation and in-memory ownership
    verifier.ts                framework-independent credential verification
    scopes.ts                  operation scopes and scope checks
    errors.ts                  safe admission failures

  transport/
    http/
      create-app.ts            Hono composition root for request routes
      middleware/
        admission.ts            Hono adapter around admission/verifier.ts
      routes/
        mcp.ts                  HTTP adapter; calls application services
        permissions.ts          HTTP adapter; calls approval services

  application/
    approval-broker.ts          pending approval state and domain operations
    mcp-management.ts           MCP install/edit/remove/selection operations
    studio-runtime.ts           runtime composition and turn-boundary work
    harness-client.ts           test/headless client until the desktop adapter lands

  host/
    readiness.ts                structured loopback endpoint contract
    harness-launcher.ts         standalone/headless child-process owner

  auth/                         account/product sign-in and session refresh
  permissions/                  capability policy and PermissionKernel
  tools/gate.ts                 single effect execution door
  extend/                       MCP and future extension lifecycle
  app.ts                        process bootstrap only
```

The following boundaries are mandatory:

- `admission/` must not import Hono, MCP, Flue route definitions, or tool
  implementations.
- `transport/http/` may import Hono and route adapters, but it must not contain
  credential generation or capability policy.
- `application/` owns domain operations and must not read raw Authorization
  headers.
- `permissions/` decides capability authorization; it does not authenticate the
  HTTP client.
- `tools/gate.ts` remains the only effect execution door.
- `app.ts` wires dependencies and exports the composed application; it must not
  become the implementation of admission, routing, or policy.
- Existing `src/auth/` remains account/outbound authentication. It must not be
  renamed or reused for local process admission.

The desktop-side structure is separate from Harness:

```text
STUDIO/src/platform/harness/
  client.ts                     frontend Harness client boundary
  endpoint.ts                   endpoint/session data from Tauri host
  errors.ts                     frontend-safe transport errors

STUDIO/src-tauri/src/harness/
  supervisor.rs                 start/stop/restart and child ownership
  bootstrap.rs                  private credential/bootstrap channel
  endpoint.rs                   readiness and endpoint handoff

STUDIO/src-tauri/src/local_access/  future, not this task
  server.rs                     browser-facing frontend listener
  auth.rs                       browser/local-access session policy
  proxy.rs                      allowlisted forwarding to Harness
```

`local_access/` is intentionally not part of the first implementation. It is
the future frontend boundary for optional browser access. It must never be
implemented by simply binding the Harness listener to a non-loopback address.

## Implementation order

### 006.1 - Freeze the admission contract

- [x] Define `AdmissionCredential`, `AuthContext`, `ClientType`, and operation
  scopes in `src/admission/`.
- [x] Define the credential lifetime as one Harness process launch.
- [x] Define the wire form as `Authorization: Bearer <credential>`.
- [x] Define `401` for missing/invalid admission and `403` for a valid client
  lacking an operation scope.
- [x] Define that raw credentials never enter logs, database rows, error reports,
  transcripts, or URL strings.

**Proof required:** unit tests cover credential size, invalid input, safe error
reports, and scope decisions. Write the tests before the implementation and
confirm each fails against the missing rule.

### 006.2 - Implement the framework-independent verifier

- [x] Generate a fresh random credential through Node's standard cryptographic
  API for the standalone Harness/test owner.
- [x] Verify presented bearer values without ordinary string timing leaks.
- [x] Return an `AuthContext` with client type, client id, session id, and scopes.
- [x] Keep the credential store in memory only.
- [x] Make verifier dependencies injectable so tests do not need a process or
  Tauri.

**Proof required:** unit tests prove the valid path, missing path, wrong-token
path, expired-process path, and absence of the secret in serialized failures.

### 006.3 - Create the HTTP composition module

- [x] Add `transport/http/create-app.ts` that receives the already-constructed
  runtime, approval broker, and admission verifier.
- [x] Add one Hono admission middleware adapter.
- [x] Install it before `flue()`, MCP routes, permission routes, and all future
  application routes.
- [x] Move Hono-specific MCP and approval route adapters under
  `transport/http/routes/`; keep `McpManagementService` and approval domain
  logic under `application/`.
- [x] Make route handlers consume `AuthContext`, not bearer strings.
- [x] Keep `app.ts` responsible only for provider bootstrap, observability,
  runtime construction, and calling `createHttpApp()`.

**Proof required:** integration tests send no token, a wrong token, and a valid
token to every route family. The no-token case must prove that the route handler
and Flue admission logic were not entered, not merely that the response was
eventually `401`.

### 006.4 - Close the Flue listener seam · **headless boundary implemented; upstream seam remains**

The pinned generated Node entrypoint now receives a Project Studio patch during
`pnpm install`. The patch passes an explicit hostname to Flue, forwards the
actual `AddressInfo` to the readiness callback, reads private admission material
from an inherited bootstrap file descriptor, and writes a structured readiness
frame to a separate inherited file descriptor. `src/host/harness-launcher.ts`
consumes that frame and never discovers the endpoint by parsing human logs.

Inspection of the pinned `@flue/cli`/`@flue/runtime` beta.9 confirms that the
generated module still auto-starts itself and does not expose a public authored
configuration for this boundary. Do not rewrite `dist/server.mjs`; the local
resolution is the checked-in `patches/@flue__cli@1.0.0-beta.9.patch` plus the
Project Studio launcher. Upstreaming an import-safe start/readiness API remains
separate follow-up work.

- [ ] Prefer an upstream-supported Flue Node-target option that accepts `hostname`, port,
  and a readiness callback or actual bound address.
- [x] If the upstream option does not exist, maintain a Project Studio launcher
  and generator patch rather than rewriting generated output.
- [x] Do not rewrite `dist/server.mjs` after every build.
- [x] Bind the standalone/headless local Harness explicitly to `127.0.0.1`.
- [ ] Bind the packaged Studio Host's production local Harness explicitly to
  `127.0.0.1` or the platform's equivalent loopback address.
- [x] Use an OS-assigned port in the standalone/headless owner and return the actual port in a
  structured readiness message.
- [x] Allow a fixed port only for deterministic tests and development.

**Proof:** `tests/integration/harness-listener.test.ts` starts the generated
server through the launcher, verifies the `127.0.0.1` address and actual port,
checks the authenticated/unauthenticated boundary, and proves credential/session
replacement on restart. The explicit address in the readiness frame is the
listener configuration proof; a future Host test must add a platform-specific
remote-interface connection check.

This item is a dependency seam, not permission logic. Do not hide it inside the
admission verifier.

### 006.5 - Add the Studio Host process owner

- [x] Add a Tauri Harness supervisor under `STUDIO/src-tauri/src/harness/`.
- [x] Start the built Harness process as a child/sidecar owned by the desktop
  process.
- [x] Pass bootstrap data through a private parent/child channel. Do not put the
  admission secret in a URL or a durable settings row.
- [x] Read a structured readiness frame containing process id, loopback host,
  port, and session information.
- [x] Stop the child on desktop shutdown and invalidate the session credential.
- [x] Define restart behavior: a new credential, a new endpoint, and client
  reconnection rather than reuse of stale state.

**Proof:** `STUDIO/src-tauri/src/harness/` now contains `bootstrap.rs` (32-byte base64url credential + session), `endpoint.rs` (structured `project-studio.harness.ready` validation), `supervisor.rs` (spawn with `PORT=0` + `127.0.0.1` + FD4 bootstrap + FD3 readiness, 30s timeout, `SIGTERM`/`SIGKILL` shutdown, restart with new credential). `STUDIO/src-tauri/src/lib.rs` manages `HarnessSupervisor` state, eager start, `get_harness_endpoint`/`restart_harness`/`get_harness_status` commands, and `RunEvent::Exit` shutdown. Rust verification requires `cargo` toolchain (not in this env); logic mirrors `STUDIO HARNESS/src/host/harness-launcher.ts:56` tested by `tests/integration/harness-listener.test.ts:59`.

### 006.6 - Connect the desktop client

- [x] Add a frontend `HarnessClient` interface under
  `STUDIO/src/platform/harness/`.
- [x] Use the official `@flue/sdk` client adapter rather than reimplementing
  Flue HTTP or stream semantics.
- [x] Pass the per-launch token through the supported SDK `token` or `headers`
  option so stream reconnections are authenticated too.
- [x] Replace the demo implementation behind
  `STUDIO/src/features/chat/session/useChatSession.ts` without changing the
  components above that seam.
- [x] Add cancellation, history, reconnect, and transport-error mapping at the
  client boundary.
- [x] Keep project/chat state ownership explicit; do not turn the React provider
  into a second transcript database.

**Dependency rule:** `@flue/sdk` is the existing upstream client already used by
Harness. Adding that existing client to the independent desktop package is
preferable to copying the protocol. If the repository's no-new-dependency rule
is absolute, the SDK adapter must remain in a Host-side process and expose an
explicit project-owned UI protocol. Duplicating Durable Streams in React is not
an acceptable third option.

**Proof:** `STUDIO/src/platform/harness/{client.ts,endpoint.ts,errors.ts}` now wraps `@flue/sdk` with `createFlueClient({baseUrl, token})`, `useFlueChatSession` replaces `useChatSession` seam, handles `AbortController` cancellation, `history` + `observe` for streaming, and `HarnessError` transport mapping with 401 -> `restart_harness`. `STUDIO/src/features/chat/session/useChatSession.ts:6` now delegates to real hook. `STUDIO` `pnpm build` passes (6140 modules). Desktop E2E against real Harness remains for Tauri runtime verification.

### 006.7 - Reserve, but do not implement, browser local access

- [ ] Define the browser-facing Local Access Gateway as a separate frontend
  surface.
- [ ] Give it its own pairing/session credential and authorization rules.
- [ ] Keep the Harness admission credential server-side in the gateway.
- [ ] Allow only explicit frontend API routes to proxy to Harness.
- [ ] Do not bind Harness to `0.0.0.0` for this feature.
- [ ] Do not make Tailscale a Harness dependency.

This item belongs to product integration after the desktop path and Harness
contract are stable. It is not a prerequisite for local Harness admission.

### 006.8 - Close the documentation and issue record

- [ ] Update `tasks/phase-11-mcp/005-loose-ends.md` L-12 with the final state.
- [ ] Update `STUDIO HARNESS/docs/KNOWN-ISSUES.md` with defects fixed or
  explicitly accepted.
- [ ] Update `STUDIO HARNESS/docs/STATUS.md` after source and tests are correct.
- [ ] Update ADR 0028 if the Flue listener seam or Host ownership changes.
- [ ] Keep the audit documents as evidence; do not replace their issue register
  with an optimistic status paragraph.

## Test matrix

The implementation is not complete with only a unit test for token comparison.
The required matrix is:

| Boundary | Required proof |
|---|---|
| Admission verifier | missing, wrong, valid, malformed, and rotated credential |
| Global routing | Flue, MCP, permissions, and future route groups all protected |
| Operation scopes | valid client denied when its scope is absent |
| Streaming | initial request and every stream reconnection carry auth |
| Listener | explicit loopback bind and actual ephemeral port discovery |
| Bootstrap | credential never appears in URL, argv, logs, or database |
| Lifecycle | startup, readiness timeout, stop, crash, restart, stale token |
| MCP | existing CallGate and PermissionKernel behavior remains unchanged |
| Desktop | real Harness conversation, cancellation, history, and reconnect |
| Browser boundary | future gateway does not forward the Harness credential |

Every new rule follows the repository test discipline: write the test, break the
implementation, observe the failure, restore it, then run the full Harness
check. The final Harness command is:

```text
CI=true pnpm check
```

## Non-goals

- OAuth or account sign-in for local Harness admission.
- Remote Harness execution.
- Tailscale integration.
- A second agent loop in Tauri or React.
- Raft, active-active Harness replicas, or distributed consensus.
- Per-subsystem bearer-token implementations.
- A second capability execution gate.
- Direct browser-to-Harness access.

## Exit condition

Task 006 closes only when ADR 0028's invariants are true in code, the listener
seam is resolved without generated-file rewriting, the desktop can conduct a
real authenticated conversation, and the full test matrix plus
`CI=true pnpm check` is green.
