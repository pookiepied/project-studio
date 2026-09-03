# TASK 24 — A conversation the app can leave and come back to

**Date:** 2026-08-24
**Scope:** `STUDIO/src-tauri/src/services/` + `lib.rs` (Rust); `STUDIO/src/platform/harness/`
(`contracts.ts`, new `conversation.ts`) and new `STUDIO/src/features/chat/useConversation.ts`;
one docblock truthed in `STUDIO HARNESS/src/transport/http/routes/lifecycle.ts`.
**Status:** Complete. Nothing committed — the working tree holds the changes.

---

## Verification, run one suite at a time

| Check | Result |
|---|---|
| `STUDIO` `pnpm test && pnpm typecheck` | **9 files / 125 tests passed** (baseline 7 / 93); `tsc -b` clean |
| `STUDIO/src-tauri` `cargo test` | **62 passed; 0 failed** (baseline 53) |
| `STUDIO/src-tauri` `cargo clippy --all-targets` | **0 warnings** |
| `STUDIO HARNESS` `pnpm test` | **84 files / 1275 tests passed**, exactly the baseline |

No ENOENT storm appeared; suites were run strictly sequentially as instructed.

## 1. Part 1 — what I chose, and why

**Chosen: option (a)** — a `streamId` parameter on `service_stream`, a new
`service_stream_cancel(stream_id)` command, and a cancellation registry in a new module,
`services/stream_control.rs` (~90 lines incl. tests; the concern got its own file as the lean
asked). Mechanics:

- Registration hands the stream half of a `tokio::sync::watch` pair. The receiver sits as a
  `select!` arm **both in the connect phase and in the consume loop**, so a cancel wakes the read
  immediately wherever it is waiting — not at the next heartbeat, not after `READ_IDLE_TIMEOUT`.
  On cancel the existing cleanup runs (`reader.abort()`, response dropped → HTTP request closed),
  the outcome is logged distinctly from reader-gone, and the command returns `Ok(())`.
- **Idempotent by construction:** `cancel()` removes the map entry first and returns whether there
  was one; unknown id, already-finished stream, second cancel — all quiet no-ops. Tests pin each.
- **No graves:** the registration guard's `Drop` unregisters on every natural exit path including
  errors, guarded by `Arc::ptr_eq` so a stale guard cannot unregister a newer tenant of the same
  id. Registering over a live id signals the previous reader outright (two readers behind one id
  would deliver everything twice).
- An empty stream id is refused (`InvalidRequest`) before anything starts: an unnamed stream is
  one nobody can ever prompt-stop. Two arguments end up at eight parameters on the command; the
  allow carries a comment saying why — every argument is one name the webview sends, and folding
  them hides the contract rather than shrinking it.

**Why nothing better won.** The constraint that shapes this is physical, not stylistic: a Tauri
channel carries no webview→Rust signal, so *any* prompt cancellation must be a second command —
which is already option (a)'s skeleton. The alternatives were variations, not rivals:

- *Implicit cancel-on-reattach* (same id replaces its predecessor) covers switching conversations
  but not closing a pane or navigating away with no successor — precisely the routine cases in the
  lean. It also exists anyway, for free, as the recycle-over-live-id rule above.
- *Cancelling via a failed send* is the existing heartbeat backstop and stays: bounded by one
  `CHANNEL_HEARTBEAT` interval (15s), it catches what only becomes observable once the webview is
  destroyed. Prompt it is not, and switching panes must not wait 15 seconds holding a loopback
  connection open.

**Which path catches which case:** in-session switching / pane close / navigation → the registry
(prompt; the frontend invokes `service_stream_cancel`). Webview reload / window destruction → the
heartbeat backstop (the send fails once the webview is gone). Both paths converge on the same
cleanup; the log lines distinguish them.

## 2. Where the offset lives, and how a reattach proves it

The offset is held in **one place per conversation client**: `trackedOffset` in
`conversation.ts`, updated from **every** parsed wire event before anything else happens (every
variant carries it; none is exempt). The hook mirrors it into render state (`offset`) purely so a
UI could display it. Nothing parses, compares or increments an offset anywhere; `-1` is just the
seed when nothing has been seen. On attach, the client resumes from `options.from ??
trackedOffset ?? '-1'`.

Proof, in order of fidelity:

- `conversation.test.ts > resumes from the last delivered offset on the next attach`: events push
  the tracked offset to `5_1`; the next `service_stream` invocation carries `offset: '5_1'`.
- `useConversation.test.tsx > keeps the offset through a broken read...`: a read delivers up to
  `6_1`, breaks, the phase goes `interrupted` with the offset still exposed, and `resume()`
  produces a new read seeded `6_1`.
- `useConversation.test.tsx > shows a crash mid-run as interrupted...`: crash at offset `3_0`,
  `harness-failed` → `interrupted(reason)`, then `harness-started` triggers the reattach
  automatically and the second read carries `3_0`. ADR 0045 §4's "restart once, visibly": the
  visibility is this state machine, the reattach is a `GET` with an offset.

One honesty note: this durability is **webview-lifetime, not disk**. A full app quit still loses
the number; ADR 0045's "one durable thing per conversation" is satisfied within a session only.
Persisting it belongs with Task 25's wiring (it needs a store decision — Tauri store vs. deriving
from a `HEAD` cold start — that this task had no business making alone).

## 3. The conversation client and the states

`conversation.ts` sits beside `client.ts` because the shape differs: submit and abort are plain
requests through `service_fetch`; reading is `service_stream` over an injected channel
constructor; cancelling a read is `service_stream_cancel`. Seams match the house pattern —
injectable `invoke` and channel factory, so tests script whole conversations with no Tauri.
Decisions worth recording:

- **Submit never retries.** Flue deduplicates nothing (pinned by a harness-side test), so a resend
  is a second turn wearing a retry's clothes. A lost acknowledgement surfaces as `unreachable`.
- **Attaching supersedes**: a second attach cancels the first rather than stacking readers.
- **Deliveries are classified, not raw**: a `data` frame whose payload parses as the updates-view
  chunk array arrives as `{kind:'chunks', replaying, chunks}`; foreign frames pass through as
  `frame`; `keep-alive` reaches handlers (so a UI *can* show liveness) but moves neither the
  transcript nor the state machine. `replaying` flips on `up-to-date`.
- **Chunk FACTS, not the full chunk protocol**: contracts.ts mirrors type, position, message/submission
  ids and settlement outcome. Content (deltas, tool traffic, usage) is rendering's business;
  unknown chunk types are kept as facts (dropping one would desync position dedupe), entries
  without a type are refused.

The hook (`features/chat/useConversation.ts`, `useConnections` as precedent) exposes one tagged
union covering every state the lean listed: `no-harness`, `harness-starting` (Task 23's starting
state, now consumed — no polling for what events announce), `attaching`, `live`, `streaming`
(with the submission id when seen), `idle`, `interrupted` (reason carried, offset retained),
`run-failed` (`failed`/`aborted`, sticky until the user acts). Redelivered batches are dropped by
the projection's own monotonic position — the test feeds the same batch twice with the story
changed underneath and asserts the lie is refused. Unmount and conversation-switch cancel the read
promptly and assert, in the same breath, that **no `/abort` call went out**: reading stopped, the
run did not.

## 4. Part 4 — the shutdown seam

Verified real before fixing: production mints exactly one admission credential and types it
`studio-host` (`STUDIO HARNESS/src/app.ts`), which is precisely the client type `/api/shutdown`
demands — so the harness-side check cannot tell the webview from the Host, and the webview could
indeed have stopped the process through `service_fetch`.

**Did both halves of the fix, deliberately.** The refusal belongs at the desktop seam — only Rust
knows a request came from the webview — so `validate_path` now refuses `/api/shutdown` (query
stripped before comparison; neighbours like `/api/shutdowns` stay open; a comment explains why
this path and not others: every other `/api` route manages state the UI legitimately touches).
And because the brief's last word was "do not leave the comment claiming a boundary that does not
exist," the `lifecycle.ts` docblock sentence claiming the desktop UI has no business stopping the
process was rewritten to say where that boundary now actually lives. The route's check remains:
it distinguishes among HTTP clients a Host does not control, at no cost.

## 5. What I did not do — left for Task 25 and named as such

- **No component rewired.** `ChatPage`, `Transcript`, `Composer` and their mock rendering are
  untouched; the data layer ends at `useConversation`'s return value.
- **No transcript reduction.** The hook reduces chunks to *states* only; turning deliveries into
  messages/parts for display needs the full chunk mirror and is exactly the rendering task.
- **No offset persistence across relaunch** (see §2) and **no `HEAD`-based cold-start snapshot**
  (ADR 0045 lists it as "nearly free"; it is also unnecessary until transcripts render history).
- **No `abortRun()` caller.** The method exists and is tested; wiring it to a stop button is a UX
  decision with a confirmation-shaped consequence.
- **No browser-dev SSE fallback.** Outside Tauri there is no seam; building a second SSE path in
  the webview would be two credential stories for one process. Browser dev keeps the demo chat.
- **No cross-window attach coordination.** Two windows may read the same conversation today; each
  gets its own stream id and its own connection. Fine at desktop scale; revisit if it ever isn't.

## 6. Where the brief was wrong or silent

1. **"`Ended` — the run finished and the stream closed" is not how turns end.** Flue's canonical
   agent streams stay open and never emit `closed: true` (`streaming-protocol.md` says so; the
   Rust close frame remains correct for the workflows that do close). Turn completion therefore
   comes from `submission-settled` chunks inside `data` frames — which is why the state machine
   needed chunk facts at all, and why `ended` maps to `idle` rather than to any per-turn notion.
   The lean's state list implied this without stating it; stating it here so nobody waits for an
   `Ended` that will not come.
2. **Rust's `Frame.event` arrives as `null`, not absent** (serde serializes `Option::None`
   without a skip attribute). The parser accepts both; noting it since the lean wrote `event?`.
3. Small correction to the brief's framing of Part 4's options: they were offered as alternatives,
   but doing (a) without touching the comment would have left an overclaiming docblock, which the
   same paragraph forbade. Both halves are one fix; see §4.

Two defects my own tests caught during development, fixed:

- The hook test for `no-harness` built its lifecycle listener inline in the render callback; every
  re-render produced a fresh effect dependency, the mount effect chased itself, and the vitest
  worker died of heap exhaustion. Hoisted; the failure mode (OOM-looking worker death, ~90s) is
  recorded here because it looks like an environment artefact and wasn't.
- First draft of the cancellation registry relied on overwrite dropping a replaced entry's sender
  to stop the stale reader — false, since the old guard holds the `Arc<Entry>` alive. The registry
  now signals the previous reader explicitly on overwrite, and a test pins it.

## 7. Files changed

**Rust** (`STUDIO/src-tauri/`): `src/services/stream_control.rs` (new — registry, registration
guard, five tests); `src/services/stream.rs` (cancel receiver through both selects,
`Outcome::Cancelled`, wrapper registering under the webview's id, three new tests, all prior
call sites updated); `src/services/mod.rs` (module wiring; shutdown-route denial in
`validate_path` + test); `src/lib.rs` (`Arc<StreamRegistry>` managed state, `stream_id` parameter,
new `service_stream_cancel` command).

**TypeScript** (`STUDIO/src/`): `platform/harness/conversation.ts` (new — the conversation
client); `platform/harness/contracts.ts` (wire mirrors: `WireStreamEvent` parser, chunk facts);
`platform/harness/index.ts` (exports); `platform/harness/conversation.test.ts` (16 tests);
`contracts.test.ts` (+10); `features/chat/useConversation.ts` (new — the state machine);
`features/chat/useConversation.test.tsx` (10 tests); `features/chat/index.ts` (export).

**Harness** (`STUDIO HARNESS/`): `src/transport/http/routes/lifecycle.ts` — docblock only; the
84/1275 baseline is unchanged and passing.

Encoding: all touched files UTF-8, no BOM, ASCII punctuation in source. No dependency changes
anywhere; the Rust side gained no crate (the `watch` type was already inside tokio's `sync`
feature).
