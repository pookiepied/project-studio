# TASK 27 — Classify the failure

**Date:** 2026-08-25
**Scope:** One patch on `@flue/runtime` (delegation, ~15 lines including
comments), the `[fail]` seam in the test provider, five measured-attempt
integration tests plus a classifier unit test in HARNESS, and a display-side
classifier with remedy copy in STUDIO. Nothing committed; the working tree
holds the changes.
**Status:** Complete. Numbers and one honest caveat in "Verification".

---

## 1. Part 0 — the route, settled before any code

**Chosen: patch `@flue/runtime`, but the patch does not contain a policy --
it delegates.** The runtime's inline transient-error regex in
`conversation-projections-*.mjs` is replaced by a call to
`isRetryableAssistantError` from `@earendil-works/pi-ai`, which was already a
dependency of `@flue/runtime` (`^0.80.2`), so the import resolves inside the
package with no new dependency and no copied list at the decision point.
Pi checks its quota/billing exclusions **first**, so the adversarial shape
(billing text that also says 429) is not retried; its retryable list is a
strict superset of Flue's. The retry policy now tracks pi-ai's semver range
instead of rotting in a fork.

Why not the other routes:

- **Route 2, `instrument()` — investigated to a definite answer, because
  nobody knew it.** An interceptor *can* physically reach the retry decision,
  and that is exactly the problem. The only interception point on the model
  path is `emitTurnRequestAndStream`
  (`conversation-stream-store-*.mjs`): `interceptExecution({type:'model',
  turnId}, ctx, () => wrapProviderStream(streamSimple(...)))` -- every event
  that will become an appended record flows through the interceptor's
  `next()`. The decision itself is made after the agent loop returns:
  `runModelTurnWithRecovery` reads the last appended assistant off
  `agentLoop.state.messages` and calls `isRetryableModelError(assistant)`,
  and the budget counter (`countConsecutiveRetryableModelErrors`) reads the
  same appended records back from the persisted path. The constants
  (`MAX_TRANSIENT_MODEL_RETRIES = 3`, base delay `2e3`) are module-private;
  there is no hook. So the **only** lever an interceptor has over the
  decision is mutating `errorMessage`/`stopReason` in flight before append --
  which launders the sentence, and since Task 26 the settlement's message is
  rendered verbatim, so laundering edits what the person reads. Throwing a
  different error instead would swap the outcome to `aborted`, which is its
  own fabrication. Verdict for the report: **reach: yes; honest influence:
  none.** `instrument()` stays observational here, which is what both of our
  existing call sites already use it for.
- **Route 3, classify above the harness only** -- rejected as insufficient:
  it fixes neither the transient failures that were never retried (the one
  that loses work) nor the wasted retries. Its user-facing half is done
  anyway, because display classification lives above the wire regardless of
  route (section 4).

Patch mechanics: the target bundle's filename carries a content hash, so an
upgrade fails the patch loudly rather than silently. The reason lives in three
places where the next upgrade will look: a comment inside the patched
function itself (with re-derivation instructions), the comment block beside
`patchedDependencies` in `pnpm-workspace.yaml`, and here.

One classification point, verified: the regex existed exactly once across the
`@flue/*` packages, and both the live loop and the resume-side recovery share
`isRetryableModelError` -- so cold-start resumption inherits the widened
policy through the same function.

## 2. Part 1 — the classifier

The patch replaces the function body wholesale:

```
function isRetryableModelError(message) {
        // [project-studio patch] Delegate ... (comment preserved in the patch)
        return isRetryableAssistantError(message);
}
```

plus one import line. That is the entire diff.

Because the judgement is Pi's, not ours, what needed pinning was our
*assumption* about Pi: `tests/unit/model-retry-classification.test.ts`
asserts the verdicts the patch was written for -- OpenAI's real billing
sentence containing `(insufficient_quota)` **and** `HTTP 429` is NOT
retryable; `Provider returned error` IS; empty sentences and unknown
sentences are not; non-error stop reasons are ignored. If a pi-ai upgrade
changes any verdict, the harness behaviour changes with it and this test
makes that visible instead of silent.

## 3. Measured attempts, not asserted

Each integration test counts assistant records following the submission's
user message in history -- position is the only honest association, since
history snapshots carry no `submissionId` on assistant messages (the Task 26
finding), and it is the same rule the UI projection uses on cold starts.

| Sentence via `[fail: ...]` | Attempts measured | Settled | Test time |
|---|---|---|---|
| default `[fail]` (429 rate limit) | 4 | failed | ~15s |
| `... please check your plan and billing details (insufficient_quota)` | 1 | failed | ~2.3s |
| same but adding `(HTTP 429)` -- matches BOTH lists | 1 | failed | ~2.3s |
| `Provider returned error` (old regex matched nothing) | 4 | failed | ~15s |
| `The upstream planet is misaligned` (matches nothing) | 1 | failed | ~2.3s |
| `[fail-once]` -- refuse once, then answer | 2 | **completed** | ~4.5s |

The last row is the one that proves retry still works rather than merely
failing faster: one refused attempt, then an ordinary answer, settling
complete.

`[fail-once]` needed one seam change that the brief could not have
anticipated: Flue's model-context projection **drops assistant records whose
stopReason is `"error"`** before the next attempt, so attempt two arrives at
the provider byte-identical to attempt one -- there is no signal in Context
to read. The test adapter therefore counts refusals per distinct sentence in
a module-level map (each scenario uses its own sentence). Documented beside
the code.

## 4. Part 2 — the remedy the person reads

`STUDIO/src/features/chat/transcript/failure-kind.ts`: a pure classifier over
the settlement sentence -- wire facts only, nothing feeds back into requests.

- **quota** -- exhaustion wordings (mirroring pi-ai's non-retryable list),
  checked FIRST so `insufficient_quota` dressed as 429 still reads as
  billing. Copy: a quota or billing limit on the provider account, waiting
  will not lift it, check plan and billing settings.
- **rate-limited** -- deliberately narrower than the harness's full transient
  set (`rate limit / too many requests / 429`). The copy claims a retry
  already happened, which is true only of sentences the harness recognizes
  AND retries; reserving the claim for the throttle family keeps it honest.
- **unclassified** -- everything else, empty included. No category is
  invented; the provider's words render as-is. An unrecognized error is not
  a rate limit.

Wired into all three places the sentence appears: the `submission-failed`
card, the failed end-line under an assistant turn (aborted turns get no
advice appended -- aborting is the person's own act), and the run-failed
connection notice. Tests: classification table including the both-lists
adversarial input, plus render tests asserting the remedy line appears for
quota and throttle sentences and appears for nothing else.

## 5. Where this brief was wrong

1. **Route 2 was framed as "whether the interceptor sits anywhere that can
   change what gets appended", implying the likely answer is no.** The answer
   is yes -- it wraps the exact stream whose events become the record. What
   it lacks is any lever besides editing the error text, i.e. laundering.
   "Cannot reach" would have been the wrong conclusion; "can only reach by
   doing something forbidden" is the right one, and it kills route 2 just as
   dead but for the stated reason.
2. **The brief's Pi-miss list was itself incomplete.** pi-ai's retryable list
   additionally carries `internal.?error`, `connection.?error`, `other side
   closed`, `socket connection was closed`, `retry delay`, `try your request
   again`, `please retry your request`; its non-retryable side also names the
   Go/Free usage-limit error types and `available balance`. Copying the
   brief's list would have been stale on day one; delegating made the gap
   moot.
3. **"The two lists live in one named place" turned out to be two places by
   necessity.** The retry judgement lives in pi-ai via the patch (zero
   copies); the STUDIO display mirror must restate the quota wordings as
   substrings because webview code cannot import a model SDK. Documented
   drift asymmetry makes that safe: a stale mirror under-states (shows the
   bare sentence where it could have shown advice) and never fabricates.
4. **Nothing in the brief suggested the second attempt is indistinguishable
   from the first at the provider boundary.** Failed assistants are dropped
   from model context, so the succeed-on-retry test demanded seam-local
   state -- a small, documented wart on the test adapter.
5. **A tooling hazard the next patch will hit:** `pnpm patch-commit` rewrites
   `pnpm-workspace.yaml` and silently drops human comments -- including the
   pre-existing note about the meta-task #12 patches. Both were restored;
   anyone adding a patch should expect to re-add their documentation.
6. **Baseline nit:** the brief says STUDIO is "12 files / 193 tests"; Task
   26's report recorded 12 files / 190 tests, and nothing in the working tree
   explains the difference. Current ground truth after this task: 14 files /
   204 tests, all passing.

## 6. Verification

Each suite run alone, sequentially. Machine context matters and is recorded
honestly: this workstation was under external load during parts of testing
(an unrelated `npm install` from another session ran ~25 minutes mid-suite,
and Unreal Editor / other agent sessions stayed active).

```
STUDIO:               pnpm test      -> 14 files / 204 tests passed (baseline 12 / 193)
                      pnpm typecheck -> clean
STUDIO/src-tauri:     cargo test     -> 64 passed (baseline 64)
                      cargo clippy --all-targets -> 0 warnings
STUDIO HARNESS:       pnpm test      -> 1284 passed, +25 environment skips;
                                        3 contention failures, each green alone
```

The three HARNESS full-run failures all share one signature -- a spawned
harness child sitting silent past the 20 s startup budget ("never accepted a
connection ... stdout=(nothing)"), or a spawn-heavy timeout in the MCP test
-- and they moved between tests between runs while every behavioural test
passed in every run. Rerun immediately after, alone:
`harness.test.ts` 15/15 and `mcp-flue.test.ts` green. The five new
integration tests passed inside the full suite run as well. The startup
budget itself was deliberately left at 20 s: raising it is documented in the
test file as explicitly not the fix for contention.

No scratch files remain; `/tmp` logs are outside both repositories.
