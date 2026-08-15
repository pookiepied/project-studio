# Task 005 — Phase 11 loose ends

Everything in Phase 11 that is started and not finished, in one place, so that
"we built the MCP client" cannot be mistaken for "MCP works".

The ordered completion task for all Phases 1-11 is
`tasks/phase-11-mcp/008-phase-1-11-completion.md`. This file remains the
Phase 11 evidence register; it is not the complete execution order.

`tasks/phase-11-mcp/003-work-plan.md` is the order of work and the record of *why*.
This file is the shorter, harsher question: **what is not done.** When an item
here is finished, cut it to one line pointing at the work plan entry that
records it, and never delete the line — a loose end that was closed should not
be re-discovered as new.

**The rule for this file:** an item is done when something in `src/` calls it,
a test proves the rule it exists to enforce, and the documentation says why. Two
of three is a loose end.

---

## The finding that reframes the list

**Historical finding:** every module built in the first Phase 11 slice had zero
callers in `src/`. Task 007 now wires the registry, inventory, selection,
reconciler, supervisor, catalog, revocation, hash, management, approval, and
native gate paths into the Harness composition.

The original shape was deliberate: each piece was tested against a fake and
wiring arrived later. The honest current summary is **"an experimentally
integrated MCP client with an active P1/P2 remediation record"**; the remaining
items below are the unresolved boundary and cleanup work.

It also means one class of bug cannot have been found yet: anything that only
appears when the pieces are assembled against a real server. `S-04` was exactly
that shape and was found the moment a real process was spawned.

---

## ~~L-01 — `registerOwnPort` is never called~~ · **done**

`src/net/own-ports.ts` exported `registerOwnPort` and nothing in `src/` called
it. The `own-port` class therefore never fired in production: the set was always
empty, so `classifyHostPort` could never return it. The guard existed, was
tested, and protected nothing.

**There was a real listener it should have been protecting.**
`src/auth/google-login.ts` binds a loopback port to receive an OAuth
authorization code, and did not register it.

Not exploitable at the time, because `fetch` refuses every loopback address
whatever the port. It would have stopped being safe the moment `L-02` made
loopback reachable — and a registration added then would have been missing for
exactly as long as it mattered.

**Fixed.** Registered when the port is bound, unregistered in the `finally` that
closes the server, because a port left in the set outlives its listener and
would refuse a destination that now belongs to somebody else — the guard turning
into a false accusation instead of a defence. The sign-in test asserts both
halves; removing the registration fails it.

**If another listener is added, it registers too.** That is the standing rule
this item leaves behind.

---

## ~~L-02 — The direct HTTP client~~ · **done**

`src/net/http.ts`. Built on `node:http`/`node:https`, no new dependency — and
that is also what made pinning possible, because a raw request takes the
address, the `Host` header, and the TLS `servername` as three separate things
where `fetch` takes them as one string.

Both of the stated conditions hold, each proved by breaking the code first: a
name that resolves to a refused address never opens a socket, and a redirect to
a refused address is refused mid-request.

**One question the item did not anticipate, now answered in ADR 0026:** a
redirect has an author, and it is neither the user nor the model — it is the
server being talked to. Every hop after the first is judged as `model`, the
stricter side of the `C-17` table, whoever the caller was. Recorded there rather
than here because it is a rule and not a task.

**A second copy of the policy was avoided** by splitting `judgeHostPort` out of
`judgeDestination`. An address has no URL around it, and a name that passes with
an address nobody judged is the exact hole this item existed to close.

`DestinationError` now reports as the `network` domain rather than `retrieval`,
which was only ever true while page reading was its one caller.

---

## ~~L-03 — Streamable HTTP transport~~ · **done**

`src/extend/mcp/http-channel.ts`. The condition held: **`McpConnection`, the
framing, the era probe, and the handshake are unchanged.** The tests drive a
real connection and a real handshake over a real HTTP server, because a test
that spoke to the channel directly would have passed while that claim was false.

It reuses `net/http.ts` and adds no address handling of its own, so the pinning,
the redirect rule, and the deadline are inherited rather than restated.

**One thing it needed from `net/http.ts`:** an unread body. An event stream must
be acted on as it arrives, and a ceiling applied by the reader would have to
buffer the whole stream to count it. `requestStream` returns the response with
the body unread and `requestDirect` became a wrapper around it, so there is one
judge-and-pin path and not two.

**Two decisions are recorded in ADR 0027**, because both are places this file
does more than move bytes: a failed POST is answered on the transport's behalf,
and `onStderr` carries the transport's own complaints because a remote server
has no diagnostics of its own.

---

## ~~L-04 — The launcher~~ · **done**

`src/extend/mcp/launcher.ts`. Both conditions hold. A row saved the way settings
will save it is started through the supervisor and answers a request, and the
secret tests assert it reaches the one variable it was asked for, appears in no
other, is not written back onto the record, and is in neither the message nor
the report of a failure.

It is also the only place a transport is chosen, which is what keeps ADR 0027's
promise real: everything above takes a channel and never asks which kind.

**A dead scope was found while writing it.** `CredentialScope` included `mcp`
and `assertValidKey` checked against two literals that did not, so every store
path refused it and the scope was unusable — the type said yes and the guard
said no. The check now runs against the list the type is derived from. Six tests
depend on the fix; reverting it fails all six.

**What it does not do, on purpose:** it reads one project root, because one
project is open at a time. `L-05` is where that stops being enough.

---

## ~~L-05 — The supervisor's key is an id, not a launch~~ · **done**

`C-18` is now answered in full. The supervisor holds one process per **launch
key**, and two projects with different roots get two processes — proved by a
test that reads the working directory each child actually reports.

**The launcher owns the key**, because the launcher is what varies it.
`McpLauncher` became `{ key, open }` rather than a bare function, so the
supervisor cannot guess a key and does not learn what a project is.

**A remote server shares one connection**, deliberately. It has no working
directory, so there is nothing project-shaped to get wrong; a key that varied on
something the far end cannot observe would open a second session for no reason.

**`stop(id)` stops every process of that server.** Uninstalling, editing, and
switching off all mean the server, never "the copy rooted in one folder". A
sibling left running is a server the user believes is gone.

**One list, three readers.** `McpServerRegistry.reachKey` is now the single
spelling of "the fields that matter", and `reachChanged` is a comparison of two
of them. It answers all three questions that used to be able to disagree: does
an edit revoke the approvals, does an edit force a restart, and are two launches
the same launch.

---

## ~~L-06 — The tool-definition hash is not on a grant~~ · **done in task 007**

`hashToolDefinition` is stored on MCP grants, compared during authorization, and
definition changes force a new approval. Migration 8, grant-store tests, and the
MCP runtime path prove the rule.

The definition hash is part of the grant lookup and changed definitions return
the explicit review message before any effect executes.

---

## ~~L-07 — Revoke has no caller~~ · **done in task 007**

`McpManagementService` calls `revokeNamespace` when a server reach changes and
when it is removed. Title-only edits preserve grants; reach edits and removal
revoke them, with management tests covering all three cases.

`McpServerRegistry.reachChanged` remains the shared field list for restart and
revocation.

---

## ~~L-08 — Honest silence~~ · **done in task 007**

`CallGate.list()` reports withheld capabilities once with the capability and
switch name. The native and MCP registration paths use the same gate callback.

The stronger rule this came from is worth keeping either way: **write the error
message before the schema.** A state whose message cannot be written is a state
that should not be stored.

---

## ~~L-09 — Nothing is wired~~ · **done in task 007**

The MCP registry, inventory, reconciler, supervisor, catalog, management routes,
approval routes, native registrars, and CallGate are wired in `src/app.ts` /
`StudioRuntime`; real stdio and Flue integration tests prove the path. The
bundled library remains an explicit deferred feature.

This is the largest item and every other one either feeds it or is finished by
it.

**Evidence:** a real MCP server answers through the gate, and ADR 0029 defines
that switching it off retains the session tool with an unavailable dispatch
result while a new sandbox omits it.

---

## L-10 — `E-02`, the harness integration test times out · **instrumented, cause still unknown**

It failed a second time on 10 August 2026, which is the trigger its own entry
named. It passes alone and passed on a rerun, again.

**The finding is that two failures produced no evidence between them.** The wait
reported only that a number had been exceeded, so nothing could be concluded
either time. It now reports elapsed time, `pid`, `exitCode`, `signalCode`, the
last probe's error, and the tail of the child's output — enough to tell a slow
boot from a port taken between allocation and use, which are the two guesses.

The budget also moved from 15s to 60s, and that is **not** the fix; it is set far
beyond any plausible boot so that expiry means something is genuinely wrong.

**Done when:** a failure report says why, or the suite runs often enough without
one to call it gone. Not before — closing it on silence is how it comes back.

---

## ~~L-11 — `E-03`, raw errors in the setup CLI~~ · **done**

`src/models/local/cli.ts:59,66` now rejects with `ProviderConfigurationError`
(domain `models`) instead of bare `Error`. `tests/unit/architecture.test.ts:260`
now asserts zero bare constructions.

---

## L-12 — Harness client admission and local listener boundary · **in progress; Host and client implemented, cargo verification pending**

The Harness now has one inbound admission boundary in
`src/transport/http/create-app.ts`; missing or invalid credentials are rejected
before Flue, MCP, or permission handlers, and valid contexts are checked for
operation scopes. The checked-in Flue CLI patch and
`src/host/harness-launcher.ts` enforce `127.0.0.1`, `PORT=0`, FD4 bootstrap and FD3 readiness; `STUDIO/src-tauri/src/harness/` now owns the child with the same contract (eager start, `get_harness_endpoint`/`restart_harness`, `RunEvent::Exit` shutdown, new credential on restart), and `STUDIO/src/platform/harness/` + `useFlueChatSession` connect the desktop via `@flue/sdk`.

This is not an MCP-only concern. An outsider must not be able to submit a Flue
agent request, mutate MCP configuration, or answer a permission prompt merely
because it can reach a local HTTP port. Authentication is global; operation
scopes remain domain-specific; capability effects still go through
`PermissionKernel` and `CallGate`.

The architecture is settled in ADR 0028. The admission contract, verifier, HTTP
composition, headless launcher, Tauri Host, desktop client, and focused tests are
implemented; the remaining verification (cargo build + desktop E2E) is in
`tasks/phase-11-mcp/006-harness-admission.md`.

**Done when:** every Harness route rejects an absent or invalid admission
credential before route execution, the local listener is explicitly loopback-
only with structured endpoint readiness, the credential is per-launch and
memory-only, the desktop performs a real authenticated Flue conversation, and
the browser/local-access surface does not receive the Harness credential.

---

## Not loose ends, recorded so they are not re-raised

- **`003.1`, `003.2`, `003.3a`, `003.3b`** — done, with callers arriving in
  `L-09`.
- **`003.5` part A** — done.
- **The wire layer, era probe, connection, stdio channel, handshake, supervisor,
  reconciler** — done and tested against fakes.
- **HTTP+SSE** — never implemented, decided in `C-16`. Not missing.
- **Roots, Sampling, Logging** — never implemented, deprecated in the revision we
  adopt. Not missing.
