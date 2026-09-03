# Phase 8 - The patches, last

This is the last phase of the Flue 2.0 migration. When it lands, Studio is
back where it was before the migration started, and the word "migration"
stops being a thing anyone has to hold in their head.

Everything else is done. Seven phases are on `main`: the runtime moved, the
handshake works, turns run, permissions ask and are answered, the composer
sends, the stream reads, titling works, and the Windows build stopped
shipping two copies of every agent module. What is left is the one thing
that was deliberately kept until last.

**The patches were held to the end on purpose.** A patch re-derived against
a bundle nobody has proven they can run is a patch derived twice. Now the
bundle is proven, so the derivation is worth doing once.

---

## Part 0 - What is actually broken right now

This is not hypothetical. `STUDIO HARNESS/pnpm-workspace.yaml` documents it
as a live, named, accepted regression, and its comment block is the single
most important thing to read before you touch anything. Read it whole.

In user terms, four things are wrong today:

1. **Retries are invisible.** A scheduled transient retry writes an internal
   log line and nothing else. There is no `submission-retrying` chunk, and
   the errored attempt is dropped from the history projection - so a retry is
   invisible in **both** channels at once. A person watching a turn that is
   retrying sees a turn that has stopped.
2. **One budget for every kind of failure.** Upstream ships a single budget
   of 3. A rate limit and a broken transport get identical treatment when
   they deserve different ones.
3. **No quota or billing guard.** OpenAI's `insufficient_quota` arrives as an
   HTTP 429, upstream's regex reads it as transient, and it burns three
   retries before the person sees the one sentence that could help them.
4. **`composeSystemPrompt` re-adds an unstable `Date:` line**, plus cwd, a
   directory listing, and an always-present `## Available Agents` section.
   The unstable line defeats prompt caching on every single turn.

`src/reliability/model-retry-policy.ts` still exists and is still installed
on `globalThis`. **Nothing reads it.** That is the shape of this regression:
our code is present and disconnected.

## Part 1 - Measured, so you do not have to re-derive it

All of this is established. Re-check anything you intend to rely on, but do
not spend the phase rediscovering it.

1. **The workspace entry is already removed.** The 2.0.3 install failed
   loudly with `ERR_PNPM_PATCH_FAILED` because the hunks are anchored to
   beta.9 bundle hashes. That was the designed failure. The patch file is
   kept on disk precisely so this phase can re-derive from it.
2. **One hunk has nothing to re-derive.** `VALID_THINKING_LEVELS` does not
   exist in 2.0.3. Confirmed. Delete it rather than hunting for it.
3. **The bundle filenames changed in Phase 7, and this will bite you.**
   `nativeModuleIdentity()` in `vite.config.ts` changed the emitted chunk
   layout: `dist/app.mjs` is now a small shim and the application chunk is
   named `node-server-*.mjs` rather than `providers-*.mjs`. `dist/server.mjs`
   is still the entry and the Tauri supervisor still starts exactly that.
   **Anchor every hunk on content, never on chunk filename.** A hunk anchored
   by filename will fail to match and the phase will have to be redone.
4. **pi-ai is deduped to a single 0.84.4 instance** by a pnpm override from
   Phase 4/5. The bundle bytes are unchanged, but re-verify the anchor hashes
   after any lock file move.
5. **The attempt count lives on the settled row, not the event.**
   `flue_agent_submissions.attempt_count` and `max_attempts`, with
   `max_attempts` written from the agent's `durability` static at
   input-application time - NOT at admission, where the row still carries the
   store default of 10. So `submission_running`'s `maxAttempts` is the
   default on every first attempt and is **not a signal to build on.**
6. **`built-agent-modules.test.ts` (2 tests) is new and unrelated to you.**
   It reads the built sourcemaps and requires `dist/`, so it passes only
   under `pnpm test`, which builds first. It must stay green.

## Part 2 - The acceptance list, and it is not a judgement call

Ten harness tests are red. They pin the patched runtime, they have been
confirmed as the exact failure set across four separate full runs, and their
durations are stable (the longest at 134 s). **When the hunks land, these ten
come back green and nothing else moves.** Verbatim:

```
retries-transient-wording-the-old-classifier-missed
recovers-when-a-transient-refusal-clears
announces-every-scheduled-retry
announces-exactly-one-retry
ends-a-cancelled-retry-visibly
follows-the-class-when-the-failure-changes
spends-a-transport-failure's-short-budget
grants-the-final-retry-at-the-transport-budget-boundary
keeps-a-rate-limited-turn-going-past-the-old-budget
re-derives-the-attempt-count-across-a-restart
```

**No test may be changed to make this pass.** They were left red rather than
weakened, deliberately, by the phase that found them. If a test now looks
wrong to you, that is a finding to report, not a line to edit - and it needs
its own argument in the report, not a quiet diff.

## Part 3 - The two hunks

Read `documentation/architecture/retry.md` first: it holds the map this
belongs to. Then the patch file itself, which says how to re-derive each hunk.

**Hunk one - the classifier.** In the conversation-projections bundle,
replace the inline transient-model-error classifier with a delegation to
pi-ai's `isRetryableAssistantError`, and add the quota/billing guard. The
shipped regex misses genuinely transient wordings - OpenRouter's "Provider
returned error" among them - which are then never retried at all.

**Hunk two - visibility and per-class budget.** In the
conversation-stream-store and flue-app bundles.
`waitForTransientModelRetry` must append a `submission_retry_scheduled`
record carrying **wire facts only** (attempt, maxRetries, delayMs, the failed
attempt's error sentence), which `encodeRecord` projects into a
`submission-retrying` chunk. The budget and the wait for each attempt come
from `src/reliability/model-retry-policy.ts` - rate-limit 8, transport 2,
everything else 3 - consulted on
`globalThis.__projectStudioTransientModelRetryPolicy`, because this bundle
cannot import our source from pnpm's virtual store.

Three rules that are easy to get wrong:

- **An absent, malformed or throwing policy must fall back to the shipped
  constants**, so the fallback path is exactly the pre-Task-30 behaviour.
- **The exhausted branch still emits nothing.** There is no wait to announce
  and the settlement carries the failure.
- **This hunk now owns the delay curve too**, which it did not before.

One sharpening from Phase 4/5, and it changes what "visible" means: under
2.0.3 a retry is invisible in both channels at once, because the errored
assistant attempt is also dropped from the history projection. **Treat the
attempt record itself as part of visible.**

The governing rule for both, quoted from the workspace file: *a retry budget
may only be lengthened once the retry is visible, and invisible retry must
stay short.*

## Part 4 - The system prompt decision

This is the only genuine decision in the phase, and it needs a person to
read a diff rather than a rule to follow.

2.0.3's `composeSystemPrompt` re-adds, at compose time: the `Date:` line, cwd,
a directory listing, and an always-present `## Available Agents` section
whose empty-roster paragraph is in the bundle at
`conversation-stream-store-*.mjs` ("None. No subagents are currently
declared, so the `task` tool has no valid `agent` value - do not call it
unless an agent is introduced later in the conversation.").

We compose our own `# Environment` block carrying git, shell and machine
facts. So the two choices are:

- **Drop our block** and accept losing those facts, or
- **Re-patch** to suppress the duplication and the unstable `Date:` line.

**Get the actual diff first.** Print the real composed system prompt from a
real turn, both with and without our block, and put the relevant excerpt in
the report. Then decide, and say what a person loses either way. The
`Date:` line is not a style question: it changes on every turn and defeats
prompt caching, which costs money on every single request.

If the honest answer is that a third option exists that this brief did not
offer, take it and say so. Phase 4/5 found exactly that on the `cwd`
question and was right to.

## Part 5 - Re-point the workspace

Re-add the patch entry to `STUDIO HARNESS/pnpm-workspace.yaml` once, and only
once, the hunks actually apply. An install that cannot complete is not a tree
anyone can build from, and leaving the repo in that state would block
everyone.

**Update the comment block.** It currently describes the regression in the
present tense as a live, accepted condition. When this lands that is no
longer true, and a comment that lies is worse than no comment. Rewrite it to
describe what the patches do, why they exist, and how to re-derive them at
the next upgrade - which is the thing the next person will actually need.

## Verification

- `pnpm typecheck` (harness) and `tsc -b` (frontend), both clean.
- Frontend suite green (48 files, 465 tests as of 2026-09-03).
- `pnpm test` (harness, builds first), **suites one at a time**. The floor
  was ten; the target is zero. Run the suite whole **at least twice** and
  report both numbers.
- `cargo clippy --all-targets` zero warnings; Rust suite 65/65.
- **The exit, and it is not a test:** a real turn that retries, watched in
  the real app, with the retry visible on screen. Say what failed, what the
  app showed, and how many attempts it made before it stopped.

**On the intermittent.** `mcp-flue > runs a real selected tool through
approval and removes it after disable` has failed in four of seven observed
full runs and passes when run alone. It is not yours and it is not this
phase. Report it per failure if it appears; never fold it into a total, and
never raise a deadline to make it pass. A timeout raised until a flake stops
flaking is a test that has stopped measuring anything.

Live model turns spend the user's money. A handful of real turns, never
looped, never benchmarked; the key never in a log, an error, a fixture, a
screenshot, a test or the report.

## Not this phase

- Do not build the settings UI for the tray and startup toggles. That is the
  next task.
- Do not build the MCP settings pane, delete, archive, or parallel tool
  calling.
- Do not do the architecture audit. It is scheduled deliberately after those
  features, not before.
- Do not touch the composer, the stream path or the abort scope. Phase 6
  settled them and its decisions are recorded in ADR 0033.
- Do not delete `opencode/` (a third-party project in the repo root), the
  exports in the user's home folder, the `*.beta9-journal` files, or anything
  under `~/.studio/`.

## Report

Write `report/PHASE-8-the-patches-last.md`. This is the last report in the
series, so it carries a little more than the others.

Structure it in this order:

1. **What was actually wrong, and what you changed.** Lead with the
   mechanism, not the diff. Somebody reading this in a year wants to know why
   the patch exists before they see what it says.
2. **The two hunks, with their re-derivation recorded.** What you anchored
   on, and why that anchor survives a rebuild. This is the section the next
   upgrade will be read against - write it for that person, not for the
   reviewer.
3. **The system prompt decision**, with the real prompt excerpt quoted, both
   options stated, the choice made, and what is lost by it.
4. **The ten tests, named, with their before and after state.** If any test
   needed anything other than the hunks to pass, say exactly what and why -
   that is the most important sentence in the report.
5. **Both full suite runs**, with per-failure attribution. Never a bare
   total.
6. **The real retrying turn** - what failed, what the app showed, how many
   attempts.
7. **Every place this brief was wrong.** Briefs in this series have been
   wrong in every single phase, without exception. Assume this one is too.
   Finding nothing is itself a claim, and a suspicious one.

Then update `documentation/work/flue-2-migration.md`: mark Phase 8 done with
what actually happened, and **close the migration** - a short statement of
what shipped across all eight phases and what remains outside it. Check
section 7 ("What this migration deliberately does not do") is still accurate
and say so.

If `documentation/architecture/retry.md` no longer matches the code after
your changes, fix it. It is the map this belongs to and a stale map is worse
than none.

## Rules

`Backend/`, `docs/`, `prompts/`, `report/` and `opencode/` are read-only
context, except the one report file you write. Never `git checkout`,
`switch`, `stash`, `reset`, `clean`, `commit` or `rebase`. Do not stage
anything.

No `any`, no non-const `as`, no non-null `!`. UTF-8, no BOM, LF. No
en-dashes, smart quotes, curly apostrophes, ellipsis characters or emoji in
source. Em dashes are permitted in comment prose only. Edit by hand, never
with a script.

No green placeholder tests, and never a test that stopped checking anything.
**The ten tests in Part 2 are the acceptance list and may not be edited.**

Applied migrations are never rewritten - append only. Secrets never enter a
log, a fixture, a report, or an error. API keys live in the OS credential
store and never in a database column or an HTTP response body.

Verify against real code and real runs. Not this brief, not the plan, not the
seven reports - all of them are secondhand, and every one of them has been
wrong somewhere.
