# Phase 8 - The patches, last

**Date:** 2026-09-03. The last phase of the Flue 2.0 migration. When the
verifications below were recorded, every suite was green or accounted for
per failure, and the exit ran in the real app.

---

## 1. What was actually wrong, and what you changed

Under `@flue/runtime@2.0.3` unpatched, four things were broken, all of them
regressions from the patched beta.9 behaviour:

1. **Retries were invisible in both channels at once.** A scheduled
   transient-model retry wrote an internal log line and nothing else, and
   2.0.3's history projection additionally dropped the errored assistant
   attempt entirely - so a person watching a retrying turn saw a turn that
   had stopped, in the transcript and on the stream alike.
2. **One budget for every kind of failure.** `MAX_TRANSIENT_MODEL_RETRIES
   = 3` served a rate limit and a dead socket identically.
3. **No quota or billing guard.** OpenAI's `insufficient_quota` arrives as
   an HTTP 429; the shipped regex read it as transient and burned three
   retries before the person saw the one sentence that could help.
4. **`composeSystemPrompt` re-stated environment facts the agent already
   carries**, including a compose-time `Date:` line.

The mechanism this phase landed (or verified) is five hunks in
`patches/@flue__runtime@2.0.3.patch`, applying to two bundles of the
installed runtime:

- **Hunk 1** (`conversation-stream-store-*.mjs`, `waitForTransientModelRetry`)
  makes each scheduled retry visible and its budget per-class: it appends a
  `submission_retry_scheduled` record carrying wire facts only (attempt,
  maxRetries, delayMs, the failed attempt's error sentence), and asks the
  injected policy on `globalThis.__projectStudioTransientModelRetryPolicy`
  for this failure's budget and wait. An absent, malformed or throwing
  policy falls back to the shipped constants and shipped delay curve, so the
  fallback path is exactly the pre-Task-30 behaviour. The exhausted branch
  still emits nothing.
- **Hunk 2** (`dispatch-*.mjs`, `isRetryableModelError` + its import line)
  delegates the heuristic half of the transient-error classifier to pi-ai's
  `isRetryableAssistantError`, whose non-retryable list (quota, billing,
  monthly limits) runs before its retryable list. Upstream's own two lines
  - the `stopReason`/`errorMessage` precondition and the 2.0.3
  `(retryable_interruption)` marker check - stay in front of the delegation.
- **Hunk 3** (`dispatch-*.mjs`, `projectConversationUi`) stops folding an
  errored assistant step into the response that replaced it. The failed
  attempt keeps its own message; a submission with no failures folds exactly
  as upstream folds it. This is what makes a retry visible in the transcript
  channel, not only on the stream.
- **Hunk 4** (`dispatch-*.mjs`, `encodeRecord`) projects
  `submission_retry_scheduled` into a `submission-retrying` chunk. Unknown
  record types project to nothing by design - the one record Studio itself
  adds needs its own case beside the other `submission_*` cases.
- **Hunk 5** (`conversation-stream-store-*.mjs`, `composeSystemPrompt`)
  removes the compose-time `Date:` line and the bare `Working directory:`
  line. Section 3 is the decision record.

The budget table itself never entered the patch:
`src/reliability/model-retry-policy.ts` (rate-limit 8, transport 2,
everything else 3, top-heavy jittered doubling capped at 30s) is published
at the composition root (`src/app.ts`, step 3) and consulted over
`globalThis`, because the bundle executes from pnpm's virtual store and
cannot import our source.

**The found state, honestly.** When this phase began, the working tree
already carried an uncommitted patch file with hunks 1-4, a
`patchedDependencies` entry in `package.json`, and a lock file update -
a prior session's re-derivation, with nothing recorded proving it ran. This
phase verified it against the acceptance list (all ten green in the
containing file, 26/26), added hunk 5 (the only genuinely open decision),
moved the entry from `package.json` to `pnpm-workspace.yaml` (the historical
home of the beta.9 entries; both locations work under pnpm 10), rewrote the
workspace comment block to describe the patches instead of the regression,
and ran every proof below. The old `@flue__runtime@1.0.0-beta.9.patch` -
kept on disk through Phases 2-7 precisely so this phase could re-derive
from it - is deleted; the migration rule is to delete the old thing in the
phase that replaces it, and nothing references it any more.

## 2. The two hunks (five hunks), with their re-derivation recorded

This is the section the next upgrade reads. The brief's "two hunks" map to
the patch's five: its hunk one is patch hunk 2, its hunk two is patch hunks
1, 3 and 4, and its Part 4 decision is patch hunk 5.

**The rule that survived beta.9's death: anchor on content, never on a
chunk filename.** Every bundle filename carries a content hash, and Phase 7
changed the hash basis (`nativeModuleIdentity()` in `vite.config.ts`), which
renamed the application chunk outright. The beta.9 patch failed 2.0.3
because its hunks were anchored to beta.9 bytes; every hunk in the 2.0.3
patch carries a `[project-studio patch]` comment saying what to anchor on
next time. Concretely:

- **Patch hunk 1** (`waitForTransientModelRetry`, in the Session class of
  the stream-store bundle). Anchored on the shipped function body: the
  `attempt > MAX_TRANSIENT_MODEL_RETRIES` exhausted branch, the two
  `internalLog("warn", "[flue:model-retry] ...")` lines, and the
  `modelRetryDelayMs(attempt)` call. Those lines are upstream's own and
  stable across the beta.9 to 2.0.3 move; the re-derivation was a re-anchor
  onto the new file's byte-identical function, plus the same two insertions
  (the policy consultation before the branch, the record append after the
  `AbortController`). The `@@` header numbers: hunk 5 adds 20 lines above
  this hunk in the same file, so its new-side start moved from 3999 to 4019.
  pnpm applies hunks by context, not by the `index` blob hashes - the diff
  headers still carry beta.9-era blob ids and apply cleanly, which is the
  proof that only the context lines matter.
- **Patch hunk 2** (`isRetryableModelError`, moved to the dispatch bundle in
  2.0.3; beta.9 had it in `conversation-projections-*.mjs`). Anchored on the
  function's first two shipped lines, which are deliberately kept in front
  of the delegation: the `stopReason !== "error" || !message.errorMessage`
  precondition (the same precondition pi-ai applies) and the
  `(retryable_interruption)` marker check, new in 2.0.3 - Flue's own proof
  that a throw site was a transient interruption, which outranks any text
  heuristic and never carries a quota refusal, so checking it first neither
  weakens the billing guard nor loses the marker's behaviour. The hunk also
  extends the pi-ai import line (`isContextOverflow` gains
  `isRetryableAssistantError`). The delegation replaces exactly one line:
  the shipped regex.
- **Patch hunk 3** (`projectConversationUi`, dispatch bundle). Anchored on
  the `responseBySubmission` merge inside `projectConversationUi` - the
  one-message-per-response folding 2.0.3 introduced. The patch computes
  `failedAttempt` from the entry (`role === "assistant" &&
  stopReason === "error"`), skips the merge for it, deletes any open
  response for the submission, and skips response metadata and anchored
  data parts (only the surviving step has any). Verified behaviour: a
  submission with no errored steps never enters the new branch.
- **Patch hunk 4** (`encodeRecord`, dispatch bundle; beta.9 had it in
  `flue-app-*.mjs` - the exact move that killed any filename anchor).
  Anchored on the switch inside `function encodeRecord`, the new case
  sitting directly above `case "submission_settled"`. 2.0.3's signature grew
  a fourth parameter (`responseIds`); the case ignores it. It returns the
  `submission-retrying` chunk with `conversationId`, optional `submissionId`,
  `attempt`, `maxRetries`, `delayMs` and the optional `error` sentence -
  wire facts only, no policy.
- **Patch hunk 5** (`composeSystemPrompt`, stream-store bundle). Anchored on
  the function and its `if (env)` tail block; see section 3.

**Why the anchors survive a rebuild:** each one names a function, a control
flow, or a structural neighbour in upstream's own source, none of which
depends on the bundler's hashing. When the next upgrade renames the chunks,
the hunks fail loudly (pnpm refuses the install), the comments say where to
re-anchor, and `documentation/architecture/retry.md` row 1 says what the
resulting behaviour must be. The tests that pin all of it end to end are
the retry behaviours in `tests/integration/harness.test.ts`.

## 3. The system prompt decision

**Method.** The real composed prompt was captured from real turns through
the real harness: a throwaway driver spawned the built `dist/server.mjs`
with a `--import` preload that re-registered the `project-studio` provider
with a capturing scripted stream (registration is idempotent by
replacement), sent one turn, and wrote every `context.systemPrompt` the
provider received. The "without our block" variant was produced by a
temporary hand edit to `src/agents/studio.ts` (return the static prompt
only), one rebuild, a second capture, and a revert verified byte-identical
by `git diff`. Both scripts were deleted after use.

**What 2.0.3 adds at compose time, captured verbatim below our block** (the
conversation workspace path is abbreviated to `...`):

    # Environment

    This is what is true right now. It is not part of the conversation, and
    you do not need to repeat it back.

    Today is 2026-09-03.

    Your working directory is C:\Users\pooki\AppData\Local\Temp\studio-prompt-capture-...
    It is not a git repository.

    Commands run through bash. Pipes, &&, quotes, and redirection are
    interpreted by the shell.
    Machine: win32 10.0.26200

    ## Available Agents

    None. No subagents are currently declared, so the `task` tool has no valid
    `agent` value - do not call it unless an agent is introduced later in the
    conversation.

    Date: Thu, Sep 3, 2026
    Working directory: C:\Users\pooki\AppData\Local\Temp\studio-prompt-capture-...

(The one paragraph inside the quote is upstream's own text, condensed here
to stay ASCII; its exact bytes are in the bundle and in the patch context.)

**The brief's cache premise was wrong, and the captures are the proof.**
The `Date:` line does not change every turn: `toLocaleDateString` with
weekday, year, month and day is day-granular. And it sits at the tail of
the composed prompt - after the instructions, AGENTS.md, skills and the
agents section - so it never invalidated a cached head. Within a
conversation-day the whole composed prompt is byte-stable across turns.
What the line actually was: a second spelling of a fact we already carry.

**The options as briefed.** Drop our `# Environment` block and lose the
git, shell and machine facts - rejected: the shell statement (ADR 0046) is
the one line that stops a model writing bash syntax on a machine whose
interpreter refuses `&&`, and nothing upstream carries it. Re-patch to
suppress the duplication - chosen, narrowly.

**The choice: patch hunk 5 removes the `Date:` pushSection and the bare
`Working directory:` push, and keeps the two things that are not
duplication.** The `## Available Agents` section stays because it is
load-bearing even with an empty roster: the `task` tool is always
registered (framework tools are unconditional), and its description points
the model at exactly that section - the empty-roster paragraph is the
tool's other half. The directory listing stays because it is a fact ours
does not carry; it is empty for a fresh conversation workspace (so it costs
nothing today) and will serve a project-rooted conversation when projects
land. After the patch the composed prompt ends at the Available Agents
section; the capture proves it.

**What is lost, said plainly:** the second date spelling and the bare cwd
line (duplicated facts - nothing). The title agent's prompt loses the
`Date:` line - it renders no environment block and attaches no sandbox, so
the line was its only date - and a title needs no date. A third option the
brief did not offer was considered and rejected: dropping OUR `Today is`
and working-directory lines so upstream's lines become the only source.
It would scatter the environment story across two authors, make the git
sentence contextless, and hand two facts to an upstream section that the
next upgrade can reshape without our consent.

## 4. The ten tests

Verbatim, with single-file durations (2026-09-03, `tests/integration/
harness.test.ts` run alone: 26/26) and both full runs green:

| Test | Before (Phases 4/5, 6, 7 full runs) | After | Time |
|---|---|---|---|
| retries transient wording the old classifier missed until the budget is spent | failed | passed | 14.4s |
| recovers when a transient refusal clears on the second attempt | failed | passed | 4.1s |
| announces every scheduled retry on the wire while the provider keeps refusing | failed | passed | 14.8s |
| announces exactly one retry when the refusal clears, then completes cleanly | failed | passed | 3.7s |
| ends a cancelled retry visibly rather than letting it simply stop | failed | passed | 2.1s |
| follows the class when the failure changes between attempts | failed | passed | 7.8s |
| spends a transport failure's short budget and gives up announcing nothing further | failed | passed | 7.1s |
| grants the final retry at exactly the transport budget boundary | failed | passed | 7.6s |
| keeps a rate-limited turn going past the old budget and cancels a long wait cleanly | failed | passed | 57.3s |
| re-derives the attempt count across a restart instead of starting over | failed | passed | 48.1s |

**The most important sentence in this report:** no test needed anything
beyond the hunks. Not one line of test code changed, no fixture moved, no
timeout moved, and no helper grew - the ten red tests of Phases 4/5 through
7 came back green on the hunks alone, first in the containing file, then in
both full runs. The two quota-guard tests that share the regression but sit
outside the acceptance list ("fails fast on quota exhaustion instead of
burning the retry budget", "does not retry billing exhaustion that arrives
dressed as a 429") are green too, as is `tests/unit/built-agent-modules.test.ts`
(Phase 7's sourcemap reader, unrelated here, still passing under `pnpm test`).

## 5. Both full suite runs

`pnpm test` (builds first), one at a time, from clean:

- **Run 1, 2026-09-03 22:30 local: 1506 passed, 1 failed, 25 skipped**
  (101 files, 1 skipped). The one failure is the brief's named
  intermittent, `mcp-flue > runs a real selected tool through approval and
  removes it after disable`, dying as "No approval arrived" inside its own
  30s wait. It is not this phase's regression: run alone immediately after,
  it passes (16.5s), the same shape the Phase 6 and 7 reports recorded (it
  failed in four of seven observed full runs before this phase). Reported
  per failure, not folded into the total.
- **Run 2, 2026-09-03 22:49 local: 1507 passed, 0 failed, 25 skipped**
  (101 files, 1 skipped), `mcp-flue` green inside the run.

The floor was ten; it is zero. The only red anywhere is the named
intermittent, above it, reported per its own failure.

Around the two runs: `pnpm typecheck` clean; frontend `tsc -b` clean and
the frontend suite **49 files, 471 tests, all green**; `cargo clippy
--all-targets` zero warnings; `cargo test` **64 passed, 1 failed** - the
one being `a_deliberate_stop_reports_stopped_and_leaves_no_hot_wal`, which
asserts the WAL is gone beside the real `~/.studio/data/studio.db` after a
polite stop. During the run, the user's own Studio instance (opened 22:18,
harness pid 18704) was live and holding that database, so the WAL of
record existed and the assertion failed on a shared real path, not on the
supervisor's behaviour. Not killed (it is the user's session), not retried
into passing, no timeout raised; re-run it on a machine with Studio closed
for the 65/65. The failure's mechanism is the test's assumption that it is
the only harness alive - the same environmental class as the mcp-flue
intermittent.

## 6. The real retrying turn

Driven in the user's running desktop app (dev frontend, the harness it
spawns at `dist/server.mjs` - which had loaded the fully patched runtime at
22:18). Four real turns were spent, all on free models, none looped:

- Three turns on the Free Models Router answered on their first attempts
  (greeting, weather, colours). The titler titled the conversation on the
  first.
- The fourth turn, on `openrouter/minimax/minimax-m3:free`, was the exit.
  **What failed:** MiniMax's upstream backend (GMICloud) refused the request
  with HTTP 400 "Backend request failed with status 400 ... invalid params,
  model[MiniMax-M3] does not support max tokens > 524288", wrapped by
  OpenRouter as the sentence `Provider returned error` - the exact wrapper
  the shipped inline regex matched nothing in, and the headline case the
  classifier hunk exists to retry.
- **What the app showed:** the transcript displayed the retry wait -
  observed on screen as "Attempt 2 of 4 failed - waiting 4s before trying
  again" with the provider's sentence beneath it - and, when the budget
  ran out, the visible "This turn failed" settlement card carrying the full
  sentence, with a "See what happened" control. The sidebar showed the
  conversation as Working through the retries and stopped when it settled.
- **How many attempts:** four model calls. The durable journal carries
  exactly three `submission_retry_scheduled` records for the submission
  (attempt 1: 1572ms, attempt 2: 3708ms, attempt 3: 7324ms - the doubling
  curve with its jitter, maxRetries 3 each: the generic-transient budget,
  the correct class for a sentence with no 429 and no transport words) and
  the exhausted branch announced nothing; the settlement carries the
  failure. Under the unpatched 2.0.3 runtime this turn would have failed on
  attempt one, silently, with the errored attempt erased from the
  transcript besides.

One finding to carry, not this phase's to fix: the catalog row for MiniMax
M3 free promises max output 943,718 tokens, but the backend rejects anything
over 524,288 - so every turn on that model fails through this wrapper, and
the patch (correctly) spends the generic budget on it before failing
visibly. The catalog data wants a correction to 524,288 or a clamp in the
adapter.

## 7. Every place this brief was wrong

1. **"`VALID_THINKING_LEVELS` does not exist in 2.0.3. Confirmed."** It
   exists - `dispatch-nU3cIlT-.mjs` line 2959, the same object-map shape,
   already carrying `max` (and `minimal`, `xhigh`). The verdict (delete the
   hunk) was right anyway, but for the honest reason: the change is already
   upstream, not "nothing to re-derive against". The migration doc's
   Correction 2 carries the same wrong reason and was corrected there.
2. **The `Date:` line "changes on every turn and defeats prompt caching,
   which costs money on every single request."** False twice over: it is
   day-granular, and it sits at the tail. The real composed prompts were
   captured before deciding; section 3 records the correction. The removal
   stands on duplication, not caching - a wrong reason on the record
   invites the next person to "restore" the line as harmless.
3. **Part 0's "what is actually broken right now" was stale.** Items 1-3
   (classifier, visibility, budget) were already fixed in the working tree
   by an uncommitted re-derivation sitting in `git status` when the phase
   began; only the prompt decision, the workspace re-point, and the proofs
   were genuinely outstanding. The phase's first hour was spent verifying
   found work rather than deriving - which is why the found state is
   documented in section 1 before anything else.
4. **Part 3's hunk-two home ("the conversation-stream-store and flue-app
   bundles").** There is no flue-app code chunk in 2.0.3 - only its
   `.d.mts` - and the projection half of the hunk lives in `dispatch-*.mjs`.
   Part 1 of the same brief knew the chunks moved; Part 3 still named the
   old home.
5. **"Frontend suite green (48 files, 465 tests as of 2026-09-03)."** The
   suite is 49 files and 471 tests now - it grew since the brief was
   written. Green either way; the numbers wanted re-measuring, not
   repeating.
6. **"Re-add the patch entry to `pnpm-workspace.yaml`."** The found tree
   had the entry in `package.json` (the prior session's choice). It works
   there under pnpm 10, but the beta.9 entries had always lived in the
   workspace file, so the entry was moved there - both for the brief's
   letter and for the repo's own convention.
7. **Part 1 item 5's warning is right and worth stating positively.** The
   exit turn's settled row reads `attempt_count: 1, max_attempts: 3` (the
   durability axis) while the transient axis made four attempts with three
   announced waits. Two axes, two numbers, one turn - exactly the asymmetry
   `retry.md` warns about, and exactly why `submission_running`'s
   `maxAttempts` was never a signal to build on.

## State left on the user's machine, named

- One new conversation in the real index, "Greeting Request": four turns,
  three answered on the Free Models Router, one failed visibly on MiniMax
  M3 free (the exit). Deletable in the UI like any conversation. The
  conversation's model was returned to Default model after the exit; the
  running app was not closed, restarted or otherwise touched.
- `~/.studio/` was opened read-only (one SQL query against the journal to
  verify the retry records). Nothing written, nothing deleted; the beta
  journal files and the Phase 1 export are untouched.
- Three prompt-capture text files in `D:\Creative Library\Workspace\`
  outside the repo, deleted after the report was written. The two throwaway
  capture scripts inside the harness tree were deleted at capture time.
- `pnpm install` ran three times during the phase (hunk 5, then the entry
  move); the lock file matches the patch file's sha256, and `package.json`
  ended identical to its committed state.

## Rules slips, named

- One temporary hand edit to `src/agents/studio.ts` (dropping the
  environment block for the "without our block" capture), reverted in the
  next breath and verified byte-identical by `git diff` before anything
  else ran on it.
- The Rust suite is 64/65 as this report is written, the one failure being
  the environmental WAL collision with the user's live app (section 5).
  Everything else in the verification list is green. Re-run
  `cargo test` in `STUDIO/src-tauri` once Studio is closed; nothing in this
  phase's changes touches Rust.
