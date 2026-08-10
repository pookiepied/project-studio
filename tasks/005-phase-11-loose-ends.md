# Task 005 — Phase 11 loose ends

Everything in Phase 11 that is started and not finished, in one place, so that
"we built the MCP client" cannot be mistaken for "MCP works".

`tasks/003-phase-11-work-plan.md` is the order of work and the record of *why*.
This file is the shorter, harsher question: **what is not done.** When an item
here is finished, cut it to one line pointing at the work plan entry that
records it, and never delete the line — a loose end that was closed should not
be re-discovered as new.

**The rule for this file:** an item is done when something in `src/` calls it,
a test proves the rule it exists to enforce, and the documentation says why. Two
of three is a loose end.

---

## The finding that reframes the list

**Every module built in Phase 11 has zero callers in `src/`.** Measured, not
assumed — `McpServerRegistry`, `ExtensionInventory`, `ExtensionSelectionStore`,
`ExtensionReconciler`, `McpSupervisor`, `createMcpReconciler`, `judgeDestination`,
`revokeNamespace`, and `hashToolDefinition` are each imported only by their own
tests.

That is not a defect on its own. It is the shape the phase was deliberately
built in: every piece is tested against a fake, and the wiring is 003.8. But it
means the honest summary of Phase 11 today is **"a complete MCP client that
nothing has ever run"**, and the loose ends below are mostly the difference
between those two sentences.

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

## L-02 — The direct HTTP client · **003.5 part B, the remaining half**

The `C-17` policy is built and has no client to exercise it. Missing:

- A client that opens a local connection, rather than reading through a service.
- **DNS pinning.** Resolve, judge every returned address, connect to the address
  we judged. Judging a name and then letting the stack resolve it again is the
  rebinding attack written as a race.
- **Redirect re-judging.** ADR 0022 says every destination is checked; a redirect
  is a new destination. `retrieval/http.ts` satisfies this by refusing redirects
  outright to fixed endpoints, which a user-supplied host cannot do.
- A size ceiling and a deadline, as `exec.ts` has.

**Constraint:** no new dependencies, so this is `node:http`/`node:https` rather
than a custom `fetch` dispatcher. That is also what makes pinning possible —
connect to the IP, set `Host`, set the TLS `servername`.

**Done when:** a test resolves a name to a refused address and the request never
opens a socket, and a redirect to a refused address is refused mid-request.

---

## L-03 — Streamable HTTP transport · **003.6, blocked on L-02**

An `McpChannel` over HTTP, the sibling of `StdioChannel`. HTTP+SSE is never
implemented — decided in `C-16`.

**Done when:** the same `McpConnection` and the same handshake run over it with
no MCP-layer changes. If either needs a special case, the channel seam is wrong.

---

## L-04 — The launcher · **003.6/003.8**

`McpSupervisor` takes an `McpLauncher` and nothing constructs a real one. It is
the piece that needs the two things the supervisor must not hold:

- the project root, which becomes the child's working directory;
- the secret for `authEnvVar`, read from the OS credential store **at spawn
  time**, held for the length of the call, and never stored.

**Done when:** a server installed in settings actually starts, and a test proves
the secret does not appear in the record, the log, or an error message.

---

## L-05 — The supervisor's key is an id, not a launch · **`C-18`, second half**

The union across open projects is built. The remaining half: two projects may
share one process only when the command, arguments, environment, **and working
directory** are identical. A filesystem server started in project A and shared
with B gives B a server rooted in A — the folder wall failing with correct
tools, the wrong project, and no error.

Deliberately blocked on `L-04`, because the launcher is what varies the key.

**Safe today** because one project is open at a time, so every launch is
identical by construction. **Done when:** `stop` takes that key, and a test
proves two projects with different roots get two processes.

---

## L-06 — The tool-definition hash is not on a grant · **003.4, second half**

`hashToolDefinition` exists (`004.F`) and has no caller. The column and the
comparison do not exist.

Without it, `kernel.register` replaces a descriptor silently whenever `sourceId`
matches — which is the correct update path — and nothing protects the
`description` the approval dialog showed. A server can be approved with one
description and then present another.

**Done when:** the hash is stored with the grant, compared on the call, and a
changed definition re-asks. **Write the message before the column:** what the
user is told when a tool has changed under an approval decides whether the
column is worth having.

---

## L-07 — Revoke has no caller · **003.4, third half**

`PermissionGrantStore.revokeNamespace` works and nothing calls it. The events
that must call it are editing a server's reach and uninstalling one, and neither
is possible yet because a server cannot be added yet.

`McpServerRegistry.reachChanged` is the field list, already used by the
reconciler to decide a restart. The same list decides the revoke, and it must
stay one list.

**Done when:** editing reach in settings revokes, uninstalling revokes, and a
test proves a title change revokes nothing.

---

## L-08 — Honest silence · **003.7, not started**

A capability that disappears from `list()` because a switch is off throws
nothing, so nobody learns why. At minimum one line naming what was withheld and
which switch did it.

The stronger rule this came from is worth keeping either way: **write the error
message before the schema.** A state whose message cannot be written is a state
that should not be stored.

---

## L-09 — Nothing is wired · **003.8, not started**

The list at the top of this file, closed. The MCP registry registers itself as
the inventory's `mcp` provider; the reconciler is called at startup and at a
turn boundary; a server's tools reach the kernel through `CallGate`; the
management surface exists; the bundled library ships.

This is the largest item and every other one either feeds it or is finished by
it.

**Done when:** a real MCP server installed by a person answers a real tool call
through the gate, and switching it off in settings removes its tools from the
next turn.

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

## L-11 — `E-03`, raw errors in the setup CLI · **small, adjacent**

`src/models/local/cli.ts` rejects with bare `Error` in two places. Recorded in
`KNOWN-ISSUES.md`; listed here because the architecture rule names it as the
exact remaining offender, and a list of exceptions that grows is a rule that
stops meaning anything.

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
