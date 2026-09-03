# TASK 25 — The conversation renders, against a real agent

You are working in `D:\Creative Library\Workspace\Project Studio`.

Read first, in this order:
1. `documentation/architecture/transcript-and-rendering.md` — the design this task
   implements. §1 is a rule, not a suggestion.
2. `documentation/decisions/0045-a-run-outlives-the-window-that-started-it.md`
3. `STUDIO HARNESS/node_modules/@flue/runtime/docs/api/streaming-protocol.md` — the
   authoritative protocol. Read it before writing anything; it contradicts assumptions
   baked into the current client.
4. `STUDIO/src/platform/harness/conversation.ts` and
   `STUDIO/src/features/chat/useConversation.ts` — Task 24's data layer, which you are
   completing rather than replacing.

## Part 0 — Run it against a live agent, first

**Do this before writing any rendering code.** Task 24's streaming client has never
spoken to a real agent: every one of its tests scripts the channel directly, so the
request it actually builds has never been exercised. Two suspected defects follow from
that, both of which you must confirm or refute by observation:

1. **The `view` parameter is missing.** `agentsPath()` in `conversation.ts:271` produces
   `/agents/:name/:id` with no `view=updates`. Flue's protocol doc says the `updates`
   view is what emits `ConversationStreamChunk` — the shape the parser expects. Find out
   what the default view actually returns and fix the path if it is wrong.
2. **Cold start ignores history.** The client resumes from `-1` when it has no tracked
   offset. The protocol doc says: *"Do not resume without retaining the projection state
   produced by the matching history snapshot; request fresh history when local state is
   unavailable."* The correct cold-start sequence is almost certainly
   `GET ?view=history` for the snapshot, then `?view=updates&offset=<snapshot offset>&live=sse`.
   Confirm against the doc and implement it.

Note that `HEAD /agents/:name/:id` exists for stream metadata; use it if it helps.

Report what a real turn actually put on the wire — the request line and a representative
frame — because everything downstream depends on it and nobody has looked yet.

You will need a configured provider connection to do this. If none exists, say so and
stop rather than guessing; a rendering layer built against imagined chunks is worthless.

## Part 1 — Mirror the chunk content

`ChunkFacts` in `contracts.ts` carries only facts: type, position, ids, outcome. No
content. Extend the wire mirror to carry what rendering needs:

- assistant text (and its deltas)
- thinking / reasoning segments
- tool calls: name, input, and their results
- message and part lifecycle, enough to know where a part begins and ends

Keep the house style: hand-written parsers, no schema library, no `any`, no non-const
`as`, no `!`. An unknown chunk type must survive as a fact rather than being dropped —
dropping one desyncs position dedupe, which Task 24 already established.

## Part 2 — Reduce to a renderable transcript

A new module under `STUDIO/src/features/chat/` (not inside `useConversation.ts`, which
is already 394 lines and owns connection state, not content). It turns the ordered chunk
stream into transcript items:

- user message
- assistant text
- thinking segment — **one block per segment, positioned where it occurred**, collapsed
  by default. Not a single mutable block. The reason is replay: we reattach at an
  offset, and a mutable global block has no stable identity across a replay. See
  `transcript-and-rendering.md` §3.
- tool step

**Grouping is structural, never inferred** (§2 of the same doc). The unit is *one
assistant turn's tool calls, bucketed by tool kind*, producing counts from facts:
`Explored 3 searches, 7 files read` / `Edited 2 files` / `Ran 1 command`. Collapsed by
default; expandable to individual calls; a call expandable to its input and output.

Do not invent semantic labels ("fixing the bug"). Do not add a tool to make the model
produce them. Structure only.

The reduction must be **idempotent under replay** — feeding the same batch twice must
not duplicate anything. Task 24's projection already refuses out-of-order batches by
monotonic position; extend that discipline to content rather than reimplementing it.

## Part 3 — Wire the UI

Now, and only now, connect the components: `ChatPage.tsx`, `transcript/Transcript.tsx`,
`composer/Composer.tsx`. The composer submits a real turn. The transcript renders real
items. The existing mock/demo rendering goes away where it is replaced.

Cover the connection states `useConversation` already exposes — `no-harness`,
`harness-starting`, `attaching`, `live`, `streaming`, `idle`, `interrupted`,
`run-failed`. In particular:

- **An interrupted turn must never render as a completed one.** A turn is complete only
  when a settlement chunk says so, never because bytes stopped arriving. This is the
  single most important rendering rule in the codebase; see
  `documentation/architecture/reliability-and-the-silent-stop.md`.
- `interrupted` should offer resume, and resuming must use the retained offset.
- Streaming text should render incrementally. `features/chat/streaming/` already has
  `useSmoothText` and friends — reuse rather than rewrite.

Keep the existing visual language. This is a data change, not a redesign.

## The rule that outranks everything else here

> **What the UI renders and what the model receives are two different projections of the
> same event log. Neither is derived from the other.**

No code you write may read UI state to build a request to the harness. If you find
yourself reaching into transcript state to construct a submission, stop — that is the
defect this rule exists to prevent.

## Explicitly not this task

Do not build any of these, and do not leave scaffolding for them:

- The end-of-run summary (files changed, line counts, elapsed time)
- Large tool output spilling to disk
- Background tasks
- Semantic / workflow-phase grouping
- Cross-window attach coordination

## Constraints

- No `any`, no non-const `as`, no non-null `!`. Hard.
- The admission credential never appears in webview code, a log, an error, or a fixture.
- UTF-8, no BOM. ASCII punctuation in source; `--` not an em dash in code comments.
- Modular. If a file passes ~400 lines it is probably two files.
- Every new behaviour gets a test that fails without it. Never leave a green placeholder.
- `cargo clippy --all-targets` at zero warnings if you touch Rust.

**Test the adversarial input, not just the happy path.** The Task 24 review found a
security guard that passed every test its author wrote and was still bypassable, because
the tests only tried the obvious cases. For this task the equivalents are: a chunk
stream that stops mid-turn, a batch redelivered after a reattach, a tool result that
never arrives, and an unknown chunk type.

## Forbidden

Do not run `git checkout`, `git switch`, `git stash`, `git reset`, `git clean`,
`git commit`, or `git rebase`. Reading git state is fine. `Backend/`, `docs/`,
`prompts/`, and `report/` are the user's — read for context, never modify, never
`git add`.

## Verification — run each suite alone

```
cd "STUDIO" && pnpm test && pnpm typecheck
cd "STUDIO/src-tauri" && cargo test && cargo clippy --all-targets
cd "STUDIO HARNESS" && pnpm test
```

Running the two vitest suites concurrently makes Vite's SSR temp directory vanish under
one of them and produces ~80 bogus `ENOENT` failures. Re-run alone before reporting.

Baselines to beat, not merely match: `STUDIO` 9 files / 125 tests; `STUDIO/src-tauri` 64
tests, clippy 0 warnings; `STUDIO HARNESS` 84 files / 1275 tests.

## Report

Write `report/TASK-25-render-the-conversation.md`. Lead with **Part 0**: what the live
agent actually sent, and what was wrong with the request the client was building. Then:
how grouping is derived and why it cannot be wrong; how replay stays idempotent; how an
interrupted turn is kept distinguishable from a finished one; what you left for later;
and every place this brief was wrong. The last section has been the most useful part of
the last three reports — do not skip it to look tidy.
