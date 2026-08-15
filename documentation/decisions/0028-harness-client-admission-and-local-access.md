# ADR 0028 - Harness Client Admission And Local Access

**Status:** accepted for implementation

**Amends:** ADR 0001 (Harness boundaries) and ADR 0004 (application
composition). It clarifies ADR 0008 (account sign-in) and ADR 0012 (permission
and containment); it does not replace them.

**Implementation record:** `tasks/phase-11-mcp/006-harness-admission.md`

## Context

Project Studio has two process roles:

- `STUDIO/` is the React and Tauri desktop face.
- `STUDIO HARNESS/` is the local Node runtime that composes Flue, Pi, policy,
  persistence, tools, and external MCP clients.

The repository already has the right transport primitive. Flue's Node target
builds `dist/server.mjs`, and `@flue/sdk` speaks the generated HTTP API and its
Durable Streams event endpoints. `FlueHarnessClient` uses that client in Harness
integration tests. The desktop currently has no caller: its Tauri code only
exposes `app_ready`, and `useChatSession()` still returns the demo session.

The current authored application mounts three route groups in
`STUDIO HARNESS/src/app.ts`:

```text
/api/mcp
/api/permissions
/Flue public routes
```

None has an inbound Harness admission credential. The existing `src/auth/`
implementation is outbound/product sign-in and the existing Gateway token is
outbound model authentication. Neither authenticates a caller of Harness.

The product is local-first and does not require accounts in its first local
version. Optional browser access is a future way to access the Studio frontend;
it is not a reason to expose the Harness execution API to a LAN, Tailscale
network, or the public Internet.

## Terms

### Harness

The Node process containing the Flue application and Project Studio runtime.
It owns durable execution, the canonical Flue conversation, policy evaluation,
MCP lifecycle, and local effects.

### Studio Host

The trusted local process that owns the Harness process lifecycle. In the
desktop product this is the Tauri native side. It starts, supervises, stops,
and reconnects to Harness. It is a role, not a second agent runtime.

### Studio client

The desktop UI client that consumes the authenticated Harness API. It may use
the Flue SDK directly in desktop mode. It must not own a second agent loop.

### Local Access Gateway

An optional frontend-facing HTTP surface enabled by the user. A browser talks
to this surface, not to Harness. The gateway holds the Harness credential and
proxies only the product API that the browser is allowed to use.

### Admission authentication

Authentication of a request before it reaches any Harness route. It answers:
"Is this request from a currently paired Studio client or host?"

### Operation authorization

Authorization of an already authenticated caller for a control-plane action,
such as editing MCP settings or answering an approval.

### Capability authorization

Authorization of an agent effect through `PermissionKernel` and `CallGate`.
It answers: "May this particular tool call perform this particular effect?"

## Decision

### 1. Keep Flue HTTP and streaming as the internal Harness protocol

Harness continues to use the generated Flue HTTP API and Durable Streams/SSE
compatible event transport. We do not replace it with a new stdin/stdout
protocol, a second agent client, or a direct Tauri-only agent loop.

This is an internal process boundary in the desktop product. Using HTTP here
does not mean that Harness is externally available.

The Flue SDK already supports a static token or request-header factory. The
same authentication headers are applied to ordinary requests and stream
reconnections. Project Studio uses that supported surface rather than copying
the Flue protocol.

### 2. Studio Host owns the Harness lifecycle

The desktop host starts one Harness process for the local Studio session. The
host owns:

- the child process;
- the Harness endpoint and readiness state;
- the per-launch admission credential;
- restart and shutdown behavior;
- delivery of the endpoint to the trusted desktop client.

The current Tauri project does not implement this yet. `app_ready` is a window
visibility command, not a Harness supervisor.

> **Status note, 2026-08-15.** The paragraph above was true when this ADR was
> written and is false now; it is left in place because an ADR records what was
> believed when a decision was taken, and a correction is more honest than a
> rewrite. The supervisor shipped:
> `STUDIO/src-tauri/src/harness/supervisor.rs` (spawn, restart, stop, reap,
> `shutdown_all`, FD-3 readiness, FD-4 bootstrap, loopback verification),
> `endpoint.rs`, `bootstrap.rs`, and the `get_harness_endpoint` /
> `restart_harness` / `get_harness_status` commands, with the desktop caller in
> `STUDIO/src/platform/harness/`. One deferral remains **open** inside it:
> `supervisor.rs:197` passes the entire host environment to the child minus the
> admission credential — `// For now inherit all except credential`. That is
> meta-task **#74** and is a decision, not an oversight to be tidied.

Standalone Harness startup remains supported for tests and headless use. It
uses the same application composition and admission verifier, with an injected
test/development credential source.

### 3. The Harness listener is explicitly loopback-only in local mode

The local Harness endpoint must bind to an explicit loopback hostname. A test
client using `127.0.0.1` is not proof that the server is loopback-only; the
listener configuration must enforce it.

The pinned Flue beta.9 generated Node entrypoint originally read `PORT` but did
not expose a Project Studio hostname or readiness option. The current local
resolution is a checked-in patch to the pinned CLI generator plus
`src/host/harness-launcher.ts`: the launcher passes `127.0.0.1`, requests port
`0`, sends admission material over a private bootstrap file descriptor, and
receives the actual bound address over a separate readiness file descriptor. It
must not rewrite `dist/server.mjs` after each build. An upstream Flue
start/readiness API remains preferable and can replace the patch later.

### 4. Use an ephemeral per-launch endpoint

The Studio Host requests an OS-assigned port for each Harness launch. The
actual bound port is returned through a structured readiness handshake, not
parsed from a human log line.

The endpoint is a runtime fact and is held in memory. A fixed port is allowed
for deterministic tests, but it is not the production discovery mechanism.

### 5. Use one per-launch Harness admission credential

Each Harness process receives a fresh, cryptographically random credential of
at least 256 bits. The credential is:

- held in memory by the Host and Harness;
- sent as an `Authorization: Bearer` header;
- never placed in a URL, query string, transcript, log, database row, or
  ordinary product setting;
- invalid after the Harness process exits;
- not refreshed by polling while the process remains alive.

The Studio Host is the credential owner because it starts the child process. A
standalone Harness launcher may generate the credential instead, but it must
deliver it to the parent through a private bootstrap channel. An unauthenticated
HTTP token-discovery endpoint is not allowed.

The bearer credential is a local process capability, not an account token. A
process that obtains it can replay it until the Harness process exits. Preventing
an equally privileged local process from reading or using the credential would
require an OS IPC or signing boundary and is a separate hardening level.

### 6. Put one admission middleware in front of every Harness route

Authentication is global, not per subsystem. The request pipeline is:

```text
HTTP request
  -> admission verifier
  -> AuthContext
  -> operation authorization, where required
  -> Flue or application route
```

The middleware runs before all of these route groups:

- Flue agent and workflow routes;
- MCP management routes;
- permission and approval routes;
- future skills, connectors, project, and diagnostic routes.

No route should parse the bearer token independently. The verifier creates an
`AuthContext` containing the authenticated client identity, client type, session
id, and route scopes. Raw credentials do not pass into application services.

### 7. Keep authorization layered

One admission system does not mean one undifferentiated permission check.

Operation authorization remains domain-specific:

- MCP management requires extension-management scope;
- permission answers require approval scope and a valid pending approval;
- project operations require project scope;
- diagnostics require diagnostic scope.

Capability authorization remains in `PermissionKernel` and `CallGate`:

```text
agent tool call
  -> CallGate
  -> PermissionKernel
  -> trust, grants, approval, bounds, sandbox, snapshot
  -> effect implementation
```

MCP, native tools, skills, and connectors must share this execution gate when
they perform an effect. They do not each get an independent execution-policy
engine.

The permission control plane is not itself a tool call. It changes the policy
state that later tool calls consult, so it is protected by admission and
operation authorization rather than routed through `CallGate`.

### 8. Keep outbound credentials separate

There are two unrelated directions:

```text
Studio client -> Harness: local admission credential
Harness -> MCP/provider/Gateway: integration credential
```

An MCP bearer token, model-provider key, Google session, or Gateway token must
never be reused as the Harness admission credential. MCP credentials continue
to be selected per server and held by the existing credential store/channel
layers.

The existing `src/auth/` account sign-in remains the future account/product
authentication layer. It is not renamed to mean local Harness admission.

### 9. Keep browser access behind the frontend boundary

When local access is enabled, the browser connects to the Studio frontend or
Local Access Gateway. It does not receive the Harness credential and does not
connect directly to the Harness port.

The browser-facing surface has its own local-access session or pairing policy.
Tailscale, if used, is only a network path to that frontend surface. It is not
the Harness authentication mechanism and does not change the Harness bind.

### 10. Do not add accounts to the local admission path

The first local version has one local Studio installation and one active Host
session. It uses a process credential, not OAuth, JWT accounts, or a remote
database.

When account-backed synchronization is added, account authentication belongs at
the browser/API boundary. The local Host still needs a device/session credential
to reach local execution. Account identity may be included in a future
`AuthContext`, but it does not replace process admission.

### 11. No Raft is required

Flue's Node target uses the configured SQLite adapter and durable leases/recovery
for local execution. Project Studio does not add Raft, active-active ownership,
or a distributed consensus layer for the local Harness.

## Rejected alternatives

### Per-subsystem authentication

Rejected. It duplicates credential parsing, creates inconsistent bypasses, and
would allow a route forgotten by one subsystem to remain open.

### CORS, Origin, or Referer as authentication

Rejected. Those are browser signals. A CLI or local process can omit them.

### Harness token in a URL

Rejected. URLs leak through logs, history, referrers, crash reports, and copied
links.

### Unauthenticated token setup endpoint

Rejected. The first local process to call it could claim the Harness credential.
Bootstrap travels through the parent/child channel instead.

### Exposing Harness for Tailscale or browser access

Rejected. Browser access is a frontend concern. Harness remains an internal
loopback service.

### Replacing Flue with a new direct IPC protocol

Rejected for the first integration. It would duplicate admission, streaming,
cancellation, recovery, and error semantics that Flue already provides over
HTTP and Durable Streams.

### Storing the admission credential in SQLite

Rejected. The credential represents a live process session, not durable product
state. Restart invalidation is a feature.

## Required invariants

The implementation is not complete unless all of these hold:

1. A missing or incorrect credential returns `401` before any Flue or business
   route executes.
2. The same verifier protects Flue, MCP, permission, and future application
   routes.
3. The credential is absent from URLs, logs, transcripts, error reports, and
   durable databases.
4. Stream reconnections carry the same authenticated context.
5. A Harness restart invalidates the old credential.
6. Application services receive `AuthContext`, not raw bearer strings.
7. Effectful capabilities use `CallGate`; admission middleware is not treated as
   a replacement for capability authorization.
8. The browser-facing local-access surface never forwards the Harness secret to
   browser JavaScript.
9. The listener binding and actual port are observable through a structured
   readiness contract.

## Consequences

The current Harness HTTP composition remains useful and testable. The required
work is a boundary and lifecycle layer around it, not a second agent runtime.
`src/app.ts` becomes a composition root that imports the admission verifier and
HTTP application factory rather than containing authentication or route logic.

The full implementation sequence is recorded separately in
`tasks/phase-11-mcp/006-harness-admission.md`.
