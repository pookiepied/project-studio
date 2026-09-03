# TASK 35 — Working is not thinking

On request. The instruction was: find out what the seconds-long gap before a
reply actually IS before changing anything, because an avoidable cost and an
unavoidable one call for different answers. Then, given the answer, make the
timing honest and the wait legible.

Everything with a number in it was measured on the running desktop app.

---

## 1. The diagnosis: the gap is the provider's

The claim under test was that Studio spends three to five seconds doing
something — starting a process, building an agent — before the request goes out.
The evidence for it was sharp: the reasoning row appeared instantly and counted,
but could not be opened for several seconds, which means no trace existed yet.

It is not us. The harness process was sampled alongside a turn for both its
child processes and its outbound connections.

**Brand new conversation, first turn:**

```
      0ms   send
   +275ms   harness opens TLS to the provider (104.18.2.115:443)
  +7864ms   reasoning content first exists
            zero child processes throughout
```

**Follow-up turn in an existing conversation:**

```
      0ms   send
   +335ms   provider connection opens
  +6068ms   reasoning content first exists
  +9609ms   rg.exe spawns   <- a tool call, not startup
```

Three conclusions:

1. **Nothing is spawned per turn.** The one child process in either trace was
   ripgrep, at 9.6s, because the model chose to search.
2. **The request leaves in under 300ms**, and a first turn costs the same as a
   follow-up, so there is no cold-start penalty. Flue does re-run the agent
   initializer for every run — its own documentation says "do not treat it as a
   one-time constructor" — and that initializer does an extension reconcile
   each time. It costs ~275ms, not four seconds.
3. **The rest is the provider's time to first token.**

Our own contribution is bounded at roughly 1.3s: ~300ms of dispatch plus Flue's
`CANONICAL_FLUSH_DELAY_MS = 1000` coalescing window. That constant is tunable —
the harness already patches `@flue/cli` — and lowering it would make reasoning
arrive in smaller batches. It is at most a second of a seven-second wait.

**The duration Studio displays is entirely local.** Nothing on the wire carries
provider timing: no reasoning start, no per-segment stamps. Every number the UI
has ever shown was measured in the webview.

## 2. What that licenses the UI to say

Two facts decided the design, and the second is the one that matters.

**Reasoning does not stream in.** On the reasoning model measured, the trace
became available at 7864ms and the answer began at 8977ms — about one second
apart. The trace's own first and last arrival timestamps are the same instant.
It arrives at the END of the wait, essentially whole.

**Some models never reason at all.** On the free model now configured, a turn
went: row at 125ms, answer streaming from 2824ms, no reasoning trace ever. The
app said "Thinking" for 2.8 seconds about a model that does not think, with an
inert disclosure control beside it because there was nothing to disclose.

So the row was making a claim the app could not support, and the duration it
showed was mostly provider latency wearing the model's name.

## 3. The change: two stages, two claims

`ThinkingBlock` now has a `stage`.

**`working`** — the turn is admitted and the model has produced nothing. Says
"Working", then "Working for 3s" once there is a whole second to report. Counts,
because the wait is real and a blank column with no sign of progress was the
original complaint, but names what it counts. No past tense: a wait that ended
is not worth a line once the reply is on screen. Not a control — nothing to
open, so no tab stop and no chevron.

**`thinking`** — a reasoning run exists. Its clock measures the reasoning's own
span, first delta to last, and nothing in front of it.

The words cross-fade **keyed on the stage, not on the label**. Keying on the
label re-ran the animation on every tick, which is a number that flickers rather
than counts — caught by a test failing for the right reason after the change.

The composer's stop control now carries a ring while a turn is in flight. It is
still the stop control: a spinner that replaced it would remove the only way to
call a turn back. Indeterminate, because nothing here knows how long the model
will take, and a bar that filled would be inventing a fraction of a duration
nobody measured.

### The consequence, stated plainly

On a provider that emits its whole reasoning trace at once, the honest reasoning
span is a fraction of a second — so the row will say "Thought" with no number
while `working` counted eight. That is not the measurement being lost. It is two
different quantities, only one of which is about the model. The alternative is
the thing that was just removed: calling the provider's latency the model's
thinking.

## 4. Found along the way

- **The Start-the-harness control works on a real failure.** The eager start
  genuinely timed out on one launch. The notice appeared, the button was there,
  the old "status bar" copy was gone, and clicking it brought the harness up.
  Verified twice more via `restart_harness` when switching models.
- **The model registry is stale, and that is a real gap.** `minimax/minimax-m3:free`
  is live and free on OpenRouter right now, and cannot be selected, because
  `select` validates against Pi's bundled registry which does not list it. Of
  the 16 free models the registry DOES know, checked against OpenRouter's live
  catalogue: **8 are gone**, one has become paid, and one is blocked by an
  account data-policy setting. OpenRouter is a gateway whose catalogue turns
  over weekly; a bundled list cannot track it. Studio cannot use any model
  newer than its own dependency.
- **The configured model had been retired upstream mid-session**, failing every
  turn with a 404. Switched via the supported path (`pnpm providers select`) to
  `openrouter/google/gemma-4-31b-it:free`, which is live, free, and working.

## 5. Verification

- 300 tests pass; typecheck clean.
- Four mutations applied and reverted: `working` claiming "Thinking" (4 tests
  failed), the reasoning span re-anchored to the receipt (3 failed), the
  single-batch rule removed (1 failed), and the crossfade key — which was not a
  mutation but a real bug the tests caught.
- Live turns driven end to end. Final trace:

```
    10ms  stop=true ring=1          <- loading ring on the stop control
   142ms  row="Working"@644
   509ms  row="Working"@612
  1124ms  row="Working for 1s"@612  <- counting, honestly named
  1756ms  row gone, answer streaming
  1879ms  stop=false ring=0         <- settled
```

## 5a. Why the thinking stage was never reached — SOLVED, see TASK-36

Four models were tried across three providers while verifying this work, and
**not one produced a reasoning trace**:

| model | outcome |
|---|---|
| `openrouter/cohere/north-mini-code:free` | works; goes straight to tools, no trace |
| `openrouter/google/gemma-4-31b-it:free` | works; plain text, no trace |
| `openrouter/nvidia/*-reasoning:free`, `poolside/laguna-xs-2.1:free` | 404, account data-policy setting |
| `google/gemini-3.5-flash` | works; 5s wait then the whole answer, no trace |

Four for four pointed at us rather than at them, and it was us. The cause was
one line in `src/models/adapters/local-adapter.ts`, and this section's original
guess at it — that the agent never set `thinkingLevel` — was wrong. Flue
defaults that to `"medium"` and the request was asking for reasoning all along;
the option was being dropped one layer lower. TASK-36 has the finding.

The consequence for THIS task is that its central design decision was taken
against a broken system: every measurement here of "the thinking stage" was
taken on turns that could not produce a trace. See section 7.

Also observed once and not chased: Gemini 3.5 Flash returned its whole 594-char
answer in a single delivery rather than streaming, where gemma streamed smoothly
at ~200 chars/second through the same path.

## 6. Not done

- **Lowering the coalescing window** so reasoning streams instead of landing
  whole. Would make the `thinking` span meaningful on reasoning models, at the
  cost of more durable writes. Its own change, with its own measurement.
- **Model selection that is not bound to a bundled registry.** Section 4.
- **The supervisor's startup honesty** — still hides its own failures three
  ways; see TASK-34 section 3.

## 7. Superseded

**The `working` stage described in section 3 no longer exists.** It was removed
in TASK-36, and the reasoning is worth keeping next to the reasoning that
introduced it, because only one of the two was arrived at with a working
system.

This task designed the two-stage row while no model in the app could emit a
reasoning trace. Under that constraint `working` was the honest answer: the
app genuinely could not tell whether anything was thinking, so a row that
counted the wait and named it as a wait was the most it could say. That was
correct given what was known, and the measurements behind it stand.

Once traces actually arrived, the second stage could be reached, and the first
one stopped earning its place. The objection that retired it: a turn being in
flight is already said by the ring on the send control, at the reader's own
hand, from the instant they send. `working` said the same thing again, in
vaguer words, in the transcript where content goes. Two indicators for one
fact.

What replaced it is narrower and is in TASK-36: the transcript draws nothing
until the model produces something, and the row appears at the first reasoning
delta, counting from there.
