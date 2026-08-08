# Check Later

Things deliberately deferred, with enough context to act on without the
conversation that produced them. Not a bug list — `STUDIO HARNESS/docs/KNOWN-ISSUES.md`
is for what is currently untrue about the system. This is for what we chose not
to resolve yet.

Each entry says what to check, what a pass looks like, and what it gates. Delete
an entry when it is settled, and record the answer in the relevant ADR.

---

## C-01 — Measure Pi's cache-breakpoint placement

**Status:** open. **Gates:** how much we trust Flue/Pi vs. needing an escape hatch.

Pi's published design places breakpoints after the system prompt, the tool
definitions, and the latest cacheable conversation content. That matches what we
would have specified. Stated intent is not measured behaviour, and Pi does not
expose breakpoint placement to us — so this is settled with a number, not an
argument.

**The fixture:** a ~20-turn session with several tool calls, one `tool_discover`
expansion, and one compaction.

**Pass:** ≥90% cache hit rate on every turn after the first, and a re-billed
token spike *only* at the compaction boundary.

**If it fails,** escalate in cost order:
1. check whether Pi exposes cache tuning
2. `pnpm patch`
3. upstream PR (Apache-2.0, and Earendil demonstrably cares about this problem)
4. bypass Flue for the request path and drive Pi directly

Do this when the harness can run a real multi-turn session with tools — roughly
after Phase 11 (MCP), since discovery is half of what is being measured.

---

## C-02 — Verify `expandedTools` survives across `prompt()` calls

**Status:** open. **Gates:** correctness of progressive disclosure.

`OperationOptions.tools` is documented as scoped to a single `session.prompt()`
call. Our design (mental-model §3.4) requires the harness to re-pass every
previously discovered tool on every subsequent call, in stable sorted order.

**Check:** capture two consecutive requests after a discovery and diff the
serialized tool arrays. The second must be a superset of the first with
identical ordering for the shared prefix.

**Failure mode if wrong:** silent full cache invalidation on every turn after
the first discovery. Expensive and invisible without measurement — which is why
C-01 and C-02 should be done together.

---

## C-03 — What Flue injects as "discovered workspace context"

**Status:** open. **Gates:** control over our cached prefix.

`AgentRuntimeConfig.instructions` is documented as *"instructions prepended to
discovered workspace context"* — so Flue performs its own workspace discovery
and puts the result in the region we are trying to keep stable and minimal.

**Check:** what it discovers, how large it is, and whether any of it changes
between turns. Anything volatile in there defeats the whole layout.

---

## C-04 — Re-audit vendored binary flags on upgrade

**Status:** standing. **Gates:** nothing; it is a recurring obligation.

ADR 0013 blocks ripgrep's `--pre` and `--hostname-bin` and several git options
because they re-enter an interpreter. Those lists are per program and per
version. A new flag in an upgraded binary that runs a preprocessor is a hole.

**Trigger:** any bump to a binary in `vendor/`.

---

## C-05 — Hash verification before on-demand git install

**Status:** open (tracked as `V-01`). **Gates:** shipping the download path.

Vendoring ripgrep and downloading git on demand is the right split — ripgrep is
small and universally needed, git is large and usually present. But fetching an
executable and running it unverified is the one thing that must not ship.

**Decision already made:** ship ripgrep, download git, verify by hash first.

---

## C-06 — Multimodal is unwired

**Status:** open. **Gates:** image/video/speech capabilities.

The local catalog reports image, video, speech, and transcription as
`unsupported`. Per `STATUS.md` this is not a config gap — Pi's image collection
is not wired up. This is wiring work, not architecture, but it is real work and
it is on the critical path for "general-purpose, not a coding agent."

---

## C-07 — Snapshot scope: ignored files the agent creates

**Status:** decided, not implemented. Recording the reasoning so it is not
relitigated.

Shadow git in `~/.studio/data/snapshots/`, one repo per project, outside the
project so it neither pollutes `git status` nor dies with the thing it protects.

- **Trigger:** per user turn, taken lazily *before the turn's first write*. Turns
  that write nothing produce no snapshot. "Undo what the agent just did" is the
  unit people actually think in; per-write gives a history nobody can navigate.
- **Scope:** honour `.gitignore`, but force-add every path the write/edit tools
  actually touched. The tools already know what they wrote.
- **The rule in one line:** the shadow repo contains the project minus ignored
  files, plus everything the agent touched.

Without the force-add, an agent-created ignored file is not restorable. Without
honouring `.gitignore`, the first snapshot swallows `node_modules`.

---

## C-09 — Which compaction shape does Flue actually use

**Status:** open. **Gates:** the real cost of every compaction. **Measure with C-01.**

There are two ways to summarise a conversation, and they differ by roughly 10×
in token cost:

- **Cache-safe fork.** Keep `tools`, `system`, and the full transcript
  byte-identical and append one instruction — *"summarise this conversation."*
  The prefix matches, so the whole history is billed at 10% and the only new
  tokens are the instruction and the summary.
- **Separate loop.** A fresh request with its own small system prompt and the
  transcript pasted in as content. No prefix match, so the entire conversation
  is re-read at full price. This is what OpenCode does, and it is what a
  different summariser model *forces* — a different model has a different cache
  entirely.

`CompactionConfig` lets us override the summariser model *"for cost optimization
(cheap summariser on an expensive session model)"*, which implies Flue supports
the second shape. It does not tell us what it does when the model is **not**
overridden.

**Check:** during the C-01 fixture, capture the compaction request and compare
its serialised prefix against the preceding turn's. Identical prefix means fork;
a fresh short system prompt means separate loop.

**Why it matters, with numbers.** At a 150k-token conversation on a
Sonnet-class model:

| Shape | Billed |
|---|---|
| Fork, same model | ~15k effective |
| Separate loop, same model | 150k at full price |
| Separate loop, cheap model | ~150k at roughly a tenth the rate |

Fork and cheap-separate-loop land in the same place. Separate loop on the
*session* model is the one to avoid, and it is the default we would get by
accident.

**Note either way:** the compaction call is a one-off. The larger unavoidable
cost is that rewritten history invalidates the prefix for the turn *after*
compaction. That is the real price, and it is why a breakpoint goes immediately
after the boundary.

---

## C-08 — Folder names contain spaces

**Status:** open, low priority.

`STUDIO HARNESS/` has a space. pnpm, Vite, and Tauri generally tolerate this on
Windows, but it is a recurring source of quoting bugs in scripts and CI. If
anything breaks in a way that traces back to path quoting, rename to
`STUDIO-HARNESS` rather than debugging the tool.
