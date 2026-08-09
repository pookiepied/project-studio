# Task 003 — Phase 11 work plan

Design lives in `tasks/002-phase-11-mcp.md`. This file is the order of work and
the record of what an adversarial review changed.

**Rule for every item below:** write the test, revert the fix, confirm the test
fails, restore. Recorded in `tasks/README.md` and not restated per item.

---

## What the review changed

A red-team pass over the design and the code it depends on returned six
collisions, three collapse candidates, six bypasses, and one rewrite risk.
Findings that survived checking are folded into the items below. Three did not
survive unchanged and are recorded here, because a review that is only ever
agreed with was not a review.

**Overturned — the `fetch` back door is not live today.** `tasks/002` §13.5
claims the model can `POST` a `tools/call` at a local MCP endpoint. It cannot:
`fetch` is GET-only through a reader service, so our process never opens the
model's URL — `src/tools/web/fetch.ts:63`. Jina cannot reach the user's
loopback either.

That correction has a sharper consequence than the original finding. **Reading
`localhost:3000` through a reader service is impossible by construction**, so
the owner's actual request cannot be satisfied by relaxing the guard. Loopback
needs a direct local HTTP client — which is the same client MCP-over-HTTP
needs, so it is one piece of work, not two. The never-offered rule stays anyway:
it costs one list and it stops being theoretical the moment that client exists.

**Partly overtaken — the capability switches.** The review argued that
`allowExec=off` would silently delete every MCP tool including read-only remote
ones. That was true of §3's blunt declaration and is no longer true after §13.6
split effects by transport: `allowExec=off` removes stdio servers, which is
exactly what the switch claims to do. What survives is the second half — the
removal is **silent**, because `list()` filters without throwing. That is item
7.

**Rejected — dropping per-project selection for skills.** The argument is that a
token-budget decision does not deserve a permission-shaped store. The premise is
right and the conclusion does not follow: the spine is keyed on `(kind, id,
project)` and knows nothing about what a kind *is*, so selecting skills costs one
row and no new code. What the review is right about is already in the design —
skills carry no trust step and their selection is not a security control.

---

## The order

### 003.1 — Split `CapabilityProvenance.trusted` — **done**

Shipped as ADR 0025. `trusted: boolean` became `author: "studio" |
"third-party"`, the sandbox stopped asking who wrote the code, and the switch
check moved ahead of the isolation check so it reaches connected code at last.

`pnpm check` green — 634 passing, up one. Verified both ways: keying
`BASE_POLICY` on `false` fails two Full Auto tests, and dropping the `author`
check from `defaultVerdict` fails one.

Three tests changed meaning rather than being deleted, and one was added. The
review's claim that the existing fixtures "hard-code `trusted` to false" was
wrong — they take it as a parameter with a default, and the Full Auto guarantee
was genuinely asserted. What was true is the part that mattered: those fixtures
build their own descriptor, so they test the *rule* and not the *wiring*, and
the wiring is what would have been given the wrong value.

The second field the review proposed — `in-process` versus `external` — was not
added. Nothing reads it: isolation requirements are the effect table's question
and the folder-wall warning is read from the server record. A field with no
reader is what this codebase keeps deleting.

Also recorded: `P-07`, `shell`'s resource is a program's basename.

<details>
<summary>Original analysis</summary>


One boolean answers three unrelated questions, and Phase 11 breaks the
equivalence that let it:

| Reader | Real question |
|---|---|
| `src/sandbox/local-sandbox.ts:96` | Can our containment reach this code? |
| `src/permissions/policy.ts:93` | Must a human see this at least once? |
| `src/permissions/policy.ts:138` | May this run with no approval at all? |

`native ⟺ we reviewed it ⟺ it runs in our process` held until now. `tasks/002`
D-1 introduces code the user consented to that nobody reviewed, and §12.2
introduces code we reviewed that runs out of process. Both break it, in
opposite directions, in the same phase.

**Setting `trusted: true` on an installed server ships a silent Full Auto
hole.** `BASE_POLICY`'s only rule stops firing, evaluation falls through to
`defaultVerdict`, which returns an `ask` with source `"default"` — and
`resolveAsk("full-auto")` allows a default `ask` unconditionally
(`src/permissions/mode.ts:73`). ADR 0018 states the opposite in prose and names
a test for it.

**The test would not have caught it.** `tests/unit/trust-and-modes.test.ts:175`,
`sandbox.test.ts:312`, and `permissions.test.ts:97` each build their own
descriptor with `trusted` hard-coded to `false`. They keep passing while the
property stops being true of every real MCP capability. That is `S-03`'s shape:
a negative test whose input does not exercise the mechanism it names.

**The fix.** Two fields, each with one reader:

```ts
readonly author: "studio" | "third-party";      // did we write and review it
readonly isolation: "in-process" | "external";  // where it actually runs
```

- `BASE_POLICY` keys on `author === "third-party"`, and stays a **policy** ask,
  which ADR 0018 already guarantees Full Auto cannot resolve.
- `defaultVerdict` keys on `author === "studio"`.
- `assertSupports` keys on `isolation`, and on the capability switches.

**What this retires, said out loud rather than smuggled through a boolean.**
The absolute refusal in `local-sandbox.ts:96` was written when a connected
server had *no consent path at all*. Three explicit user actions now stand
between a server and a call: install with the warning, select it for this
project, approve the call. That is the replacement for isolation we do not
have. `S-02` would let us relax the per-call approval; it was never what made
the capability exist.

An `external` capability whose switch is off is still refused, because that is
what the switch claims to do.

Also in this item, because they are the same edit:

- Rewrite the three fixtures above to exercise the real mechanism.
- A new test: Full Auto must not silently run a third-party external capability.
- ADR 0025, plus an amendment note on ADRs 0012, 0018, 0019, 0022, and 0024 —
  all five state their rule in terms of the one word.

</details>

### 003.2 — Registration must be reversible — **done**

`CallGate.unregister`, `CallGate.unregisterSource`, `PermissionKernel.unregister`,
`CallBounds.undeclare`. All three registries move together, for the reason
`register` is one call.

**The two halves now agree by tightening, not by loosening.** The kernel used to
allow a same-provider repeat as an update. Every native tool shares one
`sourceId`, so that rule silently swallowed the collision it looked like it was
catching. Both halves refuse a duplicate now, and reload goes through an
explicit `unregister` — which cannot happen by accident, which is the whole
difference between an update and a bug.

`unregisterSource` exists because that is the operation that actually happens: a
server is switched off and all of its tools go at once. Removing them key by key
would mean the caller keeping its own list of what that server registered.

A call already admitted runs to completion — `call` captures the tool before it
does anything. Waiting for in-flight work before teardown belongs to the
provider, which is the only thing that knows what teardown means for it. Not
built here, and not needed until 003.6.

Grants are deliberately untouched by unregistering. A server switched off in one
project keeps its approvals in the others; which events revoke is 003.4.

`pnpm check` green — 647 passing, up thirteen. Verified: dropping the kernel
line fails 3, dropping the bounds line fails 1.

### 003.2b — original notes

`CallGate.register` throws on a duplicate key (`gate.ts:89`); `kernel.register`
silently replaces when `sourceId` matches (`kernel.ts:156`). Two halves of one
call with opposite semantics for a repeat. There is no `unregister` anywhere.

Hot reload is a repeat registration and a removal, so neither exists yet.
`#tools`, the kernel registry, and `CallBounds.declare` must move together or
drift.

### 003.3a — How state is actually held

Asked before writing the spine, because the answer decides its shape.

**We already have a state store and no state system.** SQLite is the store, with
real transactions (`storage/database.ts:39`). What does not exist anywhere in
`src/` is a single event emitter, observer, or subscription — the only `emit` in
the codebase is the logger's. In-memory state lives in plain unwatched `Map`s:
`gate.ts:65`, `kernel.ts:104`, `bounds.ts:165`.

That has been fine because nothing changed at runtime. Phase 11 is the first
thing that does.

#### Three kinds of state, and each already has a home

| Kind | Example | Where it lives | Rule |
|---|---|---|---|
| Durable, user-set | installed servers, per-project selection, grants | SQLite | the source of truth |
| Derived | health, admissibility, protocol era | computed on demand | never stored |
| Live objects | a running process, an open connection | the supervisor, keyed by id | never durable |

The rule from the review holds and is what keeps the state count at three:
**store what the user sets, never store what the system computes.**

#### What is missing is the edge, not the store

When durable state changes, the derived and live layers have to catch up. That
is the only gap, and it needs exactly one mechanism.

**A reconciler, not events.** The desired set is computed from SQLite, compared
against what is live, and the difference is applied.

Events were the obvious alternative and are the wrong one here:

- **An event system is fragile in one direction only, and it is the bad one.**
  Miss one — a crash between the write and the notify, a listener registered a
  moment late, a row edited by a migration — and the live state is wrong
  permanently, with nothing to correct it. Reconciling recomputes from the
  truth every time, so a missed change costs one cycle of staleness rather than
  a permanent lie.
- **It is idempotent**, so running it twice is safe, which means it can be run
  on a timer, at startup, after a crash, and on demand, with one implementation.
- **It is testable without a process**: give it a desired set and a live set and
  assert the difference. An event chain has to be observed to be tested.

The cost is honest: a change is applied at the next reconcile rather than
instantly. That is not a cost here, because the design already requires the
delay for a different reason — the tool list sits in the cached prompt prefix,
so it may only change at a turn boundary.

#### Where it runs, and what stops it running twice

Reconcile is called at a turn boundary and at startup. It is **single-flight**:
one in progress, a second request coalesced into it. Two concurrent reconciles
would spawn the same server twice.

A generation counter tells a cheap "has anything changed" from a full pass, so
the common case — nothing changed — costs one integer comparison.

#### The reconciler must not learn what MCP is

Same rule as the spine itself, and the same architecture test protects it. The
spine holds reconcilers by kind and calls them; it never names one. The type it
stores is `(desired, live) => Promise<void>` with no MCP types in it, so a
fourth kind adds a folder and edits nothing.

#### The one place a state machine is warranted

A single server's lifecycle has genuinely illegal transitions — `ready` cannot
follow `stopping`, `starting` cannot be entered twice — and those are the bugs
that produce two processes for one server.

```
idle → starting → ready → stopping → idle
          ↓         ↓
        failed ← ───┘  (with backoff, and a give-up state)
```

A union type and one transition function that refuses an illegal move. Not a
library, and not a general state-machine abstraction for the whole harness: this
is the only place where the illegal transitions are real.

**Nothing else changes.** No event bus, no observables, no subscriptions, no
store framework. The one mechanism is reconcile, called at one moment, and the
one state machine is per connection.

### 003.3b — The extend spine — **done**

`src/extend/inventory.ts`, `selection.ts`, `errors.ts`, migration 6, and two
architecture tests. `pnpm check` green, 693 passing, up sixteen.

**Two things changed from the plan while building, both toward less.**

**The stored column is a boolean, not `unlisted | off | on`.** Those three are
what a settings screen *renders*, and only one of them is a decision the user
made. `unlisted` means the extension is not installed, which the provider
already answers by not listing it, and storing it would be storing what the
system computes. So the store holds `enabled`, absence means off, and the third
state is derived by the thing that renders it. The rule that produced this is
the same one that cut the review's 32 states to 3.

**There is no reconciler yet.** 003.3a decided its shape and that stands, but
nothing live exists for it to reconcile — the spine touches no process and no
connection. Building it now would be an abstraction with one imaginary caller,
which Working Rule 8 refuses. It arrives in 003.6, with the first thing that can
actually drift.

**What the architecture tests hold.** Nothing at `src/extend/*.ts` may import
from a subdirectory, and no kind's *vocabulary* may appear there — `stdio`,
`jsonrpc`, `transport`, `frontmatter`, `hookEvent`. The kind identifiers
themselves are allowed, because they are keys and `inventory.ts` must spell them
to have a union at all. The distinction is the point: naming a kind is not
knowing what it does.

**`extend` is a new error domain.** The closed union in `contracts/errors.ts`
invites this — "a new subsystem adds its domain here". It earns one because the
answers differ: a refused call sends a person to an approval dialog, and a
switched-off server sends them to settings.

Verified three ways: dropping the `enabled` filter in `active` fails 3 tests,
breaking the project term in the selection query fails 1, and adding a
subdirectory import to `inventory.ts` fails the architecture test by name.

### 003.3b — original notes

`inventory.ts` and `selection.ts` at the root of `src/extend/`. One stored
column per pair: `unlisted | off | on`.

**Store what the user sets; never store what the system computes.** Health, era,
admissibility, and connection state are derived and reported. The era cache is
the one deliberate exception and is labelled as one.

The review's state count was 32 before grants, era, or folder trust. The rule
above is what keeps it at three.

Per-server trust is **not** a store. `undecided` is unreachable — you cannot
install without passing the dialog — and `untrusted` is indistinguishable from
uninstalled at every observable point. Installation is the consent record.
`extend/mcp/trust.ts` is dropped from the design.

One architecture rule: nothing at `src/extend/*.ts` may import from a
subdirectory of `src/extend/`.

### 003.4 — Grant lifecycle — **the revoking half done**

`PermissionGrantStore.revokeNamespace`. `pnpm check` green, 699 passing, up six.

**Why a namespace and not a source id.** A grant is keyed on `capability_key`,
which is `namespace/name`, and an MCP server's namespace is `mcp:<serverId>`.
Revoking by namespace needs nothing new stored; revoking by `sourceId` would
need a column that repeats what the key already says.

**Matched by exact prefix, not `LIKE`.** A namespace is user-influenced text and
`%` and `_` are `LIKE` wildcards, so `mcp:a_b` would also match `mcp:axb`. The
separator is part of the prefix for the same class of reason: without it,
removing `mcp:blender` takes `mcp:blender-beta` with it. Both are tested, and
swapping the query to `LIKE` fails exactly those two.

**Marks rather than deletes**, like every other revoke here, so reinstalling
re-asks instead of silently inheriting.

**It is not the same call as `CallGate.unregister`.** Those happen together and
mean different things, and one call doing both would make "unregistering is not
revoking" impossible to say.

**What is deferred, and why it is not a gap.**

- *The tool-definition hash.* Delegated as `004.F`. The column and the
  comparison land when the function does; writing my own now would mean two
  hashes to reconcile.
- *Revoking on edit and on uninstall.* The mechanism exists; the callers do not.
  An MCP server cannot be edited yet because it cannot be added yet. Wired in
  `003.8`, with the management surface.
- *An MCP tool's resource is `undefined`.* A rule for `003.6` to obey, not code
  to write here. `capabilityKey` already encodes the server.

### 003.4 — original notes

Revoked on remove, on uninstall, and on any edit to command, arguments,
transport, or URL — `revoke` marks rather than deletes
(`grant-store.ts:228`) and nothing calls it today.

A tool-definition hash — name, description, input schema — stored on the grant.
`kernel.register` replaces a descriptor silently whenever `sourceId` matches, by
design, because that is the update path; nothing protects the `description` the
approval dialog showed. One column and one comparison now, or a migration and a
re-derivation of every grant's meaning later.

**An MCP tool's resource is `undefined`.** `capabilityKey` already encodes
`mcp:<serverId>/<toolName>`, and grants match on `capability_key` first. A
resource string would encode the same fact a second time into
`resource_pattern`. `tasks/002` §7 says this loosely and is corrected here.

### 003.5 — The destination guard — **part A done**

Shipped: `classifyHostPort`, `destinationResource`, `src/net/own-ports.ts`, and
a port-aware split of the IPv4 and IPv6 checks. `isPrivateHost` keeps its
signature and delegates. Nothing observable changed — all four non-public
classes are still refused with the same kind and message.

`pnpm check` green, 677 passing, up thirty. ADR 0022 amended, `C-17` moved to
half built.

**Written by a delegated model against `tasks/handoff-003.5.md`, and reviewed
here.** Recorded because the result decides whether we do it again.

The work was correct. What review added: `.localhost` is loopback under
RFC 6761 and had **no test** — a rule the delegate added on its own initiative
and did not cover, which is the predictable shape of the failure. An IPv6
resource is now bracketed, because `::1` plus port 443 reads as `::1:443`, which
is another valid address, and a resource string is compared against a stored
grant. The second parse of the same URL is gone with its unreachable `catch`.

**The structural finding is about documentation, not code.** The handoff
forbade touching `docs/` on purpose — a delegate does not hold the reasons ADRs
record, and a wrong amendment note is worse than a missing one. So delegated
work always arrives with its documentation undone, and that half stays here.
That is a property of the method, not a fault of the delegate, and it is the
line along which work can be split at all: **rule work can go out, and the
record of why cannot.**

### 003.5 — part B, still to do

The split in `tasks/002` §9, plus two things the review found:

- `isPrivateHost(host)` never sees a port (`net/destination.ts:123`), so the
  host+port resource (`C-17`) and the own-ports rule cannot be expressed. The
  signature changes and we keep a registry of ports we listen on.
- A direct local HTTP client for loopback, shared with MCP-over-HTTP.

**MCP-over-HTTP inherits work `retrieval/` never had to do.**
`retrieval/http.ts:58` satisfies ADR 0022's "refuse again after DNS and on every
redirect" by refusing redirects outright to fixed provider endpoints. An MCP
client talking to a user-supplied host cannot do that, so DNS-rebinding and
redirect validation are new.

### 003.6 — MCP transport and protocol

stdio and Streamable HTTP; the era probe; modern and legacy behind one seam.
Process lifetime per §13.8 — drained `stderr`, per-server startup timeout, tree
kill via Job Objects, backoff with a give-up state.

### 003.7 — Honest silence

A capability that vanishes from `list()` because a switch is off throws nothing,
so nobody learns why. At minimum one startup line naming what was withheld and
which switch did it.

The review's stronger form of this is worth keeping as a rule: **write the error
message before the schema.** A state whose message cannot be written is a state
that should not be stored.

### 003.8 — MCP capabilities, the management tool, the bundled library

`tasks/002` §4.3, §11, §12. Last, because each depends on everything above.

---

## Recorded, not scheduled

**`shell`'s resource is a basename** — `shell:${name.toLowerCase()}`,
`src/tools/shell/resolve.ts:49`. A project that granted `shell:node` an `always`
has authorized running any Node script, including any MCP server's entry point,
installed or not, selected or not. The extension layers gate *our connection* to
a server, never the server's binary.

This is a property of shipped code, not of this design, and it is the same
accepted trade as `shell` in general. It belongs in `KNOWN-ISSUES.md` as a
granularity gap, not in this phase.

**A subagent inherits the parent's selection.** Grants carry `agent_id` and the
kernel refuses a blank one, so approvals do not leak. Selection is keyed on
`(project, server)` with no agent term and is resolved before the gate, so a
subagent sees exactly the parent's server set.

ADR 0012 lists subagent policy derivation as undecided. Phase 11 must not answer
it by accident in a store that is hard to re-key. The position: selection stays
project-level, and narrowing a subagent's tools is the agent profile's job in
Phase 13, which the roadmap already assigns there. Written down so it is a
decision rather than a side effect.
