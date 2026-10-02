# Where Phase 11 stands

A readable account, not a checklist. For the operational version — what to
read before working, how to route an issue, what "done" requires — see
`documentation/README.md` and the remediation register
(`../work/phases-1-11-remediation.md`), which superseded this phase's task
files in the 2026-08 consolidation. Those task files were archived, not all of
them faithfully: of `tasks/phase-11-mcp/` only the 002 design and the 008
completion record survive, under `../archive/phase-11-mcp/` — the 008 is the
readable detail behind the register's #49–#62. The rationale the 003 work plan
carried lives in the ADRs (0029, 0048) and the code's own comments; the
Harness-client boundary this phase planned is ADR 0028 with ADR 0040's second
transport; the P1/P2 audit remediation the 007 file tracked is the register's
#36–#42 and #78–#80 rows.

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

Phase 11 is organized as eight numbered pieces, `003.1` through `003.8`. Their
build rationale lived in a running work plan, and a second, shorter document
asked the harsher question directly — what is still not done
(`tasks/phase-11-mcp/003-work-plan.md`, `005-loose-ends.md`). Neither survived
the 2026-08 consolidation; what they settled now lives in the ADRs (0029, 0048)
and, for what was never finished, the remediation register's Needs
Implementation rows.

## The shape the phase was built in, on purpose

Every piece of Phase 11 was first built and tested against a fake, then task 007
assembled the runtime against real MCP/Flue paths. The registry, connection,
both transport channels, handshake, supervisor, reconciler, catalog, CallGate,
management, approval, and native registrar now have source callers and
regression evidence.

That layering was deliberate, not neglect. The remaining risk is now the
boundary work that cannot be proven by an in-process fake: packaged listener
ownership, desktop bootstrap, and the current Gateway wire contract.

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

The remaining items fall into three kinds of waiting.

**Implemented remediation.** L-06 through L-09 are closed in task 007: grant
definition hashes, revocation callers, withheld diagnostics, and live MCP/native
gate wiring are source-backed and tested. ADR 0029 resolves the session
membership contract.

**Known but unresolved defects, narrower in scope.** An integration test times
out intermittently under load, now instrumented with enough detail to diagnose
next time it happens, but the cause itself is still unknown (`L-10`). And a
setup CLI raises two bare errors that should carry a proper domain (`L-11`).

The remaining packaged Host seam is tracked as L-12 and A-04; the headless
listener/readiness path is implemented and tested. OAuth, bundled library,
model-facing management, desktop transport, and account-backed product identity
remain explicitly deferred or pending rather than silently claimed.

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
