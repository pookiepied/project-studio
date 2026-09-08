# Capability discovery — the plan

**Status:** Steps 1-4 landed · **Opened:** 2026-09-07 · **Last worked:** 2026-09-08
**Decision:** [ADR 0048](../decisions/0048-a-capability-is-announced-before-it-is-loaded.md)
**Rests on:** [ADR 0029](../decisions/0029-mcp-session-tool-membership.md) (append-only membership),
[ADR 0024](../decisions/0024-capabilities-are-on-and-the-list-is-honest.md) (the list is honest),
`architecture/mental-model.md` §3.2–3.4 (the cache arithmetic)

ADR 0048 says what the design is. This says what has to be built, in what
order, and what each step must not break. Nothing here reopens the decision.

---

## 1. What is already true

More than the shape of the problem suggests. Measured by reading the code, not
the documentation.

| Piece | State | Where |
|---|---|---|
| Installed servers, as durable rows | Built | `extend/mcp/registry.ts` |
| Connect, supervise, reconnect | Built | `extend/mcp/supervisor.ts` |
| `tools/list`, paginated, malformed entries withheld | Built | `extend/mcp/capabilities.ts` |
| Three-scope enablement, narrowest-first, absent ≠ off | Built | `extend/selection.ts` |
| Stable server identity `mcp:<id>`, tool key `mcp:<id>/<name>` | Built | `registry.namespaceOf`, `capabilityKey` |
| Operation and tool-call identity, parent links, retry semantics | Built | `execution/context.ts` |
| Definition hash invalidating a grant on schema change | Built | `permissions/grant-store.ts` |
| `notifications/tools/list_changed` → dirty → refresh at turn boundary | Built | `supervisor.ts`, `capabilities.ts` |
| Dispatch-time availability predicate for a disabled server | Built | `capabilities.ts` `createTool` |
| Global MCP settings UI | Built | `STUDIO/src/features/settings/mcp/` |
| Project-scope enablement over HTTP | Built, **no UI calls it** | `routes/mcp.ts` |
| Conversation-scope enablement | Store only — **no route, no client** | `extend/selection.ts` |
| Inventory prose in the system prompt | Built | `context/capability-inventory.ts` |
| Discovery tool | **Missing** | — |
| Withhold-by-default in `refreshTools` | **Missing** | `studio-runtime.ts:921` |
| A server's purpose sentence, and system vs user provenance | Built | `extend/mcp/registry.ts`, migration 22 |

Two facts worth carrying into every step below.

**`refreshTools()` is the single place exposure happens.** It filters the
registry by resolved enablement and registers everything the catalog holds for
those servers. Every change to what the model sees goes through that one
function, which is why this is a contained piece of work rather than a
re-architecture.

**`McpServerRecord` has no description and no provenance.** It has `title`,
which is a label for a settings row, not a sentence about what a server is for.
Both the inventory and the eager/discovered split need fields that do not exist
yet, so a migration comes before anything the model can see.

---

## 2. Order, and why this order

The dependency that fixes the order is the cache asymmetry. Loading a tool
eagerly and moving it behind discovery later is a *removal* for every
conversation that already carries it, and removal is the ruinous direction. So
the discovery mechanism must exist before any large server ships, and the
browser is a large server.

Steps 1–3 are the mechanism. Step 4 makes configuration reachable. Steps 5–6
are the first real consumers, and they are the point at which the design is
actually tested.

---

### Step 1 — The record learns what a server is for, and whose it is

**Migration.** Two columns on the MCP server table:

- `description` — one sentence, the server's purpose in the user's words or the
  server's own. Shown in the inventory and in the settings row. Not the title.
- `provenance` — `system` or `user`. A system server ships with Studio and
  loads eagerly; a user server is discovered. Defaults to `user`, because ADR
  0048 §3 makes discovered the reversible choice.

**Why first.** Everything downstream reads these. Adding them later means the
inventory ships with a placeholder sentence and the eager/discovered split ships
as a hardcoded id list, both of which are the kind of temporary thing that stops
being temporary.

**Do not** put a tool count in the row. It is a property of the live catalog,
changes on `list_changed`, and a stored copy is a second source of truth that
goes stale silently.

**Proof:** a migration test on an existing database; `assertSafeMcpRecord`
rejects a description long enough to be a prompt injection surface; the settings
row renders the sentence.

---

### Step 2 — The inventory, in the system block

**Build it where the prompt is assembled** — `agents/studio.ts`, beside the
environment block, from `registry.list()` filtered by resolved enablement, with
counts and names from `catalog.tools(ids)`.

**Shape** (ADR 0048 §1): server id, purpose sentence, tool count, tool names.
No per-tool descriptions.

**The three rules it must keep, each of which is a test:**

1. **Absent when empty.** A conversation with no enabled servers produces a
   system block byte-identical to today's. Same rule the background-jobs block
   already follows, and for the same reason — the block is the cached prefix of
   every request, and a section that says "nothing" is a permanent cost for no
   information.
2. **Session-stable.** Settled once per conversation and never moved again —
   not by discovery loading a tool, not by a server reconnecting, not by a
   `list_changed` refresh. If any of those changed the inventory, it would
   invalidate the system block *and* the whole conversation behind it, which
   would make the mechanism cost more than the problem.

   *Corrected during step 2:* this first said "built once per sandbox", and
   there is no such moment — Flue re-renders the agent every turn and
   re-creates the sandbox per submission. The memo is keyed by conversation,
   which is the lifetime the system block is actually cached against. ADR 0048
   §1 and §5 have been reconciled to match.
3. **Untrusted.** The purpose sentence and the tool names come from a third
   party. They sit in the system block, which is the most trusted position in
   the prompt. They must be length-capped, control-character-stripped, and
   introduced by a line saying whose words they are — `capabilities.ts` already
   argues this case for tool *results*, and this is the same argument one layer
   earlier.

**Proof:** the empty case is byte-identical; a server contributes id, sentence,
count and names; a hostile description cannot break out of its section; the
block does not change across a turn that discovers a tool.

**Landed 2026-09-07.** `src/context/capability-inventory.ts`, migration 22, and
`#enabledMcpServers()` — one filter now feeding both the prose and the tools
array, so the two can never describe different configurations. Harness 1792,
client 847. Six negative controls, including one proving the extracted filter
still drives exposure rather than being dead code.

**Two things step 3 inherits.** The heading is `# Capabilities`, worded to be
true while tools are still eager; step 3 should reword it, and that is a one-off
system-block change for conversations that already exist. And `provenance` has
exactly one value in practice — nothing writes `system` yet, and the client
deliberately cannot — so step 3 or the first system server is what gives that
column a second value.

---

### Step 3 — `native/discover`, and withhold-by-default

Two halves of one change, landed together because either alone is a broken
state: withholding without discovery removes capabilities, and discovery without
withholding adds a tool nobody needs.

**The tool.** One capability, `native/discover`, taking an optional `scope`:

| Argument | Answers | Side effect |
|---|---|---|
| absent | the servers, their sentences, counts, tool names | none |
| `mcp:blender` | that server's tools, with descriptions | none |
| `mcp:blender/add_camera` | the full schema | registers that one tool |

`effects: ["read"]` — the same declaration `plan`, `ask` and `jobs` carry.
Reading a catalog reaches nothing, and registering a schema is not an effect on
the user's machine. What the discovered tool may then *do* is the kernel's
question, per call, unchanged.

**Refusals must name the remedy.** An unknown server id says which servers this
conversation has; a server that resolves to disabled says so and says where it
is enabled, rather than pretending not to exist — a model told "no such server"
about a server the user can see in settings will conclude Studio is broken.

**The withhold.** In `refreshTools()`, register eagerly only servers whose
provenance is `system`; everything else waits for discovery. Discovery
registers into the same gate by the same key, so a tool loaded twice is the
existing no-op.

**The thing most likely to go wrong:** discovery registers into the gate, and
`gate.list()` is read inside the `tools:` callback at the start of an
operation. A tool registered *during* an operation appears in the next one, not
the current one. That is correct and must be stated in the tool's own answer —
otherwise a model discovers `add_camera`, calls it in the same turn, and gets
"no such tool" from a system that just handed it the schema. The answer should
say the tool is available from the next step, and the harness should verify that
is actually when it lands.

*Measured, and the "operation" turned out to be the step.* Flue rebuilds the
tool array for every model step, not once per submission, so a discovered tool
is available on the very next step of the same turn — the model discovers and
calls without a round trip through the user. The tool's answer says "from your
next step" and means it literally. The first integration test written for this
assumed a submission boundary, scripted a two-message dance, and deadlocked
waiting for a turn that had already finished; that deadlock is how the real
boundary was found.

**Proof:** every bullet in ADR 0048's *Required proof*, and specifically that a
user server contributes zero schemas until discovered, that a system server
contributes its schemas with no discovery call, and that a discovered tool is
callable on the model's next step while the system block is unchanged across
that turn.

**Landed 2026-09-08.** `src/tools/discover/` (one capability, `native/discover`,
`effects: ["read"]` like `plan`, `ask` and `jobs`) and the withhold in
`refreshTools` — eager registration narrowed to `system`-provenance servers,
with this conversation's discoveries re-registered at each turn boundary. One
thing the plan did not spell out and the implementation had to: the registration
bookkeeping in `createAgentSandbox` dies with the submission (Flue re-creates
the sandbox per submission), so what discovery adopts is remembered as
capability keys on the runtime, keyed by conversation, and the next
submission's `refreshTools` re-registers them from the catalog's current
definitions. Keys, not definitions — which is also what makes 0029 §5's
definition replacement happen for a discovered tool whose connection
refreshed. The heading is now `# Capabilities available on request` and the
intro names the tool; the same one-off system-block change covered the
Extensions section of the static system prompt, whose next sentences the
withhold had made untrue.

---

### Step 4 — Make the other two scopes reachable

The spine has three scopes; the app can write one.

- **Project.** The route exists and the client method exists. What is missing is
  a screen: MCP servers listed in project settings, each `on` / `off` /
  `inherit`, where `inherit` is a real third value and not a spelling of `off` —
  the route already models it as `null` and the UI must not flatten it.
- **Conversation.** Needs a route (`PUT /api/mcp/conversations/:id/extensions/mcp/:id`),
  a client method, and a place to put it. Deliberately last: it is the scope
  with the least evidence of being needed, and the two above it are the ones a
  person configures.

**Precedence is already decided and is not reopened here:** narrowest-first,
absence means no decision. Conversation, then project, then global, then off.

#### The mid-conversation question, answered in writing (2026-09-08)

The inventory is settled once per conversation and never moves, because moving
it re-bills the whole conversation behind it. So a person who switches an
extension on while a conversation is open has changed what the tools array can
grow to, but not what the system block says: the model will not learn the
extension exists from this conversation's capabilities note, ever. Three
answers were sketched, and none was chosen, so this writes down what each
costs and recommends one. It remains a recommendation; the decision is a
product one.

First, what already happens without anything new, because it decides what each
option is actually buying:

- **The tools array already tracks the toggle, at the next submission, for
  free in the cheap direction.** `refreshTools` re-reads selection at every
  submission. Switching *on* adds registrations — the append direction of
  §3.3, which costs only the new bytes. Switching *off* removes this
  conversation's adopted registrations at its next submission — which is 0029
  §4's rule (a new submission starts from the current selection) and therefore
  a one-time removal, the expensive direction, already accepted. Within the
  current submission a disabled tool stays listed and fails at dispatch with
  the unavailable result, exactly as 0029 says.
- **The capabilities note never moves.** `CapabilityInventory` is keyed by
  conversation and its entries are never evicted. A toggle mid-conversation
  does not touch it, for any reason, which is ADR 0048 §1 kept.
- **Discovery reads live enablement.** Its scope-less answer lists what is
  switched on *now*, not what the note above the conversation says. So after a
  mid-conversation switch-on, one `discover` call tells the model everything
  the note would have said.

That third fact is the hinge. What option (c) buys, over what the mechanism
already does, is only the prose: (a) and (b) together describe what already
happens, honestly, at zero built cost.

- **(a) Say it on the row.** Wherever a scope's switch meets a conversation
  that is already open, the row says what actually happens: the model meets an
  extension it discovers by asking, or in a new conversation, whichever comes
  first; its capabilities note stays as it began. Cost: one sentence, written
  once, reviewed never. This is the recommendation, because it is the only one
  of the three that adds information the person cannot get anywhere else —
  what (b) does silently and (c) postpones.
- **(b) Apply it to conversations that have not started yet, silently.** This
  is not a choice to make but a fact to keep: a conversation's note is built at
  its first submission from the enablement of that moment, so a decision
  written before the first message silently applies and correctly. Its cost is
  the one (a) exists to cover — nothing tells the person that the *open*
  conversation was not included.
- **(c) Offer an explicit "apply here", accepting the one-time re-billing.
  Not built in this task.** What it costs, concretely: applying in place moves
  the tools array, which sits *ahead of* the system block and the whole
  conversation, so the next request diverges at position zero and bills the
  entire history at full rate once. On a 100k-token conversation that is
  ~100k input tokens at full rate instead of the cached 10% — roughly 90k
  tokens' worth of extra billing, once, after which it re-caches. And what it
  buys is the note, which a `discover` call already answers for — a fair trade
  only for a conversation nobody is steering, where nothing will ever prompt
  the model to ask. So the condition that should reopen (c): the first report
  of a long-running, unattended conversation that missed an extension its
  person switched on, where nobody said "discover it" and the silence cost
  something. Until that happens, (c) is a mechanism looking for its witness.

**Landed 2026-09-08.** The project scope is configured on the project's own
page (`ProjectPage` gained an Extensions section); the conversation scope,
deliberately the smallest, is a dialog beside the conversation's own title.
The route reads answers too: `GET /servers` answers for a project or a
conversation, each row carrying what that scope stored and what the whole
chain resolves to, so a row can be honest about the effect rather than only
the setting. Inherit rides the wire as `null` from the control to the store;
nothing between them flattens it.

Three things the plan did not spell out and the implementation had to:

- **Which project the MCP scope means.** The spine says "project", but the
  harness carries two: the conversation's project record, which the trust and
  sandbox scopes key on, and the harness's own workspace key
  (`projectKey(projectRoot)`), which was the only one the tools array ever
  resolved. Enablement now resolves conversation, then the conversation's own
  project record, then the harness's project, then off — so the project
  screen's decision bites, and a conversation standing in no project keeps
  the wider leg it always had, which is the historic projectless-conversation
  bug's lesson kept. The reconciler hears about every recorded project beside
  the harness's, because a decision made on a project's own screen has to be
  enough to start what that project's conversations will resolve to.
- **The dispatch predicate reads the conversation too.** Registration is
  filtered per conversation, but availability is consulted at call time, and
  until the predicate read the conversation, a tool this conversation had
  switched off still ran within its own submission — disagreeing, in exactly
  the way the discovery's answer warns about, with what that discovery had
  just said. One conversation, three readers, one chain (`#enablementContext`
  in the runtime): the tools array, the discovery, and the predicate now
  resolve it the same way, because two of them answering differently is how
  an announced tool stops being callable.
- **A conversation's note is built from its own chain.** The inventory's
  memoization already keyed by conversation; what changed is that the build
  now reads the conversation id it was handed. Each conversation's note
  settles from its own enablement at its first build and does not move — the
  ADR 0048 §1 rule, whose test was not touched.

Harness 1818 passed, 25 skipped; client 892. Negative controls, restored
afterwards: collapsing Inherit to Off, in both directions the bug has — the
control reading `null` as Off, and the control sending `false` for Inherit —
and the three tests that fail name the Inherit radio; and the conversation
route writing its decision at the project scope, which fails the precedence
test with the conversation row never existing in the store. The
mid-conversation question above is answered by (a), and the two surfaces say
so; (c) stays unbuilt, with its price written down beside it.

---

#### What a live experiment found, and what was done about it (2026-09-08)

The first real MCP server (Firecrawl, 25 tools) was driven by a model in a
real conversation, which produced an incident report. Four things it found
were true, and are now fixed or refused deliberately.

**Fixed.** The capabilities section listed tool names and did not say that a
name there is not yet callable. The model read the list as a list of tools,
emitted a call for one it had never discovered, and its own generation slipped
to the nearest name it *did* hold - which was a different tool, and a billable
one. Two wasted calls. The section now says a name is not callable until
discovered, that nothing is substituted for a name that is not there, and that
what is discovered stays for the rest of the conversation.

**Fixed.** Loading was one tool per call, so a model that knew it needed three
paid three round trips and stalled twice mid-task. The scope now takes several
tool names separated by commas, capped at eight, all-or-nothing when a name is
wrong. There is deliberately no wildcard: loading a whole catalog back is the
cost this mechanism exists to remove, and a wildcard is the spelling that
invites it.

**Refused - unload.** The report asked for a way to drop a schema mid
conversation. Adding to the tools array appends after the cached prefix and is
nearly free; removing invalidates the prefix and re-bills the entire
conversation at full rate. On a long conversation that trades a few hundred
tokens for tens of thousands. It is the most expensive thing the harness could
offer, dressed as an optimization. Not to be built.

**Refused - cost metadata.** The report asked that discovery say what a call
costs. A third-party server's credits are its own; we cannot annotate a schema
with a price we have no access to. What a server reports in its own results is
already passed through.

**Corrected.** The report inferred that the harness might have substituted a
nearest-match tool. It does not: `CallGate.call` looks the name up exactly
and throws `unknown_tool`. The substitution happened inside the model, which is
why the prompt is where it was fixed.

### Step 5 — The browser, as the first real consumer

The reason this plan exists in this order. A browser server is 25–30 tools —
big enough that eager loading is visibly wrong, small enough to reason about.

**Open, and not settled by this plan:** whether it is Playwright at all. The
research favoured `playwright-core` driving an already-installed Chrome or Edge
with an isolated profile, wrapped by `@playwright/mcp` — and that recommendation
is not accepted. Two known snags stand whatever is chosen:

- `assertValidCommand` refuses `.cmd` shims on Windows (CVE-2024-27980), so any
  Node-based server launches as `node.exe <path>/cli.js`, never through `npx`.
- The sandbox network policy refuses loopback, and a browser tool's most common
  destination is `localhost:3000`. That needs deciding, not working around.

**Provenance is the decision this step forces.** A browser is Studio-shaped
enough to argue for `system`, and a third-party binary is not. ADR 0048 §3 gives
the tiebreak: ship it discovered, because discovered → eager is free and eager →
discovered is not.

---

### Step 6 — Skills, on the same principle and not the same mechanism

Skills are already discovery-shaped: a name and a sentence, then instructions
loaded when the work comes up. They should reuse the inventory section — one
list of what this conversation could reach — and **not** be forced through
`native/discover`, whose per-tool schema loading answers a question skills do not
ask. The principle is shared; the mechanism is not.

Not started, and not blocking anything above.

---

## 3. What this must not break

Each of these is an existing invariant with an existing test or ADR behind it.
Listed because the changes above pass close to all of them.

- **ADR 0024 — the list is honest.** Everything in the tools array is callable.
  The inventory is not in the array and must never be described as tools.
- **ADR 0029 — membership is append-only.** Nothing here removes a tool from a
  live session. Withholding applies at registration, not by unregistering.
- **`mental-model.md` §3.3.** No change may add anything per-turn-volatile ahead
  of the conversation. The inventory is session-stable or it is a bug.
- **The kernel is the only door.** Discovery is not permission. A discovered
  tool is approved per call, and its grant still dies on a definition change.
- **Enablement subtracts, never adds.** Discovery reaches only what selection
  already resolved to enabled.

---

## 4. Open questions

1. **Where does the inventory sit relative to the tools array?** §3.2 puts it in
   the system block after the core prompt. Confirm the breakpoint placement
   against what Flue actually sends before writing it, rather than after.
2. **What does discovery cost in practice?** The round trip is one call; the
   inventory's own tokens are paid every turn. Measure both against a real
   multi-server project before deciding the inventory's verbosity is right.
3. **Loopback and the browser.** Refusing `localhost` makes a browser server
   useless for the case it is most wanted for. This needs a decision of its own,
   probably an ADR, and it is a containment question rather than a discovery
   one.
4. **Does a system server's provenance belong in the registry row or in code?**
   A row is editable by anyone with the database; code is not. Leaning row, with
   the migration defaulting to `user`, but the answer depends on whether a user
   may ever mark their own server as eager.
