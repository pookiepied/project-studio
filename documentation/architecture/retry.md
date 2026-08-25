# Retry: the map, and the rule

**Written:** 2026-08-25, from Task 29. This file is the map the rule needs: a
contributor asking "does this retry, and how many times?" reads one table
instead of grepping nine files. It is corrected against the code as it stands
after Task 29 landed; where the working table this document was written from
was wrong, the correction is recorded here rather than quietly absorbed.

## The rule

> **At most one retry authority per axis, and a layer that does not own the
> axis surfaces the failure instead of inventing its own loop.**

Two layers already reasoned this out independently before the rule existed,
which is the evidence it was distilled from rather than invented:

- `STUDIO/src/platform/harness/client.ts`: *"Never retried, here or above: an
  identical resend is a SECOND TURN (the harness pins this behaviour in its
  own test), so a retry loop against a dead loopback port only delays the
  truth."*
- `STUDIO/src/platform/harness/conversation.ts`: *"a failed submission is
  surfaced, not repeated"* — because *"a retry loop would be duplication
  wearing a retry's clothes."*

The mechanism side is shared and the policy side is not: `getBackoffDelay`
(`STUDIO HARNESS/src/reliability/backoff.ts`) is the one attempt-to-delay
function, pure and random-injectable, and every caller that owns an axis
passes its own options. Four hand-rolled copies of that arithmetic would be
duplication, not diversity. One global retry count, on the other hand, would
be genuinely wrong — a billing exhaustion deserves zero retries and a 429
without `Retry-After` deserves several — which is why the rule fixes the
*shape* (one authority per axis, shared mechanism, local policy) and not a
number.

## The map

| # | Axis and owner | Budget and shape | Mechanism | Visible to the person waiting? |
|---|---|---|---|---|
| 1 | Transient model errors — Flue runtime (patched) | 3 retries, base 2s doubling, jittered ×(0.75–1.0) | private to `@flue/runtime` bundle | **Yes, since Task 29**: each scheduled retry appends a `submission_retry_scheduled` record, projected as a `submission-retrying` chunk; Studio renders the wait with the provider's sentence. Before that it was a log line only |
| 2 | Context overflow — Flue runtime | compact once, then retry the turn once | private (`runModelTurnWithRecovery`'s `overflowRecoveryAttempted`) | No — the compaction emits an internal run event, nothing on the conversation wire; the person sees a pause |
| 3 | Submission durability — `src/agents/studio.ts` | `durability.maxAttempts: 3`, `timeoutMs: 300_000`; attempts across process resets | Flue's submission machinery | Partly: a lost or crashed attempt settles visibly (failed/aborted with a sentence) on recovery; the counting itself is invisible |
| 4 | MCP server start — `extend/mcp/supervisor.ts` | 5 attempts, 1s ×2 capped at 30s, full jitter, then give up | `getBackoffDelay` (shared module since Task 29) | Give-up yes (server reads not-connected); the five waits in between are log lines |
| 5 | Harness child process — `src-tauri/.../supervisor.rs` | deliberate, not exponential: at most one restart per 60s `RESTART_WINDOW` | Rust supervisor | Yes — Task 23's lifecycle events (`harness-restarting`) reach the conversation state machine |
| 6 | Harness HTTP requests — `platform/harness/client.ts` | none, on purpose; 12s timeout | — | Yes — refusal or timeout surfaces immediately with its own sentence |
| 7 | Conversation stream reads — `platform/harness/conversation.ts` | none; resume by offset instead | durable-stream offsets | Yes — a break renders `interrupted` and resuming replays exactly what was missed |
| 8 | Outbound HTTP — `src/net/http.ts` | none; every call carries a ceiling and a deadline | — | Yes — errors surface through tool results. Note: failures are *classified* `retryable` or not, but no caller loops on the flag; treat any future loop as a new authority under this rule |
| 9 | Test-harness startup — `tests/integration/harness.test.ts` (Task 28) | one replacement for a wedged silent child, only while over half the startup budget remains | test-local | n/a — test infrastructure |

Corrections the code forced on the working version of this table:

- Row 1 says **three retries**, which is four model calls in total;
  `MAX_TRANSIENT_MODEL_RETRIES = 3` counts retries, while row 3's
  `maxAttempts: 3` counts total attempts. That asymmetry is exactly why a
  contributor cannot carry a number between axes.
- Row 8 was listed as having no retryable notion at all; in fact `http.ts`
  classifies its errors with a `retryable` flag even though nothing consumes
  it as a loop. The classification is fine — the flag is a fact about the
  error kind — but a reader deserves to know it exists before adding the
  second `retryable` consumer.
- Row 9's "shares one budget" is sharper than it sounds: the replacement
  attempt is granted only while more than half the startup silence budget
  remains, so a wedged machine costs one dead child, never a second.

## Visibility is the permission to be generous

The coupling this whole file exists to serve:

> A retry budget may only be lengthened once the retry is visible. Invisible
> retry must stay short, because every second of it is indistinguishable
> from a hang.

Row 1 is the worked example. Three retries and roughly fourteen seconds were
defensible *because they were silent*; making them visible (Task 29) is what
earns the right to revisit the budget, and not before. Rows 5 and 9 are the
shape to copy when generosity is warranted: bounded, announced, and ending
in something a person can act on.

Full reasoning lives in `reliability-and-the-silent-stop.md`; this file is
the map, not the argument.

## A protocol note the next wire change needs

Extending the chunk protocol has a compatibility cost on the other side of
the wire: `@flue/sdk`'s stream reader validates chunk types against a fixed
set and **throws on unknown types by design**, so an SDK-based client built
before `submission-retrying` fails loudly mid-turn. Studio's own webview
parser deliberately takes the opposite posture — an unknown chunk survives
as a positioned identity fact (`conversation-chunks.ts`) — so the shipped
client is unaffected. When a chunk type is added again, either teach the SDK
in the same change or record here, as this paragraph does, which clients
will refuse the new bytes.
