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

**There was no reconciler at this point.** 003.3a decided its shape and that
stands, but nothing live existed for it to reconcile — the spine touched no
process and no connection. Building it here would have been an abstraction with
one imaginary caller, which Working Rule 8 refuses. It arrived in 003.6, with
the first thing that could actually drift, and waiting is what surfaced the case
the design had not named: an edited record is invisible in the desired set.

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

### 003.5 — part B — **done: the policy and the client**

**`C-17` is answered and built.** `judgeDestination(raw, author)`. The guard
follows who wrote the address, and the full table is in `check-later.md`. What is
worth repeating here is the part that changed while building it.

**`metadata` became its own host class.** It used to be folded into `private`,
and that stopped being right the moment `private` became reachable for somebody:
a person typing an address is deciding about their own network, and no decision
they can make turns a cloud credential endpoint into a legitimate destination.
The whole link-local block is refused rather than the one famous address, plus
the three endpoints outside it — Alibaba's inside carrier-grade NAT, Oracle's
inside IETF protocol assignments, AWS's IPv6 one inside unique-local. A range
rule catches none of those three.

**`own-port` is refused for a person too.** Reaching our own service is
escalation rather than a network call; someone typing it has misunderstood
rather than decided, and it would be a loop even if they had not.

**Allowed is not approved.** Nothing in this function grants anything. Every
destination still goes through the kernel with the resource it returns. The
policy decides what may be *offered*, which is the distinction `C-17` existed
for.

**`fetch` is unchanged on purpose.** It still refuses every non-public address —
not by policy, but because it reads through a service that is not on this
machine and cannot serve one. Written as its own check with its own comment, so
a transport limit is never mistaken for a judgement about the address.

Verified by inverting the author test: refusing a person their private network
instead of a model fails 2.

**A dead guard was found while checking what has callers.** `registerOwnPort` was
never called by anything in `src/`, so the `own-port` class could never be
returned and the rule protected nothing — while `google-login.ts` was binding a
loopback port to receive an OAuth authorization code. Recorded as `A-02` and
fixed, deliberately *before* the client lands, because the client is what makes
loopback reachable and a registration added afterwards would have been missing
for exactly as long as it mattered.

**The client is built.** `src/net/http.ts`, on `node:http`/`node:https`. It is
now the only place the harness opens an outbound connection itself, and the
relaxation above is exercised rather than asserted.

**The rule the item did not predict.** A `Location` header is an address, and it
is written by neither the user nor the model — it is written by the server being
talked to. `C-17` had no answer for that author because it had never had a
client that could follow one. Every hop after the first is judged as `model`,
the stricter side of the table, whoever the caller was; `authorization`,
`cookie`, and `proxy-authorization` are dropped when the origin changes. ADR
0026.

**Pinning turned out to be two rules, not one.** Resolve once and connect to the
judged address — otherwise the check and the socket ask the same question twice
and may get two different answers. And judge **every** address the resolver
returned, not the one that will be used: a name answering with one public and
one refused address would otherwise pass by chance of ordering. Removing the
second half fails 3 tests, which is how it was confirmed to be doing work.

**A field with no reader was deleted mid-build.** The pin first carried an
address *and* a socket family, plus a custom `lookup` that fed both back to
Node. Breaking the custom `lookup` failed nothing — `host` already holds the
literal address, so nothing resolves a second time — and the family had no
remaining reader. Both removed. A guard no test can fail is a guard nobody will
notice breaking.

**`DestinationError` moved to a `network` domain.** It reported as `retrieval`,
which was only true while page reading was its one caller. Three subsystems that
share nothing else now ask it the same question.

Everything still unfinished is in `tasks/005-phase-11-loose-ends.md`.

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

### 003.6 — MCP transport and protocol — **the registry done**

`src/extend/mcp/registry.ts`, migration 7, and a third credential scope.
`pnpm check` green, 717 passing, up eighteen.

**Why this half and not the transport.** The transport's wire layer is exactly
what `004.A` to `004.E` are, and they are out with a delegate. Writing my own
framing, JSON-RPC types, correlation, backoff, and lifecycle would mean two of
each to reconcile. So this turn built everything the transport stands on and
nothing it shares.

**What the record holds, and what it must not.** How to reach a server, and
nothing about whether it is allowed. Selection is `extension_selection`,
approval is the kernel. A row here implies neither.

**No column holds a secret.** A bearer token, or the value a local server reads
a key from, lives in the OS credential store under a new `mcp` scope. The row
holds `auth_env_var`, the *name* of the variable the value is injected into at
spawn time. An earlier draft named that column `secret_env_name` and the
migration guard refused the migration — the guard doing exactly its job, on the
first real chance it had.

**A command is checked when it is added, not when it is spawned.** A refusal at
spawn time reaches nobody who can act on it and leaves a row that looks
installed and can never run. Relative paths are refused, and so are `.cmd`,
`.bat`, and `.ps1` — running one needs a shell, and a shell reintroduces the
argument parsing we removed on purpose. That refusal carries the fix, because
most npm-installed servers arrive as a `.cmd` on Windows and it is the message a
user is most likely to meet.

**The endpoint guard is deliberately not `fetch`'s.** A user typed this URL into
a settings form, and a local server is the ordinary case. The *shape* is checked
here — `http` or `https`, well formed — and where it points is judged where the
connection is made, which is the only place that can also judge a redirect.
`C-17` still owns the policy.

**Two tests were passing against broken code and were fixed.** On Windows the
`.exe`-only rule masks both the absolute-path rule and the shim rule, so
deleting either left the suite green. The first now uses a path that only the
absolute rule can refuse; the second asserts the *message*, since the message is
the whole value of the shim rule.

**The era probe and the connection — done.** `wire/era.ts` and `connection.ts`.
907 passing, up twenty-five.

`readEraProbe` is a pure function from one answer to a named era, so every shape
a server might send is testable without one running. The middle row is the one
worth having written down: a modern server that refuses our protocol version
answers with an *error*, so treating any error as "not modern" downgrades a
server that just told us what it was — and the legacy attempt then fails and
reports the wrong thing. It keys on the whole `-32020`..`-32099` reserved band
rather than `-32022` alone, because raising any of them demonstrates modern
vocabulary.

`McpConnection` owns the two things the wire layer cannot: what happens when the
other end goes away, and what happens to everyone waiting when it does. A dead
channel with requests still in the map means promises that never settle, which
presents as an agent hanging with nothing in any log.

**The channel is injected**, so a misbehaving server is provoked exactly and in
order without spawning anything — the same reason the wire layer is pure. One
adapter is left that cannot be tested this way, and it is deliberately the
smallest part.

`stderr` is always drained, because a pipe nobody reads fills and then blocks
the process writing into it; a server that logs enough would hang rather than
fail. It is bounded to the last lines, because the failure is at the end, and a
death quotes the last line rather than reporting only "it stopped".

**The stdio channel — done.** `stdio-channel.ts`. 914 passing, up seven.

It reuses the spawn contract rather than restating it: `assertRunnableCommand`,
`buildEnvironment`, and `killProcessTree` are the same ones `git` and `shell`
use, now exported. The tree kill matters more here than anywhere — an MCP server
is usually `node` running someone else's entry point, and that entry point may
start whatever it likes.

**Two defects found by building it, and the second is the important one.**

*Output before a listener was dropped.* The process starts, survives the startup
window, and only then does a connection subscribe. Everything a fast server said
in that gap had no reader — which is precisely the output that explains a bad
start. Buffered now, and handed over in order when a listener attaches.

*`S-04`: Windows delivered `PATH` to every child we have ever spawned.*
`buildEnvironment` left it out of its allowlist and the comment claimed that
mattered. libuv merges it back in regardless — measured with `env: {}`, which
still delivers `PATH` and six more. So `git`, `ripgrep`, `shell`, and MCP could
all resolve any program on the machine by name.

Nothing caught it because the test inspected **our object** rather than a child.
The same shape as `S-03`. Fixed by setting `PATH` to `""` rather than omitting
it — **omission is not refusal on this platform** — and the test now asserts
against a real spawned child. Full detail in `KNOWN-ISSUES.md`.

**The handshake and the supervisor — done.** `handshake.ts` and `supervisor.ts`.
951 passing, up thirty-seven.

**Two files, not one, because they have different subjects.** The supervisor's
subject is a process — start it, retry it, give up on it. The handshake's is a
conversation. A server that runs perfectly and speaks a protocol we do not have
is a different failure from a server that will not start, and merging them would
report the first as the second.

**Joining the pieces found the gap `era.ts` could not see.** `readEraProbe`
needs the whole JSON-RPC answer, because the *code* is what separates a modern
refusal from a legacy server that does not know the method. `McpConnection`
unwraps — a success becomes its `result` and an error becomes a rejection with
the code discarded. So the probe as written could not be run over the connection
built for it.

Fixed with one extra method, `requestEnvelope`, used by exactly one caller.
Unwrapping is right for every ordinary call and wrong for this one; unwrapping
first and re-deciding after would mean reconstructing what was just thrown away.
Transport failures still reject — for this caller an error *is* the answer, but
a dead connection is not an answer at all.

**A timeout on the probe is legacy; a death is not.** Silence is exactly what
`era.ts` calls `no_answer`, and an old server that has never heard of
`server/discover` is the ordinary case. A connection that *died* is not
translated: sending `initialize` to a server that is gone replaces an accurate
failure with a confusing one.

**Fail fast, recover quietly.** `ensure` waits for the attempt in progress and no
longer, so a tool call never sits through fifteen seconds of backoff; the retry
is scheduled behind it, so the next caller finds a server that has recovered.
Single-flight, because two processes for one server is the failure that is
hardest to see — both work, and nothing looks wrong until something counts them.

**Stopping forgets the server rather than remembering it stopped.** A stopped
server has no attempt count worth keeping and no failure worth showing. It also
means a server that had given up gets a clean start when it is switched back on,
which is what a person switching it back on is asking for — and it is why
`lifecycle.ts` needed no new transitions. Stop-while-starting is handled by a
generation counter, not by a `starting --stop--> stopping` edge: the process was
already spawned and cannot be un-spawned, so what is actually needed is for the
attempt to find its generation stale and close what it built. Widening the state
machine would not have given that.

**Nothing is closed in the failure path**, because on both paths that reach it
the connection is already closed — a start that failed closed what it built, and
a connection reports its end only after ending. Closing again is the one call
that could re-enter it, and a second `failed` from a state that has already
recorded one is an illegal transition. Written down because it reads like a
missing line.

**Verified by breaking six rules.** Removing single-flight fails 1; removing the
close on a failed start fails 2, both about a process left running; passing
`attempts` instead of `attempts - 1` to backoff fails the give-up count;
disabling envelope routing fails 8 in the supervisor alone; dropping the immediate call for a listener
that arrives after the end fails 1; falling back to legacy when no modern
version is in common fails 1.

**The reconciler — done.** `src/extend/reconcile.ts` and
`src/extend/mcp/reconcile.ts`. 974 passing, up twenty-three.

Built as 003.3a wrote it: desired computed from SQLite, compared against live,
difference applied. Still no event bus, observable, or subscription anywhere in
the harness.

**One deviation from the design, and it is the same rule the design is made of.**
003.3a named the stored type `(desired, live) => Promise<void>`. It takes only
`desired`, because `live` is the one thing the spine must not hold — a running
process belongs to whatever started it, and a spine carrying live objects knows
what a kind is by definition. The difference is still computed against a plain
set and still tested without a process; that is `planReconcile`, a pure function
over two lists of ids.

**One case the design did not name: an edited record.** A server whose command,
address, or environment changed is invisible in the desired *set* — the id is in
both lists, the plan says do nothing, and the old process keeps running with the
old configuration until the harness restarts. The MCP reconciler remembers what
each live server was started with and compares against `reachChanged`, which
until now had no runtime caller. Deliberately the same field list that
invalidates a permission grant: if an edit means the approvals no longer apply,
it also means the process no longer matches. A title change is neither.

**A failing server is not asked for again.** The obvious form — start everything
desired that we have not started — resets the supervisor's backoff to nothing on
every turn boundary, which turns a growing wait into a tight loop. What is
started is the plan's own `start` list, so a server that is failing is still
known to the supervisor and left to its own retry, and a server that has given up
stays given up.

**It reconciles every open project, not one — `C-18`.** The first version took a
single project id, which made a server switched on in project A and off in
project B into one process being asked for opposite things. That was a defect in
the reconciler, not in the model: switching something off decides what a project
**sees**, and it was never a decision to end a process. The rule was already
written down — *enabling can only subtract; it never grants* — and a tool that is
never listed is never registered and never reaches the gate, whether or not a
process is running.

So the desired set is the union across open projects. Something runs while at
least one project wants it and stops when none do, which is reference counting
written as a set so there is no count to drift.

**What that does not answer.** A process is started *somewhere*. A local server is
spawned with the project root as its working directory, so a filesystem server
started in project A and shared with B would give B a server rooted in A — the
folder wall failing with correct tools, the wrong project, and no error. The
sharing rule is therefore *same server id and same launch*, which makes the
supervisor's key a composite. That cannot be built honestly until the launcher
exists, because the launcher is what varies it. It lands with 003.8, and the
union does not change when it does. One project is open at a time today, so every
launch is identical by construction.

**One pass at a time, harness-wide.** A second call for the same projects joins
the one running; a different set queues behind it.

**One kind failing decides nothing for the others.** Every kind is attempted and
the failures are collected. A broken hook that stopped MCP from starting would be
a failure nobody could diagnose from either side. A failed pass is not recorded
as settled, so the next call runs again rather than believing the live set
matches.

**The architecture guard caught the new file** on its first run — a comment used
the word `prompt`, which the spine reserves as a kind's vocabulary. The comment
changed, not the rule.

**Verified by breaking five rules.** Starting from `startedWith` instead of the
plan fails the retry-storm test; dropping the `reachChanged` comparison fails the
edited-command test; reading the generation after the pass instead of before
fails the mid-pass test; removing the single-flight join fails 1; and the guard
above failed by itself.

**Still to build:** a launcher — the supervisor takes one rather than spawning,
because starting a real server needs a project root and, for a server that reads
a key from its environment, a secret fetched from the credential store at that
moment. Neither belongs in a class that holds live objects. That wiring is
003.8. Streamable HTTP is still open and waits on `003.5` part B.

### 003.6 — Streamable HTTP — **done, and the seam held**

`src/extend/mcp/http-channel.ts`, the sibling of `StdioChannel` and the second
transport the connection has never had to know about. `McpConnection`, the
framing, the era probe, and the handshake are **unchanged**. The tests drive a
real connection and a real handshake over a real HTTP server, because a test
that spoke to the channel directly would have passed while that claim was false.

**Two things a duplex seam cannot express, and what was done about them.** Both
are in ADR 0027, and both are places the channel does more than move bytes.

A **failed POST is the answer**, because no separate response is ever coming in
this transport. A `502` is turned into a JSON-RPC error for the request that
POST carried, with code `-32000` — outside the band the era probe reads, so a
transport failure can never look like a refused protocol version. Recording the
status and stopping was the more honest option and much worse: every call would
wait out its full timeout with the reason only in a log. A notification gets no
answer, and the test asserts the absence.

**`onStderr` carries the transport's own complaints**, because a remote server
has no diagnostics and `send` cannot throw. An empty method there would mean a
failed exchange left no trace anywhere.

**A timeout refuses one call; unreachable ends the channel.** A slow answer is
one call going badly. A server that cannot be reached is the connection being
over, and only ending it gives the supervisor its backoff.

**`requestStream` was pulled out of `requestDirect`** so a body can be read as it
arrives. An event stream must be acted on message by message, and a ceiling
applied by the reader would have to buffer the whole stream to count it. One
judge-and-pin path, two ways to read the result.

**Verified by breaking six rules:** the event-stream decoder fails 2, the session
echo 1, ending on unreachable 1, the synthesised answer 1, the ceiling 1. The
notification guard failed nothing until an assertion was added for it — a guard
no test can fail is a guard nobody will notice breaking.

### 003.6 — The launcher — **done**

`src/extend/mcp/launcher.ts`. The supervisor takes a launcher rather than
starting servers itself, and this is what that was for: starting one needs the
**project root**, which becomes the child's working directory, and the
**secret**, read from the credential store at that moment. A supervisor holds
live objects for a whole session, and a secret must not live that long.

**The record still holds no secret.** It holds the name of the variable a local
server reads it from, or the name of the header a remote one wants it in. The
value is read here, once, per launch, into an environment object that is
discarded when the call returns.

**The strongest test is the end-to-end one.** A row saved through
`McpServerRegistry` the way settings will save it, started through
`McpSupervisor` the way the reconciler will start it, answering a request. Every
piece had been tested against a fake; this is the first time two real ones had
to fit.

**A dead scope was found while writing it.** `CredentialScope` had `mcp` in the
type and `assertValidKey` checked against a pair of literals that did not, so
every store path refused it. The `mcp` scope had never been usable. The check
now runs against the list the type is derived from, so a fourth scope cannot
repeat it. Reverting the fix fails six tests.

**Verified by breaking four rules:** starting in our own directory instead of
the project's fails 2; dropping the secret into the environment fails 1; reading
a secret for a server that wants none fails 1; and the scope revert fails 6.

**What it deliberately does not do.** It reads one project root, because one
project is open at a time. `L-05` — the supervisor keyed on the launch rather
than the id — is now unblocked, and `projectRoot()` is the thing that varies.

### 003.6 — One process per launch — **done, and `C-18` is closed**

The supervisor held one process per server **id**. It now holds one per **launch
key**, and `C-18`'s second half is answered: two projects share a process only
when the command, the arguments, the environment, and the working directory are
identical.

**The launcher owns the key.** `McpLauncher` became `{ key, open }` rather than a
bare function, because a supervisor that computed the key would have to know
what a project root is — and a supervisor that guessed one is the bug itself.
The failure being prevented has no error message: a filesystem server started in
project A and handed to project B answers every call correctly, with the wrong
project's files.

**A remote server shares one connection, on purpose.** It has no working
directory, so nothing project-shaped can be got wrong, and a key that varied on
something the far end cannot observe would cost a session and buy nothing.

**`stop(id)` stops every process of that server.** Uninstalling, editing, and
switching off all mean the server, never one folder's copy of it. A sibling left
running is a server the user believes is gone.

**One list, three readers.** `McpServerRegistry.reachKey` is now the single
spelling of the fields that matter, and `reachChanged` compares two of them. It
answers all three questions that could previously disagree: does an edit revoke
the approvals, does an edit force a restart, and are two launches the same
launch. The environment is sorted before it is compared, so the order keys were
written in no longer decides whether a process restarts.

**The test churn was the point.** Twenty call sites passed a bare function as a
launcher, and every one had to say what its key is. A `key` that could be
omitted would have been the same defect with a default.

**Verified by breaking three rules:** a key that ignores the project root fails
1; a key that varies the root for HTTP fails 1; a `stop` that ends only the first
match fails 1.

### 003.6 — original notes

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
