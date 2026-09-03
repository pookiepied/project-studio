# TASK 23 — The Harness stops politely, and says what happened

**Date:** 2026-08-24
**Scope:** `STUDIO/src-tauri/src/harness/` and `STUDIO/src-tauri/src/lib.rs` (Rust);
`STUDIO HARNESS/src/app.ts`, `src/transport/http/{create-app.ts,routes/lifecycle.ts}` plus
their tests. `STUDIO/src/` TypeScript untouched — 7 files / 93 frontend tests still pass.
**Status:** Complete. Nothing committed — the working tree holds the changes.

---

## 1. The shutdown mechanism, and what was rejected

**Chosen: an admission-protected `POST /api/shutdown` on the Harness**, restricted to the
`studio-host` client type. The task's lean, verified rather than accepted:

- `SIGTERM` is not deliverable on Windows from Rust (`std::process::Command` cannot send it;
  `process.kill` maps to `TerminateProcess`). This is the defect being fixed.
- **Rejected: `GenerateConsoleCtrlEvent(CTRL_BREAK_EVENT)`.** It requires the child in its own
  process group *and* a console to signal from; a GUI Tauri process has no console, and the API is
  documented-unreliable in exactly that configuration. Two platforms, two mechanisms.
- **Rejected: writing to the child's stdin.** `harness/channel.rs` closes stdin immediately after
  delivering the bootstrap because the child reads it to EOF — that close is load-bearing for
  startup on both platforms. There is no line left to write.
- **Rejected: Node's parent `"shutdown"` message.** It needs libuv's IPC channel
  (`stdio: 'ipc'`), which `std::process::Command` cannot create.

HTTP needs none of that machinery and behaves identically on both platforms. The route lives in
`routes/lifecycle.ts`, mounted by `createHttpApp` behind the existing global admission middleware,
so "requires admission" is inherited, not re-implemented. `app.ts` passes
`requestShutdown: () => void shutdown().finally(() => process.exit(0))` — the same drain the
signal handlers run — so there is one shutdown implementation, reached three ways.

**Client-type check, not a new scope.** Adding a scope would change ADR 0028's admission model
(the task's stop condition); reading the already-existing `AuthContext.clientType` changes nothing.
The distinction needed — "the process that owns this process" vs "a UI consuming it" — is exactly
what the client-type model already encodes. No stop condition triggered.

**One deviation from the lean's wording, stated plainly:** Rust does not reuse
`services/fetch.rs`'s async client for this call. `shutdown_all` runs synchronously on the exit
path (window `Destroyed`, `RunEvent::Exit`), where no async runtime is guaranteed to still exist;
enabling reqwest's `blocking` feature would add runtime machinery at the worst possible moment.
Instead the request is a hand-written loopback POST over `TcpStream` (~30 lines, header-read only),
the same bare-HTTP shape `integration.rs` already proved against this exact peer. Credential
discipline is unchanged: bearer attached in Rust, passed through `redact` on every error path,
never logged.

The response is `202 {accepted:true}`, sent *before* the drain begins (`requestShutdown` is
fire-and-forget; the exit happens after the awaited drain). The Host's real confirmation is the
process exiting within the drain bound, not the body.

## 2. The drain bound

`DRAIN_BOUND = 10s`, applied twice: once for the harness to exit after acknowledging, and once for
an in-flight spawn to settle when shutdown lands mid-startup. Reasoning: the graceful path does a
bounded amount of honest work — invalidate admission, stop each MCP server (awaited by
`StudioRuntime.stop()` → `supervisor.stopAll()`, each typically well under a second), close two
SQLite databases with checkpoint. It deliberately does **not** wait for an in-flight model turn
(ADR 0032 §3 leaves unfinished submissions reclaimable). That work measures ~1–3s; ten seconds is
headroom for a cold disk or a slow MCP stop. Past the bound the old termination runs, preceded by
a `warn` log naming why — a silent fallback would mean the mechanism broke unnoticed. A drain that
waits forever is a window that will not close; the bound matters more than its value.

## 3. How status stopped contending with spawn

The old `start()` held the supervisor lock across spawn + readiness — up to 30s — so every status
call during eager start queued behind it. Now:

- `Inner` gains a `starting` flag, set under the lock before the long work begins.
- The spawn itself runs **without** the lock (`spawn()` → `launch()` takes it only for the instant
  of the Windows job assignment; readiness waits lock-free).
- `status()` answers `starting` whenever the flag is set — prompt by construction, never blocking.
- Concurrent `start()` callers wait on a `Condvar` (`spawn_settled`) and inherit the outcome rather
  than double-spawning; the wait is bounded by `STARTUP_TIMEOUT + DRAIN_BOUND` and errors honestly
  if a starter somehow wedges past all of its own bounds.
- The spawn polls an `abort_start` flag every 50ms tick, so `shutdown_all` during a startup window
  tells the in-flight child to land dead instead of installing a Harness nobody wants — then waits
  (bounded) for it to settle. On Unix this closes a real hole: previously a quit racing the eager
  start could leave a live orphan Harness; on Windows the Job Object was the silent backstop.
- The spawn path remains synchronous — no lock is held across an await (there are none); the
  discipline Clippy demanded of the async version now covers reads too.

`HarnessStatus.state` gains `starting`; the command signature is unchanged.

## 4. Deliberate stop vs crash

An `expected_exit` flag in `Inner` marks "a stop was asked of this child", set when
`shutdown_all`/`restart` take a live child and consumed with it, so it can never leak into the next
lifecycle (it is also reset on install and at the start of every spawn flight). `reap_locked`
— which now keeps the `ExitStatus` instead of discarding it — branches on it:

- **Expected:** `last_error` cleared; `status()` reports `stopped`. Correct: that exit is the stop
  landing.
- **Unexpected:** `last_error = "Harness exited unexpectedly: <status>"` (through `redact` like
  every diagnostic; an OS status string carries no bearer anyway). `status()` reports `failed` with
  that sentence, where before it reported `stopped` with nothing — the difference between "crashed
  mid-run" and "never started" is now observable, and the webview gets `harness-failed`.

Observation stays lazy (nothing watches the child between calls): every `get_endpoint`, `status`,
and `start` reaps first, and observation is where consequences happen — record, emit, restart.

## 5. Lifecycle events

`LifecycleEvent` → five Tauri events emitted through a sink installed in `setup()`
(`attach_lifecycle_emitter`): `harness-starting` (null payload), `harness-started` (the
`HarnessEndpointView` — `HarnessEndpoint` still cannot serialize, so the token physically cannot
ride the event), `harness-stopped`, `harness-failed` (redacted sentence, serialized flat),
`harness-restarting`. The sink is a closure, not a Tauri type, so tests record events without an
application. Emission order per crash: `failed` → `restarting` → `started`/`failed`.
Events raised before setup — the eager start's `harness-starting` — go to no listener, which costs
nothing: the webview's first look is a status call, not an event backlog.

## 6. Restart once, visibly

On observing an unexpected exit: if the previous unexpected exit was **≥ 60s ago** (`RESTART_WINDOW`),
emit `restarting` and start a replacement on a detached thread, which emits `started` or `failed`.
A second unexpected exit inside the window restarts nothing: terminal `failed`, and the person
decides — a restart loop against a harness that cannot start looks like activity while fixing
nothing. Sixty seconds is two startup budgets, so the window always spans enough to see the
replacement fail, without stranding someone whose harness crashed twice an hour ago. The window
anchors on observation time of the last unexpected exit; manual restarts neither reset nor consume
it. No retry/replay logic here — reattach is a `GET` with an offset (ADR 0045), and that is the
whole mechanism.

## 7. WAL evidence

I cannot drive the app UI from this environment (undecorated custom-chrome window; closing it is a
webview-side interaction, and `STUDIO/src` is out of scope). What I did instead, which exercises
the identical code path:

- **Live test** `a_deliberate_stop_reports_stopped_and_leaves_no_hot_wal`: starts a real Harness
  through the real supervisor against the real data home, asserts `~/.studio/data/studio.db-wal`
  **exists while running**, calls the same `shutdown_all()` that `WindowEvent::Destroyed` /
  `RunEvent::Exit` call, then asserts the `-wal` **is gone** and status reads `stopped`. Passing.
- **Contrast**: `an_unexpected_exit_reports_failed_and_restarts_once` hard-kills via
  `taskkill /F /T` — i.e. `TerminateProcess`, exactly the old every-quit path — and asserts the hot
  `-wal` remains beside `studio.db` before anything observes the death. Passing. Same mechanism,
  opposite outcome: the mechanism is what changed.
- After the full suite ran (which ends every cycle in either a polite stop or a crash absorbed by a
  later polite stop), the data directory shows `studio.db` alone — no `-wal` beside it.

## 8. Verification

| Check | Result |
|---|---|
| `cargo check --all-targets` | `Finished \`dev\` profile target(s) in 3.38s` — clean |
| `cargo test` | **53 passed; 0 failed** (47 prior + 6 new) |
| `cargo clippy --all-targets` | **0 warnings** |
| `STUDIO HARNESS` `pnpm typecheck` | clean |
| `STUDIO HARNESS` `pnpm test` | **84 files / 1275 passed** (was 83 / 1272; +3 shutdown-route tests) |
| `STUDIO HARNESS` `pnpm build` | `done built dist\server.mjs` |
| `STUDIO/` `pnpm test` | 7 files / 93 passed — frontend untouched |

New Rust tests: deliberate-stop→stopped+no-WAL (+events recorded, no bearer in any), kill→failed-with-sentence→restart-once, second-crash-in-window→no third start (count pinned at 2, exactly one `restarting` event), `status` answers `starting` during a spawn (poller thread samples faster than any Node boot can progress), refused-polite-request→`RequestFailed` fallback, acknowledged-but-stuck→`DrainExceeded` (stub servers, no harness, no serialisation guard). Harness-side: `/api/shutdown` refuses unauthenticated (401, route not entered), refuses a `studio-client` credential despite valid admission (403, drain not requested), accepts `studio-host` (202, requested exactly once).

Encoding: all touched files UTF-8, no BOM; the few non-ASCII characters in `supervisor.rs`
(`§`, `—`, `…`) are inherited verbatim from the original docblocks. No dependency or lockfile change.

Two defects found by my own tests during development, both fixed:
1. My first "second crash" test waited for `state == "running"` after killing — but the first poll
   can outrun the kill becoming visible to `try_wait`, so it passed against the corpse and caught
   `start_count == 1`. Fixed to wait for the transition first (`!= "running"`), as the other live
   test already did.
2. When that assertion panicked, `StopOnDrop`'s `shutdown_all` hit the poisoned mutex and the
   double panic aborted the whole test process (`STATUS_STACK_BUFFER_OVERRUN`). Quitting must quit:
   `shutdown_all`'s locks are now poison-tolerant (`into_inner`), with the trade-off noted there —
   a half-updated `Inner` costs at most a mislabelled event during exit, versus a cleanup that
   cannot run.

## 9. Files changed

**Rust** (`STUDIO/src-tauri/`): `src/harness/supervisor.rs` rewritten around a split `Shared`
state (bookkeeping mutex / condvar / lifecycle sink) with `spawn_installed`, `launch` (split from
the monolithic `spawn_child`), `stop_politely`/`post_shutdown`, crash-recording `reap_locked`,
`observe`→restart-once, and six new tests; `src/harness/mod.rs` gains shared `StopOnDrop` in
`test_support` (moved from `integration.rs`); `src/lib.rs` attaches the lifecycle emitter in
`setup`. **Harness** (`STUDIO HARNESS/`): `src/transport/http/routes/lifecycle.ts` (new route),
`create-app.ts` (required `requestShutdown` option, mount), `app.ts` (drain moved above composition,
wired as `requestShutdown`; signal-handler docblock updated), two existing test files updated for
the new option, `tests/unit/http-shutdown.test.ts` new.

**Not done here, deliberately:** the frontend half — subscribing to these events, ignoring
keep-alives — is a later task, as the brief states. `shutdown_all` remains idempotent and is still
called from both exit paths unchanged.
