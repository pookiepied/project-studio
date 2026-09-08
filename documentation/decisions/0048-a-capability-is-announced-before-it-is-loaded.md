# ADR 0048 — A Capability Is Announced Before It Is Loaded

**Status:** Accepted · 2026-09-07
**Builds on:** [ADR 0029](0029-mcp-session-tool-membership.md) — session tool
membership is append-only. That decision says a tool, once in the array, never
leaves it. This one says how a tool gets in.
**Builds on:** [ADR 0024](0024-capabilities-are-on-and-the-list-is-honest.md) —
the list the model sees is honest. The rule survives: what is listed is
callable. This adds a second surface, which is not a list of tools and does not
claim to be.
**Amended by:** [ADR 0049](0049-the-browser-is-ours-the-engine-is-the-machine-s.md)
§5. Section 3 below says system provenance loads eagerly, and that conflated two
independent axes: **who owns a capability** and **how expensive it is to load**.
A Studio-owned browser is still twenty schemas. The corrected rule is that
eagerness follows size and generality, not ownership — eager is for capabilities
small enough and general enough that most turns might use them, which means the
natives. Everything else is discovered, whoever wrote it. The original text
stands below; the wrong answer and why we believed it is the useful part.
**Implements:** `architecture/mental-model.md` §3.2 and §3.4. §3.2 already
places an *"MCP / connector / skill inventory, plain English, session-stable"*
in the system block; §3.4 already calls progressive discovery *"one round trip
and zero cache damage"*. Neither says how. This does.

## Context

Enabling an MCP server exposes every one of its tools, in full, on every
request.

`refreshTools()` in `application/studio-runtime.ts` takes each enabled server's
catalog and calls `gate.register` on all of it; the `tools:` callback returns
`gate.list()` whole. A 34-tool server enabled for a project therefore puts 34
JSON schemas in the cached prefix of every turn of every conversation in that
project, whether or not the work has anything to do with that server.

That is affordable for one small server and stops being affordable quickly.
Four servers of the size third parties actually ship — a browser, a 3D tool, a
game engine, a compositor — is well over a hundred schemas, and the cost is not
only tokens. Tool selection gets worse as the list grows: a model choosing
between 130 tools, 128 of which are irrelevant to the sentence it was given,
picks wrong more often than one choosing between six.

The state model is what makes this hard to fix by halves. Six states are worth
telling apart, and the codebase already tells apart four of them:

| State | Where it lives today |
|---|---|
| **Installed** | `extend/mcp/registry.ts` — a row saying a server exists |
| **Connected** | `extend/mcp/supervisor.ts` — a live channel to it |
| **Enabled** | `extend/selection.ts` — global / project / conversation |
| **Discoverable** | *nowhere* |
| **Loaded** | *nowhere* — collapsed into Enabled |
| **Invocable** | the availability predicate, then `CallGate` and the kernel |

Enabled collapses straight into Loaded. There is no state in between, so there
is no way to say "this server is available and I have not paid for it yet".

The constraint that shapes every answer is in `mental-model.md` §3.3 and is not
negotiable: **adding to the tools array is free and removing from it is
ruinous.** `[A,B,C] → [A,B,C,D]` keeps the cached prefix and bills only `D`.
`[A,B,C,D] → [A,B,D]` diverges at position 3, which sits before both the system
block and the whole conversation, so a hundred-thousand-token conversation
re-bills at full rate. ADR 0029 drew the correct conclusion — membership is
append-only — but append-only makes the *first* load of a tool the expensive
decision, because it can never be undone within a session.

## Decision

**A capability is announced in prose, and its schema is loaded on request.**

Two surfaces, and the difference between them is the whole decision.

### 1. The inventory is prose in the system block, not tools in the array

Every enabled server contributes a few lines to a new section of the system
prompt: its identity, what it is for, how many tools it has, and their names.
No schemas, no parameters, no examples.

```
# Capabilities available on request

mcp:blender — Blender scene and object manipulation — 34 tools
  add_camera, add_light, apply_material, create_scene, delete_object, …

mcp:browser — Browser automation and page reading — 28 tools
  click, extract_text, navigate, screenshot, wait_for, …
```

Names, not descriptions, per tool. A name plus the server's own sentence is
enough for a model to decide whether to look further; a description per tool is
most of a schema's cost for a fraction of its use.

**It goes in the system block and never in the tools array.** The array is the
list of what may be called, and ADR 0024's rule — everything listed is callable
— stays true because nothing here is listed there. The two surfaces answer
different questions: the array says *what you can do*, the inventory says *what
you could ask for*.

**It is session-stable, so it caches.** The inventory is settled once per
conversation, from the registry and the catalog, and does not change afterwards
for any reason. Loading appends to the array — which is the free direction —
and leaves the system block byte-identical.

*Corrected during implementation.* This first said "built once when the sandbox
is created", and there is no such moment: Flue re-runs the agent render every
turn and re-creates the sandbox per submission, so there is no sandbox-lifetime
hook to hang it on. The memo is keyed by conversation, which is the lifetime the
system block is actually cached against.

*And stricter than §5 first allowed.* §5 below says a `list_changed` refresh
rebuilds the inventory prose. It does not. A refresh that landed mid-conversation
would move the system block and re-bill the entire history behind it, and a
background reconnect finishing is not worth that. The rule that wins is this one:
once settled, the block does not move for the life of the conversation. A server
whose tools changed is described by its old sentence until the next
conversation, which is a stale sentence rather than a wrong tools array — and
the array is what governs what can actually be called.

*One narrow exception, found by hand (2026-09-08): settling is deferred while
an enabled server has not answered yet.* The stability rule is about the block's
*content* after it settles; it was silently also deciding the question of
*when* settling happens, and the first turn is not always the right answer to
that. The render that builds the inventory runs before the sandbox factory
launches a newly switched-on server — that is the harness's measured ordering,
not an accident — so a conversation whose first turn races a settings change
builds its note against a catalog that is still empty. Freezing there printed
`mcp:firecrawl — search and read of the internet — 0 tools` for a server that
was starting, and kept that sentence for the conversation's whole life. That is
not a stale sentence, the case the rule above already weighed and accepted; it
is a wrong one, written before the server ever had a chance to answer, and the
note is what the model reads before it knows to ask.

So the block settles only when the answer is one worth keeping: when every
enabled server has either completed a catalog read (the supervisor's `ready`
*and* the catalog's read, because `ready` lands at the handshake, before
`tools/list`) or failed terminally (`given-up` — a server mid-backoff is still
trying, and settling on its worst moment would describe a server that recovers
as one that has nothing). Until then the block renders one honest pending
sentence.

**And the replacement happens only between submissions, never within a
run.** Flue re-renders the agent function for every model step and *digests
the composed instruction document*: a run whose system prompt changed between
step one and step two is narrated an instructions signal, re-runs the model,
and re-bills the prefix mid-turn — the ruinous direction of §3.3, taken inside
a single turn, which no exception may do. (Measured, not assumed, and measured
twice: an earlier draft of this fix re-asked the pending note per render, and
a later one re-asked it inside the sandbox factory's `createSandbox` — which
Flue awaits once per submission, but *after* the first render has already
composed the run's instructions. Each placement moved the digest between two
steps of one submission, the signal landed between the discovery step and the
tool step, and the integration suite failed with the run settling as text
instead of calling. The seam that works is the harness's own turn-settings
middleware, which runs after the submission's settings are settled and before
Flue composes anything: strictly between runs.) The settled-ness exception
therefore has one seam — the pre-run middleware re-asks a pending note, and a
run's every render reads the same memoized string, pending or true. The cost
lands where it was priced: one re-billed system block on that conversation's
*second turn*, against a wrong system block for life. The two settled answers
that must not be disturbed are part of the same rule — a conversation with no
enabled servers settles immediately and keeps its byte-identical empty block,
and a connected server that genuinely exposes nothing settles on its true
`0 tools`, because the condition reads the supervisor and the catalog, never
the emptiness of the tool list.*

### 2. One discovery tool, taking a scope

```
native/discover  { scope?: string }
```

Absent scope lists the servers with their tool names — the same content as the
inventory, for a model whose inventory has scrolled out of a long conversation.
A server id (`mcp:blender`) returns that server's tools with descriptions. A
tool id (`mcp:blender/add_camera`) returns the full schema **and registers that
tool into the gate**, so the next array the model is given contains it.

*Measured during implementation, and better than this first said.* The original
wording was "the next turn's array", which assumed the array is rebuilt once per
submission and that a model discovering a tool would have to wait for the user's
next message to call it. Flue rebuilds the tool array for every model **step**,
so the tool arrives on the step immediately after the discovery — the model
discovers and calls within one turn, with no round trip through the user. The
discovery's answer says "from your next step" for this reason, and the
integration test drives exactly that sequence. An earlier draft of that test
assumed the submission boundary and deadlocked waiting for a turn that had
already gone as far as it could, which is how the difference was found.

**One tool with an argument, not a family of tools.** A `discover_all`, a
`discover_mcp` and a `discover_mcp_blender` are three permanent schemas in the
cached prefix, one of them per server, to express what one argument expresses —
and the per-server variant grows the always-loaded set with every server
installed, which is the cost this ADR exists to remove.

**Registration is a side effect of discovery, deliberately.** The alternative —
discover, then a separate load call — is a second round trip before any work
happens, and there is no case where a model reads a schema and does not want to
call it. A discovery that returned a schema the model could not then call would
be a schema shown for nothing, which is the exact waste being removed.

**Loading is one tool, not one server.** Asking for `add_camera` loads
`add_camera`. A model that needs four Blender tools loads four, and the array
grows by four rather than by 34. Coarser loading would make discovery a
lower-resolution version of the current problem.

### 3. Native tools stay eagerly loaded, and so do system servers

The natives are the ones every turn might use — read, write, shell, search,
plan. Putting them behind discovery would cost a round trip on almost every
turn to save a prefix that is already paid for and already cached.

Some MCP servers belong on that side of the line too: capabilities that are
part of Studio rather than something a user attached. Those are marked in the
registry as **system** provenance and load eagerly, exactly as if they were
native.

**Which side a server sits on is decided when it ships, and moving it later is
expensive in one direction only.** Discovered → eager is free: the array grows.
Eager → discovered is a *removal*, and removal is the ruinous direction of §3.3
for every conversation that already carries it. A capability whose placement is
uncertain therefore ships discovered, because that is the reversible choice.

### 4. Discovery is bounded by enablement, and enablement is unchanged

Discovery can only reach what the three-scope selection spine already resolved
to enabled for this conversation. It is not a way to reach a server the project
did not enable, and it is not a permission: a discovered tool still passes
`CallGate` and the kernel on every call, still requires approval, and still
carries the definition hash that invalidates that approval when the schema
changes (ADR 0029 §5).

So the layering is: **enabled decides what may be announced, discovery decides
what is loaded, the kernel decides what may run.** Three questions, three
places, none of them able to answer another's.

### 5. A list-changed notification does not disturb what is loaded

ADR 0029 §6 already says `notifications/tools/list_changed` marks a catalog
dirty and refreshes at the next turn boundary. The catalog refreshes; **the
inventory prose does not**. See the correction under §1: a system-block change
mid-conversation re-bills the whole history, and a server changing its tool list
is not worth that. The refreshed catalog governs what discovery can load and
what a call reaches, which is the half that has to be current.

A tool that vanishes from a refreshed catalog stays in the array and fails at
dispatch with the existing unavailable result. Unchanged from 0029, and for the
same reason.

## What was weighed

**A. Announce in prose, load on request (chosen).** Costs one round trip the
first time a capability is used in a session, and costs the inventory's own
tokens — a few lines per server, paid every turn. Buys back every schema of
every server the conversation does not touch.

**B. Load everything, as today (rejected).** No round trip, and the cost grows
with what the user installed rather than with what the conversation needs. The
failure is not gradual: the fifth server is the one that makes a project's every
turn expensive, and the person who added it has no way to see that is what they
did.

**C. Load a server's whole catalog when any of its tools is wanted
(rejected).** Fewer round trips than per-tool. But the unit of waste becomes the
server, and servers are exactly the things that ship 34 tools — a conversation
that needs `add_camera` would carry 33 schemas it will never call, for the
lifetime of the session, because membership is append-only.

**D. Remove tools when a server is disabled (rejected, again).** This is the
question ADR 0029 already answered. Repeated here because the discovery
mechanism makes it tempting a second time: if schemas can be added mid-session,
why not taken back? Because taking one back invalidates the prefix, and the
model of a session that pays for its whole history on every toggle is the model
0029 was written to prevent.

**E. Put per-tool descriptions in the inventory (rejected).** More useful to the
model, and most of a schema's token cost. The names plus one sentence per server
is the point at which the inventory is still cheap enough to be worth its place
in the prefix.

## Consequences

- A project may enable many servers without every conversation paying for all
  of them. Cost follows use rather than configuration.
- A model pays one round trip the first time it reaches for a capability in a
  session, and nothing thereafter.
- The tools array is no longer a complete account of what the conversation can
  reach. The inventory is the other half, and anything reading "what can this
  conversation do" has to read both.
- A conversation that discovers heavily ends up with a long array, and that
  array is append-only for the session. A new session starts clean.
- Where a capability sits — eager or discovered — becomes a shipping decision
  with an asymmetric cost, and the reversible default is discovered.
- The system block gains a section that changes when a server's tool list
  changes. Rare, and no longer free.

## Required proof

- An enabled server with tools contributes no schema to the tools array, and
  its identity, purpose, tool count and tool names to the system block.
- A system-provenance server's tools appear in the array with no discovery
  call.
- Discovery with no scope lists servers; with a server id lists that server's
  tools; with a tool id returns one schema and registers one tool.
- A tool registered by discovery appears in the model's next step, within the
  same turn, and the system block is byte-identical across that turn.
- Discovery cannot reach a server that resolves to disabled for the
  conversation asking.
- A discovered tool still requires approval, and a schema change still
  invalidates the grant through its definition hash.
- Disabling a server after its tool was discovered leaves the tool in the array
  and makes the call fail as unavailable.
- A conversation with no enabled servers has a system block with no inventory
  section in it — byte-identical to one built before this ADR.
- A conversation whose first turn races a newly switched-on server is not
  frozen on `0 tools`: the note settles only once that server has answered,
  and the settled note names its real tools.
- A server that is connected and genuinely exposes nothing settles on its true
  `0 tools`, and a conversation with nothing enabled settles on the empty
  block, immediately in both cases.
