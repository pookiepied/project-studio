# The transcript, and what a person sees of it

**Written:** 2026-08-24, from a working conversation. A nudge, not a decision record.
Most of this is not built. The one part that must be settled before rendering starts is
in §1; everything after it can wait, and should.

## 1. Two projections, one log — decide this first

The single most important rule here, and the one that is expensive to retrofit:

> **What the UI renders and what the model receives are two different projections of the
> same event log. Neither is derived from the other.**

The model transcript is Flue's canonical transcript. The UI transcript is a projection
we compute for display. They diverge on purpose: the UI collapses, groups, summarises,
and hides; the model gets the full fidelity its provider requires.

Two failure modes this rule prevents, both of which are hard to unwind later:

- **Rendering decisions leaking into the model's context.** If the UI's grouping or
  truncation ever determines what gets sent, then a display change silently changes
  model behaviour, and a collapsed group becomes a lost instruction.
- **The model transcript being reconstructed from UI state.** On reattach, replay, or a
  second window, the UI state is partial by definition. It must never be the source.

We are already structurally correct: `conversation.ts` produces *chunk facts* — a
projection — and Flue holds the canonical record. The rule is to keep it that way, and
to treat any code that reads UI state to build a request as a defect.

### Thinking blocks and provider fidelity

Some providers require prior thinking blocks to be sent back; Anthropic is one. So the
canonical transcript must retain them at full fidelity regardless of whether the UI
shows them.

Open question worth answering before it bites: **what happens to a thinking block that
was interrupted mid-write** — rate limit, dropped stream, crash. Is a partial thinking
block retained, discarded, or marked? Sending a truncated thinking block back to a
provider that validates them is a plausible hard error. This interacts directly with
`reliability-and-the-silent-stop.md` §"gaps": an interrupted turn must be a distinct
state, not a completed one, at the transcript layer too and not only in the UI.

## 2. Grouping tool calls: structure, not inference

The observed problem: a naive UI renders every tool call as a line, and the chat drowns.
Good products group them. Two grouping strategies exist in the wild:

- **Semantic groups** the model or harness names — "fixing the bug", "exploring files".
  Claude Code's shape.
- **Workflow-phase groups** — "Exploration", "Editing". Codex's shape, and the one that
  felt more reliable in use.

**Recommendation: group structurally, label from facts.** A semantic label requires the
model to cooperate — a convention or a dedicated tool — and it is unreliable in exactly
the way that was observed. A structural group requires nothing and cannot be wrong.

The reliable unit is:

> **one assistant turn's tool calls, bucketed by tool kind.**

Both halves are facts already in the event log. That yields, per turn:

```
Explored   3 searches, 7 files read
Edited     2 files
Ran        1 command
```

Collapsed by default, expandable to the individual calls, and expandable again to one
call's full input and output. Three levels, each a fact.

Per-call display, once expanded, follows the pattern that is already familiar: a file
icon by type, the verb (`Read` / `Wrote` / `Edited`), the file name, its path relative
to the **project** root (never absolute), and the line delta in green/red. State moves
`Writing… → Wrote`.

This does not preclude semantic grouping later. If a `task` or `todo` tool eventually
emits real phase markers, those become a *higher* band over the same structural groups —
an addition, not a rewrite. That is the reason to build structural first.

## 3. Thinking block placement

Observed variants: one block at the bottom that keeps updating; one at the top; a fresh
block per thinking segment.

**Recommendation: a thinking block belongs to the turn that produced it, positioned
where it occurred, collapsed by default.** Not a single mutable block.

The reason is our own architecture rather than taste: we replay from an offset. A single
global block that mutates has no stable identity across a replay, so a reattach either
duplicates it or loses its ordering relative to the tool calls around it. Per-segment
blocks are addressable, idempotent on replay, and preserve interleaving — which is the
thing that actually tells the story of a turn.

## 4. The summary at the end of a long run

The wanted behaviour: while working, the detail is live; when the run finishes, it all
collapses to a summary — files changed, lines added and removed, new files, elapsed
time, and a short prose account. Click through to see everything underneath.

**This should be a computed projection over the event log, never a stored artefact.**
Storing it means it can disagree with the record; computing it means it cannot. It also
then works for a run someone reattaches to hours later, which a stored-on-completion
summary would miss.

It is a real feature and it is downstream: it needs tools that report line deltas and
timing, which is partly Phase 10's business. Not now.

**When it should not appear:** a summary is a coding-session shape. A conversation that
was only conversation should render as a conversation. Rather than a mode switch, the
honest rule is that **the summary appears when there is something to summarise** — if
the run produced no file changes and no commands, there is nothing to collapse and the
transcript is already the answer.

## 5. Large tool output

Observation: some harnesses appear to spill large tool output to a file, give it an id,
and let the model read it back on demand rather than putting it inline.

Plausible and probably real, and it solves a genuine problem — one `grep` can otherwise
consume a large share of the context window. Notes for when we do it:

- It is a **harness** concern, not a rendering one. The UI's job is only to show that
  output was spilled and let a person open it.
- It collides with the permission kernel. A spilled output lives outside the project
  tree, so either the reader is a dedicated capability that can reach the spill
  directory, or spills live inside the workspace and inherit its rules. **That is a
  decision to make deliberately**, because "the model can read this one path outside the
  project" is exactly the kind of exception that quietly widens.
- The threshold matters: spill everything and the model loses immediacy; spill nothing
  and one command can end a session.

## 6. Background tasks

A long-running job — a download, a build, a large test run — should not hold the
conversation. The model spawns it, keeps working or finishes the turn, and reads its log
later.

This is Phase 13 (Subagents and Tasks) and is genuinely out of scope for rendering. The
one thing worth recording now, because it constrains the design when we get there: a
background task is another **durable stream with an offset**, exactly like a run. It
should reuse ADR 0045's mechanism rather than inventing a second way to watch something
that outlives the window that started it.

## What this means for the near-term order

- **Now (Task 25):** §1's separation, honoured in code. Text, thinking, and structurally
  grouped tool steps. The composer wired to a real submission.
- **Soon:** per-call detail, file/line deltas, the expand-twice interaction.
- **Later:** the completion summary (§4), large-output spilling (§5).
- **Phase 13:** background tasks (§6).

The near-term rule is to build the *data model* grouping-ready — steps that carry turn
and tool-kind — while shipping simple rendering. Then grouping is a rendering change,
not a re-architecture.
