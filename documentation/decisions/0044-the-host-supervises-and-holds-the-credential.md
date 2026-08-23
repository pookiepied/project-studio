# ADR 0044 — The Host supervises, and holds the credential

**Status:** Accepted · 2026-08-24
**Relates to:**
[ADR 0040](0040-one-bootstrap-protocol-two-transports.md) — how the credential
reaches the Harness. This is what happens to it afterwards.
[ADR 0028](0028-harness-client-admission-and-local-access.md) — who the bearer
admits.
[ADR 0039](0039-a-child-inherits-nothing-it-was-not-given.md) — the environment
policy the supervisor applies.
[ADR 0007](0007-secure-credential-storage.md) — the same rule, one layer down.

## Context

Two problems arrived from opposite directions and turned out to be one.

**STUDIO could not start the Harness.** The rebuilt frontend had no launcher.
A complete Rust implementation of 0040 — bootstrap, channel, endpoint,
environment, supervisor — sat in `STUDIO (ON HOLD UI)/src-tauri/src/harness/`
and had never been carried across. In its absence the Harness was started by
hand and its address supplied through `VITE_HARNESS_BASE_URL` and
`VITE_HARNESS_TOKEN`.

**Those variables are a footgun, not a stopgap.** `import.meta.env` is inlined
by Vite at build time. A token present during `pnpm build` is baked into the
shipped bundle, and nothing about the mechanism says so at the point of use.

Meanwhile the webview had stopped needing a token at all. The Harness serves no
CORS headers — deliberately; a loopback service holding provider credentials
has no business being reachable by any origin a browser will preflight — so
browser `fetch` from the packaged app died at every preflight, and the transport
had already moved into Rust to get past it.

So the webview was holding a bearer it no longer used to authenticate anything
it issued itself.

## Decision

**The Host owns the Harness's whole lifetime, and the credential never leaves
Rust.**

### The Host supervises

`STUDIO/src-tauri/src/harness/` spawns the Harness, applies the 0039
environment policy, delivers the bootstrap over 0040's channel, reads the
readiness frame, contains the process tree, and tears it down on window
destruction and app exit.

The port is one decision worth restating: **`PORT: "0"`.** The OS chooses the
port and the Harness reports it back in the readiness frame. The Host does not
pick one. There is no bind race and no port-in-use retry, and the frame already
had to be read for the pid and the session id.

### The credential stays in Rust

The webview asks for a request; it does not make one.

```
service_fetch(service, path, init) -> SerializedResponse
```

Rust resolves the address from the supervisor, attaches the bearer, and returns
status, headers and body. `HarnessEndpoint` no longer derives `Serialize`, so
returning the token is a compile error rather than a comment promising not to;
the commands hand back a `HarnessEndpointView` that has no such field.

This is 0007's rule applied to a second kind of secret. A provider API key never
enters a connection record because the record crosses a boundary; the Harness
bearer never enters the webview because the webview is a boundary — and one that
runs third-party-rendered content.

Two properties belong to the same decision, because both are about where a
credentialed request may land:

- **`path` is a path.** Anything carrying a scheme or an authority is refused,
  so a caller cannot redirect a credentialed request to another host.
- **`Policy::none()`.** A 3xx never carries the bearer anywhere. The decision is
  made once, in the client, rather than per-response.

### A named seam, not a registry

`ServiceId` is an enum with one variant. One match arm.

The second side system is known — a v2 account backend — and it is a different
shape: no process, no spawn, no readiness frame, no per-launch credential, and
an account session rather than a bearer minted at launch. **A registry
generalised today from a sample of one would abstract over spawning and
supervision, which is precisely what the remote service does not do.**

What is fixed now is the *call site*. It names a service. A second service is a
second arm with its own auth strategy, and no caller changes. That is the part
that would be expensive to retrofit; the abstraction over lifetimes is not, and
is better written when there are two things to compare.

## Consequences

- **`tauri-plugin-http` is gone**, with its capability entry and the loopback
  `connect-src` that only a webview fetch needed. A granted capability nothing
  uses is the same defect as an over-broad one.

- **The env vars survive for development only**, behind `import.meta.env.DEV`,
  so they are dead code in a production build. Verified rather than assumed: a
  build with a token set, grepped for the value across `dist/`, zero matches —
  repeated unminified so the proof does not rest on the minifier.

- **A reviewed implementation had never been executed, and it did not work.**
  Two defects, both invisible to a code read, both fatal on the first launch:
  `canonicalize()` returns a `\?\D:\...` verbatim path on Windows and Node
  reads the leading `\` as a UNC share; and the bootstrap frame serialized
  `client_id`/`session_id` where the Flue patch reads `clientId`/`sessionId`.
  The prose, the reasoning and the unit tests were all excellent. **The
  question a code review cannot answer is whether the thing has ever run**, and
  the integration test that spawns a real Harness is the only reason either was
  found. That test is the load-bearing one in this module.

- **Windows containment is a Job Object**, with `KILL_ON_JOB_CLOSE`, so the
  handle's lifetime *is* the containment — including the kernel's close when
  the Host crashes, which no shutdown path can cover. `process_group(0)` remains
  the Unix half. This closes the gap 0040 recorded as meta-task #89.

  **Residual, and stated rather than discovered later:** the child is unjobbed
  between `spawn` and assignment. Closing that window needs `CREATE_SUSPENDED`,
  which `std::process::Command` cannot request.

- **Job membership is inherited**, so a test asserting `IsProcessInJob(child,
  None)` would have passed before the containment code existed. Membership is
  asserted against *this supervisor's* job. A test that cannot fail is worse
  than no test, because it reports success.

- **A status is three states, not an optional endpoint.** An eager start that
  fails must be distinguishable from one that has not happened yet, and
  `Option<Endpoint>` cannot say which. `HarnessStatus` is running / failed /
  stopped, and the failure is retained for the UI to render.

- **The webview still needs a credential-shaped value** to satisfy the client's
  interface, and it is a named marker rather than a plausible token. It rides in
  the `Authorization` header only until `service_fetch` replaces that header,
  and if it ever reached a Harness it would be refused — which is the safe
  direction for a mistake to fail in.

- **Live-Harness tests must not run concurrently.** A second Harness waiting on
  the first's database logs nothing while it waits, so three parallel tests
  produce a 30-second timeout and no diagnostic. They are serialized. The mutex
  is currently a `std::sync::Mutex` held across an `.await`, which clippy is
  right to flag: in a multi-threaded runtime that can deadlock rather than
  serialize, and it should be a `tokio::sync::Mutex`.
