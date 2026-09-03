# TASK 30 — The budget is per class

**Date:** 2026-08-25
**Scope:** One new policy module and its installer, one composition-root
wiring, an extended second hunk on `@flue/runtime`, a new test-adapter
failure grammar, five new integration tests plus two rewrites and two
strengthened assertions, fifteen unit tests, the retry map, the one
corrected sentence in the silent-stop document. Nothing committed; the
working tree holds the changes.
**Status:** Complete. All suites green, baselines re-measured.

---

## 1. Part 0 — what an error actually carries, and the headline: Retry-After does not survive

**Verdict: by the time this code can ask anything, the error is a string.
The provider's number is gone. The table's first row does not get built,
and the row is wrong as written.**

What the classification site sees:

- `AssistantMessage` (`pi-ai/dist/types.d.ts`, lines 279–292) carries
  `errorMessage?: string` and `diagnostics?: AssistantMessageDiagnostic[]`.
  No status code, no headers, no response object. Flue's classifier
  (`isRetryableAssistantError`, `pi-ai/dist/utils/retry.js`) decides from
  `errorMessage` alone, exactly as the brief said.

- **Diagnostics are not populated where it matters.** Across all of pi-ai,
  `appendAssistantMessageDiagnostic` is called at exactly three sites: two
  protocol errors in `pi-messages.js`, and one `provider_transport_failure`
  record in `openai-codex-responses.js` describing WebSocket-to-SSE
  fallback (transport name, phase, request bytes). None of them carries an
  HTTP status or a delay. The mainline error paths — anthropic-messages,
  openai-completions, openai-responses, google, bedrock, mistral — set only
  `errorMessage`. And even if they did populate it, Flue would drop it:
  the reducer materializes a persisted assistant message from exactly
  `modelInfo + content + stopReason + usage + errorMessage + timestamp`
  (`conversation-projections-XMug3C6A.mjs`, the
  `assistant_message_completed` case). Diagnostics do not survive to disk,
  so they cannot survive a resume either.

- **Where Retry-After actually goes.** Exactly one provider reads it:
  `openai-codex-responses.js` (`getRetryAfterDelayMs`, line 59) inside its
  own private fetch-retry loop (line 264). The value is consumed to sleep
  and then discarded; when that loop exhausts, what escapes is
  `new Error(info.friendlyMessage || info.message)` — prose. No other
  provider touches the header at all.

- **The seam higher up exists, and is a dead end for this purpose.** Pi's
  stream options carry `onResponse?: ({status, headers}, model)` (types
  line 76), and our local adapter controls the options it hands to
  `Models.stream()`, so capturing headers is mechanically possible. But
  for every SDK-based provider the callback fires only after a *successful*
  response — Anthropic's `.asResponse()` and OpenAI's `.withResponse()` run
  downstream of the SDK's own throw-on-429 — so on the one path where
  Retry-After exists, `onResponse` never runs. Codex is the lone exception
  because it fetches raw. Building row 1 honestly would mean patching every
  provider to surface failure headers, teaching Flue to persist structured
  facts beside `errorMessage`, and keeping that association resume-safe —
  three layers of invention to honour a number we mostly cannot see.

- **One provider does put a delay in prose** — codex quota exhaustion
  renders `Try again in ~N min.` into the friendly message (line 1155).
  That is the wrong class (quota, budget zero, already refused before any
  retry site) and the wrong format (minutes, rounded, embedded in a
  sentence). Parsing it would be fragile twice over.

So the architecture document's first row — *honour the provider's number* —
describes a thing this layer cannot have. Inventing a delay and calling it
the provider's number was the outcome the brief forbade, and the fixed
backoff stays. A negative result was a real finding in Tasks 27 through 29;
it is one here too.

## 2. Part 1 — where the policy lives: consultation, not import

**The patched bundle cannot import our source. Tried, concretely:**

1. pnpm resolves `@flue/runtime` through a symlink, and Node executes the
   bundle from its real path:
   `node_modules/.pnpm/@flue+runtime@1.0.0-beta.9__d50e…/node_modules/@flue/runtime`.
   A relative escape from `dist/` therefore climbs into the virtual store,
   not the workspace.
2. Live proof: I temporarily prepended
   `import "../../../src/reliability/backoff.js";` to the installed store
   bundle and imported it under Node. The answer, verbatim:

   > ERR_MODULE_NOT_FOUND: Cannot find module
   > `D:\…\STUDIO HARNESS\node_modules\.pnpm\@flue+runtime@1.0.0-beta.9__d50e394b15227ff41c6d78b2dc3bc085\node_modules\src\reliability\backoff.js`
   > imported from `…\@flue\runtime\dist\conversation-stream-store-Bitz7UoW.mjs`

   With the probe in place the harness child never boots (the integration
   start went silent and was replaced, then failed). Even aiming deeper at
   the workspace would fail on the next gate: our source is TypeScript with
   no compiled twin, and neither vitest nor the build transforms an
   externalized dependency.
3. `flue build --target node` does not change the answer: `dist/server.mjs`
   imports `"@flue/runtime"` externally, so the built server loads the same
   untransformed bundle from the same virtual store.

**Therefore the table lives here and travels by injection.**
`src/reliability/model-retry-policy.ts` owns the classes, the budgets and
the delay arithmetic (on top of the shared `getBackoffDelay`), and installs
itself on `globalThis.__projectStudioTransientModelRetryPolicy` from the
composition root (`src/app.ts`), before any session or MCP server can run.
The extended hunk consults that slot at each decision and falls back to the
shipped constants when it is absent, malformed, or throws — the fallback
path is byte-for-byte yesterday's behaviour. The key name is quoted in the
patch comment, the yaml comment block, and this module, so an upgrade can
find all three.

**The rule survived intact.** There is one authority on the
transient-model-error axis: this module. The patch knows how to ask and how
to consume an answer; pi-ai still owns retryable-at-all (and therefore the
zero row, by exclusion, before any budget table runs); the loop, abort
wiring and wire record stay Flue's. The one tension worth naming: the
fallback constants sit in the bundle, which is numerically a second copy of
a budget. I read it as the absence path of the single authority rather than
a rival — it equals upstream behaviour, it fires only when Studio's
bootstrap has not run, and making the patch policy-free *except* its
pre-Task-30 defaults is what keeps the patch safe for anyone else who loads
the runtime. No amendment to the rule is needed, but if a third copy ever
accretes, the rule should be sharpened to say "one authority, plus the
upstream default it degrades to".

Classification of the class is ours and lives beside the budgets; the unit
tests import pi-ai's own classifier and pin the boundary from both sides,
so an upgrade that moves a wording across the retryable line fails there
first.

## 3. Part 2 — the budgets, measured, and the class-change answer

| Class | Sentences (all pre-filtered by pi-ai) | Budget | Measured shape |
|---|---|---|---|
| rate-limit | `429`, `rate limit`, `too many requests` | **8 retries** | six signals watched on the wire, every chunk carrying `maxRetries: 8`; full exhaustion would spend roughly 112–150 s (doubling from 2 s, each wait capped at 30 s), which is why the tests cancel instead |
| generic-transient (default: 5xx, overloaded, OpenRouter wrapper, ResourceExhausted, anything pi-ai calls retryable that no pattern names) | e.g. `503 service unavailable`, `Provider returned error` | **3 retries** — deliberately yesterday's number | four model calls in ~13.8 s, signals `[1, 2, 3]` with strictly growing waits |
| transport | socket hang up, connection reset/refused, timeouts, stream ended, websocket closed | **2 retries** — fast | exhausted on the third refusal with **no third signal**, ~3.9 s; at exactly the boundary the final retry is granted (~3.8 s) |
| quota / billing | `insufficient_quota` and friends | **zero** — enforced by pi-ai, not here | one attempt, settlement failed, and now asserted: **zero retry chunks on the wire** |

Base delay stays 2000 ms everywhere; the shared mechanism's 30 s ceiling
bounds any single wait, so eight attempts cost minutes, not the brief's
eight-minute worst case without a cap. **No total-elapsed ceiling was
added**: the per-class budget times the capped delay already fixes total
exposure as a derivable number, whereas an elapsed wall-clock ceiling would
need its own resume semantics across restarts. If one is ever wanted it
goes in this map first, per the brief.

**Class changes between attempts: the newest failure decides.** Each
decision reads only the attempt count and the sentence of the failure
actually in front of the loop — no memory, no averaging. A 503 then a 429
announces `maxRetries` 3 then 8 (test-pinned both ways). This preserves
derived-not-counted untouched: the count is still
`countConsecutiveRetryableModelErrors` over persisted records, the class is
read off the same records' last sentence, so a resume re-derives both.
Mixing classes also cannot inflate patience: the global count only ever
grows, so total attempts stay bounded by the largest class budget.

**Cancellation survived intact at every depth**: the generous-budget test
collects six signals (past anything the old budget allowed), cancels inside
a long wait, and gets an aborted settlement with nothing retry-shaped after
it.

**Resume mid-wait, measured rather than assumed:** killed the harness
during a wait after two announced retries. The replacement server resumes
by *re-entering the retry decision*, re-deriving the count of two from
persisted records and announcing attempt 2 again — a duplicate signal that
is the property working, the same number derived twice from records. The
decisive half is what happens next: the resumed turn holds one grant left,
not three, and exhausts into a visible failure. Signals `[1, 2, 2, 3]`,
then failed, nothing after. A counter that had restarted would have
completed the turn on a fresh budget — fabrication wearing resume's clothes.

**Part 2 Q1 verified, not assumed:** `RetryWait.tsx` renders
`maxRetries + 1` straight from the wire and the parser passes
`attempt`/`maxRetries`/`delayMs` through as facts; "Attempt 2 of 9" needs
no UI change and got none. Nothing in `STUDIO/src` changed in this task.

## 4. Files changed

- `STUDIO HARNESS/src/reliability/model-retry-policy.ts` — **new**. The
  class-to-budget table, the sentence classifiers, the delay grant on top
  of `getBackoffDelay`, and the install/clear seam. The one authority.
- `STUDIO HARNESS/src/app.ts` — installs the production policy at the
  composition root.
- `STUDIO HARNESS/src/models/adapters/test-adapter.ts` — `[fail-seq: a | b
  | …]`: refuses once per listed sentence, in order, then answers. Keyed by
  the whole bracket token with the same process-lifetime wart as
  `onceFailureCounts`, documented there.
- `STUDIO HARNESS/tests/unit/model-retry-policy.test.ts` — **new**, 15
  tests: classification boundaries, composition with pi-ai's classifier
  from both sides, budgets, give-up mapping onto one-based attempts, delay
  arithmetic with injected randoms, the top-heavy default band, stateless
  class-change semantics, installer round-trip.
- `STUDIO HARNESS/tests/integration/harness.test.ts` — five new tests
  (class-change, transport exhaustion, transport boundary, generous-run
  past the old budget cancelled at signal six, restart re-derivation); two
  rewritten (below); strengthened assertions in the quota test (zero
  signals) and the cancel test (first signal carries `maxRetries: 8`).
- `STUDIO HARNESS/patches/@flue__runtime@1.0.0-beta.9.patch` — second hunk
  extended: consult injected policy defensively, per-attempt effective
  budget, record and log carry the budget in force. First and third hunks
  untouched; record/chunk field names unchanged, so no client-facing schema
  moved.
- `STUDIO HARNESS/pnpm-workspace.yaml` — comment block updated to describe
  hunk two's new shape and the injection seam. `pnpm-lock.yaml` carries the
  regenerated patch hash, nothing else.
- `documentation/architecture/retry.md` — row 1 rewritten (per-class
  budgets, consultation mechanism, fallback), corrections section records
  the split of labour and the import impossibility, permission paragraph
  notes Task 30 spent it for row 1 only, header dated.
- `documentation/architecture/reliability-and-the-silent-stop.md` — the one
  falsified sentence corrected: retry *was* a log line until Task 29 made
  it a record.
- `STUDIO/src/**` — unchanged, on purpose (see §3 last point).

Rewrites disclosed per the no-weakening rule: `provider-failure` and
`retry-visible` moved from bare `[fail]` to `[fail: 503 service
unavailable]` because Task 30 gave the default `[fail]` sentence (a 429)
an eight-retry budget, which would turn those tests into minutes-long
runs. Their meaning — visible failure with the provider's words; strict
signal counts — is unchanged, and the generous class gained dedicated
tests that measure it directly.

## 5. Verification

Each suite alone, sequentially. New-behaviour tests were broken-and-
confirmed-failing: mutating the transport budget to 5 failed two unit
tests; mutating the rate-limit budget to 3 failed the class-change
integration test on the wire (`expected [3, 3] to deeply equal [3, 8]`) —
which doubles as end-to-end proof the injected policy reaches the bundle.
Both restored and re-run green.

```
STUDIO:            pnpm test      -> 214 passed (baseline 214)
                   pnpm typecheck -> clean
STUDIO/src-tauri:  cargo test     -> 64 passed (baseline 64)
                   cargo clippy --all-targets -> 0 warnings
STUDIO HARNESS:    pnpm test      -> 1311 passed / 25 skipped, 86 files
                                     run + 1 skipped (baseline 1291 / 25)
```

First full HARNESS run had one failure: `mcp-flue.test.ts` timed out at
its 60 s limit under full-suite load; alone it passes in 33 s, and the
clean rerun above is all green. Pre-existing marginality, aggravated by
this task adding ~2.5 minutes of suite time — named in §7, not fixed here.

## 6. Where this brief was wrong, or silent

1. **"Reuse `getBackoffDelay`" hid an observable behaviour change.** The
   shared mechanism jitters fully (`random × ceiling`); Flue's shipped loop
   jittered top-heavy (`(0.75 + r·0.25) × ceiling`). Full jitter broke
   Task 29's monotonicity assertion — attempt two's *sample* can be smaller
   than attempt one's — and on a wire people read, a countdown that shrinks
   mid-failure reads as chaos. Fixed by shipping the distribution as the
   random source (`topHeavyRandom`), leaving the shared arithmetic and its
   twelve tests untouched. The brief told me to reuse the function; nobody
   could have seen from it that the timing personality would change.
2. **The zero-budget adversarial case cannot be exercised through our
   table, because pi-ai owns zero.** Billing sentences are refused before
   any budget question is asked, so the policy's contract supports zero and
   the patch honours it, but the only honest end-to-end zero is the quota
   wire — now asserted to carry no signal at all. The brief's phrasing
   ("a budget of zero") suggested our table would have such a row; giving
   it one would have meant re-opening Task 27's delegation.
3. **The resume case is subtler than "re-derived rather than restarted".**
   The resumed process does not merely count correctly — it re-runs the
   retry decision itself and re-announces the same attempt number, and the
   resumed turn receives the *remaining* budget, not a fresh one. My first
   assertion guessed the wrong wire shape and failed against reality; the
   shipped test pins the observed semantics, including exhaustion-after-
   resume, which is the part that would catch a refilled budget.
4. **The brief's table is wrong in its first row, as it feared** — see
   Part 0. The report is the correction; the row stays unbuilt rather than
   pretending.
5. **Nit carried from Task 29:** baseline file counts. "1291 passed /
   25 skipped" re-measured exactly; the vitest tally is now 87 entries
   (86 run + 1 environment-skipped).

## 7. Out-of-scope findings, named and not fixed

- **The `onResponse` seam** is the only real door to Retry-After, and it is
  provider-gated and success-gated. If row 1 ever matters, the work order
  is: providers report failure headers, Flue persists structured error
  facts, resume-safe association. Three patches, one schema change.
- **Codex embeds `Try again in ~N min.` in quota prose** — parseable, and
  wrong to parse: non-retryable class, minute granularity, sentence-bound.
- **`mcp-flue.test.ts`'s 60 s timeout is marginal under full-suite load**
  (33 s alone). Either its budget or the suite's parallelism deserves a
  look; this task's added runtime made the margin visible.
- **A stale `pnpm patch` edit directory** existed under
  `node_modules/.pnpm_patches` at session start. I verified it matched the
  committed patch state (all three Task-29 hunks present) and reused it;
  a future task should know `patch-commit` will happily commit whatever is
  lying there.

## 8. Process disclosures

- All source edits were made by hand, one edit at a time. Two exceptions
  that are not source edits but are disclosed anyway: the reachability
  probe backed up and restored a *generated* file under `node_modules`
  via shell copy, and the patch itself was committed with `pnpm
  patch-commit` — the official flow, which regenerates the diff artifact
  from hand-edited working files. Writing unified-diff hunks by hand over
  hash-named bundles is how silent rot happens; the content of every hunk
  was authored in the editor.
- `rules.md` §10 vs this brief's documentation orders: followed the brief,
  as Task 29 did, and flagging it again here.

## 9. Branch

Working tree on `main`; no commits made.
