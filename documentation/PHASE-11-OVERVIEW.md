# Where Phase 11 stands

A readable account, not a checklist. For the operational version — what to
read before working, how to route an issue, what "done" requires — see
`tasks/META-INSTRUCTIONS.md`. For the line-by-line record, see
`tasks/003-phase-11-work-plan.md` and `tasks/005-phase-11-loose-ends.md`.

This document is a snapshot. Trust the source files it summarizes over this
prose the moment they disagree.

---

## What STUDIO is

Project STUDIO is a local-first, general-purpose agent runtime with a desktop
face. Two halves: `STUDIO/` is the Tauri desktop UI, `STUDIO HARNESS/` is the
TypeScript runtime it talks to as a separate process. Neither contains the
other.

It is open source, which is a design constraint and not a footnote — every
decision has to serve someone who forks the project, not only the person who
wrote it. It aims to be small enough to read in an afternoon, to connect
capabilities rather than reimplement them, and to require no external
infrastructure to run.

## What Phase 11 is

MCP — the Model Context Protocol. The phase that lets STUDIO reach servers it
did not write: local processes over stdio, or remote endpoints over HTTP. Two
protocol eras exist in the wild (legacy, back to 2024, and a modern revision
from mid-2026), and STUDIO speaks both from one client.

Phase 11 is organized as eight numbered pieces, `003.1` through `003.8`, and
tracked in one running document that explains *why* each was built the way it
was: `tasks/003-phase-11-work-plan.md`. A second, shorter document exists
because a long "why" entry about a finished piece reads exactly like one about
a half-finished piece — `tasks/005-phase-11-loose-ends.md` asks the harsher
question directly: what is still not done.

## The shape the phase was built in, on purpose

Every piece of Phase 11 was built and tested against a fake before it was
connected to anything real. The registry, the connection, both transport
channels, the handshake, the supervisor, the reconciler — each has its own
test file, each passes against a scripted double, and until recently none of
them had a caller anywhere in `src/`.

That was a deliberate choice, not neglect, and it was named explicitly in the
loose-ends file the moment it was measured: *"a complete MCP client that
nothing has ever run."* The risk that shape carries is specific — a bug that
only shows up when two real pieces meet cannot be found by testing each piece
alone. One did show up exactly that way (`S-04`, `Windows delivered PATH to
every child we spawned` — found the moment a real process was spawned) and
became the reason later items were tested end-to-end deliberately, not just
against fakes.

## What is built, in the order it had to be

**The wire layer and the connection.** JSON-RPC framing, request correlation,
an era probe that decides legacy vs. modern in one exchange, and
`McpConnection` — the one object that owns "what happens when the other side
goes away."

**Two channels, one seam.** `StdioChannel` runs a local server as a child
process. `HttpChannel` speaks Streamable HTTP to a remote one. Neither the
connection, the framing, nor the handshake changed when the second channel was
added — proof the seam was drawn in the right place. Where HTTP could not
fit the duplex shape a child process gives for free (a failed POST has no
separate response ever coming; a remote server has no stderr), those two
decisions are written down in their own ADR rather than left implicit in code.

**The destination guard, and the client that exercises it.** A rule of who may
reach what: a person typing an address into settings may reach their own
network; a model producing one mid-turn may not; a cloud metadata endpoint and
STUDIO's own listening ports are refused whoever asked. That rule sat unused
until a client existed that could open a connection at all — `src/net/http.ts`
is that client, and it turned out pinning has two parts (resolve once, judge
every address returned, connect only to the one judged) and a redirect has an
author nobody had asked about: the server on the other end, judged as the
stricter case regardless of who started the request.

**The launcher.** The piece that turns a stored database row into a running
program or connection. It holds two things nothing else in the system may
hold: the project's root directory, and a secret read from the OS credential
store at the exact moment of the launch, never written down.

**One process per launch, not per server.** Two projects with different roots
now correctly get two separate processes for the same locally-run server,
closing a question that had been open since the reconciler was first built —
a server switched on in one project and off in another must never mean the
process serving the first project gets silently killed. A remote server, by
contrast, has no working directory to vary on, so two projects reaching the
same endpoint correctly share one connection.

## What is still open, and why it matters

Six items remain, and they fall into two different kinds of waiting.

**Real feature work, not yet started.** A tool's declared shape is not yet
tied to the specific approval a user gave it, so a server could change what a
tool claims to do after being approved once (`L-06`). Editing or removing a
server does not yet revoke the permissions it was granted (`L-07`). A
capability hidden by a project's settings currently disappears with no
explanation instead of a stated reason (`L-08`). And the largest remaining
item by far — nothing in the running application actually calls any of this
yet. The registry, the reconciler, and the supervisor exist and work, and
nothing wires them to the permission kernel or to a settings screen a person
can see (`L-09`).

**Known but unresolved defects, narrower in scope.** An integration test times
out intermittently under load, now instrumented with enough detail to diagnose
next time it happens, but the cause itself is still unknown (`L-10`). And a
setup CLI raises two bare errors that should carry a proper domain (`L-11`).

None of these is hidden. Each has an entry stating exactly what is missing and
what "done" will require.

## How a defect gets handled here

This project does not let a found defect become a private observation. Three
outcomes exist for anything found along the way, and only three: fixed in the
same pass and recorded as such, filed as an open issue with a stated reason it
is waiting, or filed as an accepted limitation with the reasoning written down
so it reads as a decision rather than as something overlooked. Nothing is
found and then simply not mentioned again — the discipline is that the next
person reading the documentation should never have to wonder whether something
observed was acted on.

Three defects surfaced and were fixed during the work that produced this
overview, each the same shape: a rule that had been written and tested, and
was never actually reachable by anything real. A destination guard that could
never fire because nothing had registered the port it was meant to protect. A
credential scope that had been added to a type but not to the guard that
checks it, so every attempt to use it would have failed silently. Neither was
exploitable when found — both failed closed rather than open — but both meant
a piece of the system had been quietly inert since it was written. That
pattern is exactly what the remaining wiring work (`L-09`) exists to close out
for good: a rule that is tested but never called is a rule nobody will notice
breaking.
