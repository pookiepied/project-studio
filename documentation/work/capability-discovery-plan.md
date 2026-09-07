# Capability discovery — the plan

**Status:** Steps 1-2 landed · **Opened:** 2026-09-07 · **Last worked:** 2026-09-07
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

**Proof:** every bullet in ADR 0048's *Required proof*, and specifically that a
user server contributes zero schemas until discovered, that a system server
contributes its schemas with no discovery call, and that a discovered tool is in
the next turn's array while the system block is unchanged across that turn.

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

---

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
