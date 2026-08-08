# STUDIO — Mental Model

Root-level documentation. This is the *meta* layer: what STUDIO is, what it
refuses to be, and the decisions that span both halves of the repo.

Detail lives one level down and is authoritative where it disagrees with this
file:

- `STUDIO HARNESS/docs/decisions/` — 17 ADRs, the real reasoning
- `STUDIO HARNESS/docs/STATUS.md` — how far along we are
- `STUDIO HARNESS/docs/ROADMAP.md` — what order to build in
- `STUDIO HARNESS/docs/KNOWN-ISSUES.md` — what is currently untrue
- `documentation/check-later.md` — things deliberately deferred

---

## 1. What STUDIO is

A **local-first, general-purpose agent runtime** with a desktop UI.

Not a coding agent. Coding is one thing it does well, not the thing it is.
Every other harness in this space assumes a repo, a git history, and a terminal,
and bakes that into its prompts, tools, and UX. STUDIO does not.

> Any model, any tool, any capability — small enough to read, built to be
> extended rather than configured.

Three properties are the tie-breakers for every later argument:

1. **Readable.** Small enough to read in an afternoon and then change.
2. **Glue, not platform.** If a capability can be reached through an API, an MCP
   server, a local binary, or a tool, STUDIO connects it. It does not
   reimplement it.
3. **Local-first.** No required external infrastructure.

### What that forces us not to build

LSP integration, repo indexing, git workflows, PR review — that is the
coding-agent lane and we lose that fight. A large configuration surface —
"extended, not configured" means code and data beat a settings matrix.

---

## 2. The split: what we own, what we don't

This is the most important decision in the project, and it was made against
evidence rather than preference.

| Layer | Owner |
|---|---|
| Agent loop, durability, compaction, sandbox, MCP/skill/subagent primitives | **Flue** (`@flue/runtime`, Apache-2.0, Astro team) |
| Providers, request construction, prompt-cache placement | **Pi** (`@earendil-works/pi-ai`) |
| **Tool policy, permissions, registry, secrets, vendoring, the app** | **Us** |

### Why we do not own the loop

The original plan was to hand-write the loop and four provider adapters. That
plan was abandoned after reading what Pi already does. From Earendil's own
published post on prompt caching, Pi:

- places explicit `cache_control` breakpoints after stable parts — system
  prompt, tool definitions, latest cacheable conversation content
- maintains a stable, **append-oriented** transcript and resists eager pruning,
  because rewriting a long cached prompt costs more than the tokens it saves
- does **additive tool loading**, so discovering tools mid-session does not
  invalidate the prefix
- warns explicitly against injecting timestamps into the prefix
- exposes cache hit rate and re-billed tokens as session statistics

That is the same architecture we had specified, already built, already running
in production at scale — plus cache observability we had not thought to
specify. Writing it ourselves would have produced a worse version roughly
10–14 weeks later.

Flue adds what we would have had to build after that: durable execution with an
append-only log and crash resume, model-aware compaction, subagent profiles
that share the parent's durability envelope, MCP transports, and skills.

### Why the dependency risk is acceptable

`@flue/runtime` is at `1.0.0-beta.9`. Two things contain the risk:

1. **Only 9 files** in the harness import `@flue`. That containment already
   exists and must be maintained.
2. **Flue sits on Pi rather than hiding it.** Worst case we drop one layer and
   drive Pi directly — we lose the loop and durability, not the stack.

An escape ladder in cost order, if cache measurement ever comes back bad:
configure → `pnpm patch` → upstream PR (Apache-2.0) → bypass Flue for the
request path.

---

## 3. The context rules

These are the rules the policy layer exists to enforce. They are not
suggestions; every one of them is a cache-cost decision.

### 3.1 The request is rebuilt from scratch every turn

Nothing persists provider-side. Every turn sends the whole thing again:

```
tools:    [ ... ]     rebuilt from the live registry
system:   "..."       rebuilt
messages: [ ... ]     full history, rebuilt
```

Caching is not storage. It is *"do these bytes match a prefix I have seen?"*
Match → billed at 10%. No match → full price for everything downstream.

### 3.2 The layout

```
tools:   ~15 always-loaded natives, sorted, stable
         + everything discovered so far this session, appended
   ── breakpoint ──
system:  core prompt (static)
         + MCP / connector / skill inventory, plain English, session-stable
         + workspace context
   ── breakpoint ──
messages: full conversation, all past tool_use / tool_result
   ── moving breakpoint at the last stable turn ──
last user message: volatile only — time, todo state
```

Nothing that changes per turn may appear before the conversation. Not
timestamps, not cwd, not git status. Last message or nowhere.

### 3.3 Adding is free. Removing is expensive.

`[A,B,C]` → `[A,B,C,D]`: the prefix still matches, cache holds, only `D` is new.
This is what makes progressive tool discovery viable — it costs one round trip
and **zero** cache damage.

`[A,B,C,D]` → `[A,B,D]`: diverges at position 3. System prompt *and* the entire
conversation re-bill at full price. At a 100k-token conversation that is ~100k
full-rate input tokens, once, then it re-caches.

Ordering does not rescue a removal: the conversation sits after both `tools` and
`system`, so a change to either invalidates it.

### 3.4 The rule that follows — append-only membership, dispatch-time availability

**This is the solution to both the toggle problem and the per-operation-tools
trap. It is the single most important implementation rule in the harness.**

Flue's `OperationOptions.tools` is documented as *"scoped to the duration of the
`session.prompt()` call."* So passing discovered tools to one call and not the
next is a **removal** — full invalidation, every turn, forever, without the user
touching anything.

Therefore:

1. The session holds an **`expandedTools` set**. Every `prompt()` call passes
   natives + everything discovered so far, in stable sorted order. Discovery
   adds. Nothing is ever removed within a session.
2. **Disabling a server mid-session does not remove its tools.** It flips a flag
   the `CallGate` reads. The tool stays visible in the array; calling it returns
   a normal tool result saying it is unavailable.
3. The array is rebuilt clean only at **session start**, from the live registry.

Consequences:

- Toggling an MCP server, skill, or connector mid-session costs **zero** cache
  invalidation.
- A disabled server's schemas linger in that session's prefix, billed at the
  cached 10% rate. That is the trade, and it is deliberate.
- The model is **never told** a server was disabled. Announcing it in the system
  prompt would cost tokens on every turn *and* still invalidate. Reactive
  correction via an appended tool result costs nothing until it happens.

### 3.5 Large tool output: prevent, do not compact

Decide at execution time, not later:

- under ~8 KB → inline in the transcript
- over that → write the full result to `~/.studio/`, put a summary, a head/tail
  preview, and a handle in the transcript **from the start**

Then there is no rewrite and therefore no invalidation, ever. Post-hoc
compaction remains for conversation length, where Flue handles it — and there
the rule is: never mutate history except at an explicit compaction boundary.

---

## 4. Tool visibility: two states, not two taxonomies

> A tool is either **always-loaded** or **discoverable**. Nothing else.

**Always-loaded** (target ≤ 15) — used in the majority of sessions, plus the
entry points to whole subsystems, because a subsystem the model cannot learn
about does not exist.

**Discoverable** — everything else. All user MCP tools, all connectors, media
generation, anything with an expensive schema and occasional use.

`tool_discover` is a **filter**, not a search:

```
tool_discover(source: "mcp")                        every server
tool_discover(source: "mcp", server: "obsidian")    that server's full schemas
tool_discover(source: "connectors")                 connector inventory
```

Tool names must match `^[a-zA-Z0-9_-]{1,64}$`. Dots are rejected by the API, so
underscores are required, not preferred.

---

## 5. Naming and prompt style

All system prompts and tool descriptions use plain, simple English — short
words, short sentences, no filler. Two reasons: fewer tokens, and STUDIO serves
creative and non-technical users as much as developers.

Tool descriptions say what the tool does and when to use it. Nothing else. A
description is a token cost paid on every request.

---

## 6. Connectors

Connectors are Composio, surfaced under our own name. At the wire level they are
MCP, so they reuse the MCP path entirely and appear in the inventory and in
`tool_discover` like any other server.

---

## 7. Cloud

Not a SaaS. An **account gate** so strangers do not spend our money on hosted
web search and image generation. No billing, no credits, no plans.

The rule that keeps it from becoming a second architecture: hosted access is
just another `Credential` + adapter. A logged-in hosted call and a local BYOK
call travel the identical code path — only headers and base URL differ.

Decide early even though it is built late: **per-account rate limits from day
one.** "Free for logged-in users" has no ceiling otherwise.
