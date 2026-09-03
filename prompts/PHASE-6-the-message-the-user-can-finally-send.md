# Phase 6 - The message the user can finally send

Studio can run a turn. It cannot be asked for one.

Phases 4 and 5 proved the whole stack works - a real conversation wrote a
file and ran a command, and a Manual turn stopped, asked, and was answered.
Every one of those turns was driven over HTTP, because the composer cannot
send. The webview still posts the 1.0 body, and Flue 2.0 refuses it before
admission.

This phase makes the product usable by a person again, and finishes the
stream path underneath it.

Read `documentation/work/flue-2-migration.md` (Phase 6 and both its
amendments) and `report/PHASE-4-5-the-turn-that-actually-runs.md` in full.
This is the first phase that touches `STUDIO/` since the migration began.

---

## Part 0 - Measured, so you do not have to re-derive it

All of this was measured on 2026-09-02 against the real tree and a real
running harness. Re-check anything you intend to rely on.

1. **The refusal, verbatim.** Posting the webview's current body to a live
   2.0 harness returns **400**:

   ```
   {"error":{"type":"invalid_request","message":"Request is malformed.",
    "details":"Delivered messages must be { kind: \"user\", body: string,
    attachments?: attachment[] } or { kind: \"signal\", type: string,
    body: string, attributes?: Record<string, string>, tagName?: string }."}}
   ```

   The same request with `{"kind":"user","body":"hello", ...}` returns
   **202** with a real `submissionId`, and the turn-settings middleware
   creates the conversation row from it. Unauthenticated is still 401. The
   harness half is done; the webview half is this phase.

2. **The refusal body shape changed.** Flue's own refusals are
   `{ error: { type, message, details } }`. Our turn-settings refusal is
   `{ error, code }`. The webview's error reader expects neither reliably,
   which is why a person sees "the harness answered 400 with no
   explanation". Both shapes have to render.

3. **Offsets are opaque everywhere, and nothing parses them.** Rust's
   `services/stream.rs` documents this and holds to it; the frontend holds
   the last reported offset as a string. But the VALUE changed shape: 2.0
   admission returns `0000000000000000_0000000000000000` where the Rust
   tests' fixtures use `5_1`. Nothing should care. Confirm nothing does -
   including any length assumption, any log truncation, any storage column.

4. **What Rust actually depends on** (`services/stream.rs`): SSE frames with
   `event: control` carrying `streamNextOffset`, `upToDate` and `closed`.
   Those three field names are the contract with the runtime, and they were
   written against 1.0. **Verify them against a real 2.0 stream**, not
   against the type surface - read the frames off the wire.

5. **The full suite is unstable above the Phase 8 baseline.** Ten failures
   are Phase 8's documented retry regression and are expected. Two
   consecutive full runs on the same tree gave **11 failed** and then
   **12 failed** - the extra ones are integration tests that spawn real
   harnesses, and they differ between runs. Part 4 has the evidence. The
   unit suite is stable at 1411 passed / 1 skipped.

## Part 1 - The composer

`STUDIO/src/platform/harness/conversation.ts`, `submitTurn`. The body becomes
the 2.0 envelope: `kind`, `body`, and the settings keys beside them
(`modelId`, `reasoningLevel`, `permissionMode`) exactly as the harness
contract spells them - the middleware reads them from the same top-level
object, so they do not move. Images are Flue's own payload field; check
whether `attachments` replaced `images` on this wire and say which.

Then the refusal rendering, because a 400 a person cannot read is the bug
they actually reported. Both shapes from Part 0.2, and a message that names
what was wrong rather than the status code.

**The exit for this part is a person's exit:** type a message in the
composer, send it, and watch the reply arrive. Not a curl. Not a test. The
app, the window, the keyboard.

## Part 2 - The stream

- Verify the three control fields against a live 2.0 stream. If a name moved,
  the Rust side changes - and that is in scope for this phase, unlike the
  last three.
- **`wait()` semantics, written down.** It is `read(submissionId)` now, the
  re-attach form. What it resolves to when the submission already settled,
  when it is still running, and when the conversation is unknown - measured,
  in a docblock, where the next person will read it.
- **The abort scope, written down.** 2.0's abort reaches in-flight AND queued
  work. 1.0's did not. Anything that assumed "abort stops the current turn
  only" needs re-reading, starting with the stop control in the UI.
- **The dedup decision.** 2.0 ships `idempotencyKey` upstream. ADR 0033 says
  a lost acknowledgement is `unknown` and is never blindly retried, and that
  was written because we had no key. We have one now. Adopt it or decline
  it, and either way reopen ADR 0033 and say which - the comment in
  `harness-client.ts` already says this decision belongs here.

## Part 3 - What the transcript lost

Two channel facts, measured by Phase 4/5, that the UI renders from:

- **2.0's history projection carries no model identity on assistant
  messages.** 1.0's `metadata.model` is gone from the record entirely.
- **Errored assistant attempts are dropped from the projection.**

So anything the transcript showed from those channels is showing nothing
now. Find what those are, and re-source them - the settled settings row and
the telemetry events are the two candidates. If the honest answer is "this
belongs in Phase 7 with the rest of the event work", say so and name exactly
what is missing from the UI in the meantime rather than leaving a blank the
user discovers.

## Part 4 - The eleventh failure

`mcp-flue > runs a real selected tool through approval and removes it after
disable` **passes alone (2/2) and fails inside the full run** with "No
approval arrived" after 30 s, followed by an `EBUSY` unlinking the test
database on teardown.

The EBUSY is downstream: the primary failure leaves the harness child holding
the file when `afterEach` deletes the directory, and the debris is real -
26 `studio-mcp-flue-*` directories were sitting in the user's temp folder.

**Machine setup has been ruled out.** The first suspicion was the missing
`ALL APPLICATION PACKAGES` traverse grants on `C:\Users\pooki\AppData` and
`...\Local`, which made every contained start pay per-directory grants.
Those grants were applied on 2026-09-02 and verified present. The advisory
for those two paths is gone from the run. **The test still fails**, and took
longer the second time (66 s, up from 45 s).

The second run also produced new evidence pointing away from MCP entirely:
a different test, `harness > accepts a run, streams renderable state, and
keeps thread continuity`, failed on harness STARTUP - two attempts, both
silent, both refusing connections after 10 s, no stdout and no stderr. That
is a saturated machine, not a protocol fault.

So the shape of the problem is: integration tests that spawn real harnesses
become unreliable late in a 12-minute run, even though `fileParallelism` is
already `false`. Something accumulates across the 100 files - processes,
AppContainer profiles, sockets, handles. Find what, and say what. The
harness-startup failure is the cheaper one to diagnose because it fails in
10 seconds with nothing in its logs.

Do not raise a deadline to make either pass - a timeout raised until a flake
stops flaking is a test that has stopped measuring anything. If the honest
answer is that the suite needs to release something between files, that is a
real finding and it is worth more than the two green ticks.

## Verification

- `pnpm typecheck` clean, and the frontend's own typecheck.
- `pnpm test` (builds first), suites one at a time. **Ten failures are the
  expected floor**, all in `harness`, all the Phase 8 retry regression
  enumerated in the Phase 4/5 report. Anything above ten is either something
  you introduced or the instability in Part 4 - and the report has to say
  which, per failure, rather than quoting a total. Run the suite whole at
  least twice and report both numbers; a single run is what let the last
  phase publish a total it had never observed.
- The frontend suite green.
- `cargo clippy --all-targets` zero warnings; Rust suite 65/65 - or, if a
  control field moved and you changed the Rust side, say exactly what moved
  and why the change was forced.
- **The exit, and it is not a test:** the real app, a message typed into the
  composer, the reply streaming in. Then interrupt a long turn with the stop
  control and resume watching it. Say what you sent, what came back, and what
  the stop actually stopped.

Live model turns spend the user's money. A handful of real turns, never
looped, never benchmarked; the key never in a log, an error, a fixture, a
screenshot, a test or the report.

## Not this phase

- **Do not re-derive the runtime patch hunks.** Phase 8. Retries stay
  invisible and the budget stays upstream's while you work; ten tests stay
  red. Do not mistake that for something you broke.
- **Do not do the event and telemetry renames.** Phase 7 owns
  `run_start`/`run_end` to `agent_start`/`agent_end`, `dispatchId` to
  `submissionId`, envelope `v: 3`, the store contract suites, and the
  `title_model` log fact.
- Do not implement delete or archive, parallel tool calls, or remote MCP.
- Do not delete the Phase 0 spike, the exports in the user's home folder, the
  `*.beta9-journal` files, or anything else under `~/.studio/`.

## Report

`report/PHASE-6-the-message-the-user-can-finally-send.md`: the composer's new
body and what the refusal now says to a person, the three control fields
verified against a live stream (quoted), `wait()` and abort written down, the
idempotency decision with ADR 0033 reopened or reaffirmed, what the transcript
lost and where it now comes from, the mcp-flue verdict, the suite numbers, and
the real turn - typed, sent, streamed, interrupted. And every place this brief
was wrong.

Update `documentation/work/flue-2-migration.md`: mark Phase 6 done with what
actually happened, and amend any later phase an answer here changes.

## Rules

`Backend/`, `docs/`, `prompts/` and `report/` are read-only context, except
the one report file you write. Never `git checkout`, `switch`, `stash`,
`reset`, `clean`, `commit` or `rebase`.

No `any`, no non-const `as`, no non-null `!`. UTF-8, no BOM, LF. No en-dashes,
smart quotes, curly apostrophes, ellipsis characters or emoji in source. Edit
by hand, never with a script - the last two phases slipped on this three
times, each time on a bulk rename, and one of those seds did over-reach and
had to be caught by review.

No green placeholder tests, and never a test that stopped checking anything -
including a timeout raised until a flake stops flaking.

Applied migrations are never rewritten. Secrets never enter a log, a fixture,
a report, or an error.

Verify against real code and real runs. Not this brief, not the plan, not the
Phase 4/5 report - all three are secondhand, and briefs in this series have
been wrong in every phase so far.
