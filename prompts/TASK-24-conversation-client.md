# TASK 24 — A conversation the app can leave and come back to

You are working in `D:\Creative Library\Workspace\Project Studio`.

Read `documentation/decisions/0045-a-run-outlives-the-window-that-started-it.md` before
you write anything. It is the specification for this task. Also read
`STUDIO/src-tauri/src/services/stream.rs` (the module docblock and `StreamEvent`) and
`STUDIO/src/platform/harness/transport.ts`. Task 22 built the Rust half of this; Task 23
built the lifecycle half. You are building the TypeScript half.

## What exists already, verified

- `service_stream` is a registered Tauri command (`STUDIO/src-tauri/src/lib.rs:237`).
  Its parameters are `service`, `path`, `init`, `offset`, `channel`.
- `StreamEvent` is a `kind`-tagged union, kebab-case: `frame` (`offset`, `event?`,
  `data`), `up-to-date` (`offset`), `keep-alive` (`offset`), `ended` (`offset`).
- Every variant carries `offset`. It is **the offset to resume from**, not where the
  event was stored — resuming replays that event rather than skipping it. Offsets are
  opaque strings (`-1`, or `seq_batch`). Never parse, compare, or increment one.
- Flue's routes: `POST /agents/:name/:id` submits; `GET /agents/:name/:id` reads,
  resumable with `?offset=<x>&live=sse`; `POST /agents/:name/:id/abort` aborts a run.
  These sit behind `ADMISSION_SCOPES.AGENT_RUN` (`create-app.ts:53-56`).
- Flue's SSE response carries **only** `content-type: text/event-stream`. The
  `streamNextOffset` and up-to-date facts travel *inside* `event: control` frames. Do
  not look for `Stream-Next-Offset` response headers; they are not there.
- Task 23 emits five Tauri events: `harness-starting`, `harness-started` (payload is
  `HarnessEndpointView` — no token), `harness-stopped`, `harness-failed` (a string),
  `harness-restarting`.
- The frontend has **no schema library**. `contracts.ts` uses hand-written parsers.
  Match that style; do not add valibot or zod to `STUDIO/`.

## Part 1 — Decide and implement in-session cancellation

This is the part that needs your judgement, so do it first.

Today a stream cannot be stopped from JavaScript. `service_stream` runs to completion in
Rust; the only cancellation signal is a channel send failing, which only happens once the
**webview is destroyed**. Within one live session — the user switches conversations,
closes a pane, navigates away — the old stream keeps its HTTP connection to the harness
until the run ends or `READ_IDLE_TIMEOUT` (45s) fires.

That is not acceptable for a UI where switching conversations is routine. Close it.

Decide between:

- **(a)** A `service_stream_cancel(streamId)` command plus a `streamId` parameter on
  `service_stream`, with a cancellation registry in Rust.
- **(b)** Something better you can argue for.

Whichever you choose, the cancellation must be **prompt** (not "within 15 seconds"),
must be **idempotent** (cancelling twice, or cancelling a finished stream, is not an
error), and must not leak registry entries for streams that ended on their own.

Note that on webview reload the existing heartbeat path still works and stays as the
backstop — you are adding the prompt path, not replacing the bounded one. Say in your
report which of the two catches which case.

Keep the Rust change **small and in its own module** if it needs more than ~40 lines.
`services/` is a directory precisely so that a new concern is a new file.

## Part 2 — The conversation client

New: `STUDIO/src/platform/harness/conversation.ts` (plus tests). Not in `client.ts` —
that file is the request/response administration client and has not changed since Task
15. This is a different shape and belongs beside it, not inside it.

It owns:

1. **Submitting a turn.** The conversation id is **caller-chosen** (ADR 0045) — the
   client does not ask the harness what is in flight, because the caller already knows
   the id it used. Generate ids the same way the app already generates them; look for an
   existing helper before writing a new one.
2. **Attaching to a run at an offset**, including `-1` for "from the beginning".
3. **Tracking the last reported offset** as events arrive, so a reattach after any
   interruption resumes from the right place. This is the whole point of the task.
4. **Aborting a run** via Flue's abort route — distinct from cancelling a *stream*.
   Cancelling a stream stops reading; aborting a run stops the work. A user who closes a
   window must get the first and not the second (ADR 0045: a dead window cancels
   nothing).

Injectable seams, matching how `client.ts` already does it: the invoke and the channel
constructor must be replaceable so tests need no Tauri. `client.ts:74` shows the
established pattern.

## Part 3 — The states

A hook (or hooks) under `STUDIO/src/features/chat/` — follow the structure already there;
`useConnections.ts` in `features/settings/connections/` is the closest precedent for
shape and naming.

The states a conversation can be in, all of which must be distinguishable:

- no harness / harness starting (Task 23's `starting` state is now real — use it)
- attaching (replaying history)
- live (the `up-to-date` transition happened)
- streaming a turn
- idle
- the stream broke and can be resumed (offset retained)
- the run failed

Subscribe to Task 23's lifecycle events so a harness crash mid-run is visible **and** the
reattach happens when `harness-started` arrives. Do not poll for what an event already
tells you. `keep-alive` events are liveness only — they must not render as content and
must not disturb the transcript.

**Do not rewire `ChatPage.tsx`, `Transcript.tsx`, or `Composer.tsx` to real data.** That
is Task 25. This task delivers the data layer and its states, with tests, and leaves the
mock rendering alone. If you find yourself editing a component that renders a message,
stop — you have gone too far.

## Part 4 — The seam can currently stop the harness

Found during the Task 23 review, and it is yours to close because it is a seam decision.

`validate_path` in `STUDIO/src-tauri/src/services/mod.rs` refuses anything that could
leave the harness origin, but it has no path denylist. The webview can therefore call
`service_fetch(harness, "/api/shutdown", { method: "POST" })` and Rust will attach the
host bearer, because production has exactly one credential and `app.ts:68` types it
`studio-host`. The route's own docblock claims the desktop UI has no business stopping
the process; right now it can.

Impact is denial-of-service only — no credential exposure, and the supervisor restarts
it. Fix it the honest way:

- Refuse `/api/shutdown` at the seam (a small explicit denylist with a comment saying
  *why* that path and not others), **or**
- If you conclude the check belongs elsewhere, correct the overclaiming docblock in
  `STUDIO HARNESS/src/transport/http/routes/lifecycle.ts` so the comment matches reality.

Do one of those two. Do not leave the comment claiming a boundary that does not exist.

## Constraints

- **No `any`, no non-const `as`, no non-null `!`.** These are hard.
- The harness admission credential must never appear in webview code, a log line, an
  error message, or a test fixture. Rust holds it (ADR 0044).
- UTF-8, no BOM. ASCII punctuation in source; `--` not an em dash in code comments.
- Modular. `STUDIO HARNESS/src/transport/http/routes/lifecycle.ts` (60 lines, one
  concern) is the standard. If a file passes ~400 lines, it is probably two files.
- Every new behaviour gets a test that fails without it. **Never leave a green
  placeholder test.**
- `cargo clippy --all-targets` must end at **zero** warnings if you touch Rust.

## Forbidden

Do not run `git checkout`, `git switch`, `git stash`, `git reset`, `git clean`,
`git commit`, `git rebase`, or any other git command that changes state. Reading
(`git status`, `git diff`, `git log`) is fine. Uncommitted files under `Backend/`,
`docs/`, and `report/` belong to the user — do not touch, read for context only, and do
not `git add` anything.

## Verification to run and report verbatim

```
cd "STUDIO" && pnpm test && pnpm typecheck
cd "STUDIO/src-tauri" && cargo test && cargo clippy --all-targets
cd "STUDIO HARNESS" && pnpm test
```

Run the two vitest suites **one at a time**. Running `STUDIO` and `STUDIO HARNESS` tests
concurrently makes Vite's SSR temp directory vanish underneath one of them and produces
~80 bogus `ENOENT` failures. That is an environment artefact, not a real failure — if you
see it, re-run alone before reporting anything.

Baselines to beat, not merely match: `STUDIO` 7 files / 93 tests; `STUDIO/src-tauri` 53
tests, clippy 0 warnings; `STUDIO HARNESS` 84 files / 1275 tests.

## Report

Write `report/TASK-24-conversation-client.md`. Cover: what you chose in Part 1 and why
the alternative lost; where the offset is held and how a reattach proves it works; which
cancellation path catches reload versus in-session switching; what you did about Part 4;
what you did **not** do and deliberately left for Task 25; and any place where this brief
was wrong. If a premise here is false, say so plainly and correct it — the last three
tasks each caught something, and that is the most useful part of the report.
