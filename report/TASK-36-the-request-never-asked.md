# TASK 36 — The request never asked

On request. Two instructions, in order: find out why a reasoning model shows no
reasoning and fix it, deciding for myself rather than reporting back; then make
the transcript's claim about what the model is doing true at the moment it
makes it.

Everything with a number in it was measured — against the real providers for
the harness half, and in a real browser against the running app for the layout
half.

---

## 1. The finding: one line, and it was ours

`LocalModelProviderAdapter.stream()` called Pi's `models.stream()` where it had
to call `models.streamSimple()`.

The two take different option shapes, and the difference is the whole defect:

- **`streamSimple`** takes protocol-INDEPENDENT options — `{ reasoning:
  "medium" }` — and translates them per provider. Google's adapter turns them
  into `thinkingConfig.includeThoughts: true`; the OpenAI-compatible adapter
  turns them into `reasoning_effort`; OpenRouter's branch into `reasoning: {
  effort }`.
- **`stream`** takes options ALREADY in the target's native protocol, and
  ignores anything it does not recognise.

Flue hands the adapter the simple shape. It went to `stream`, which dropped
`reasoning` on the floor. **The outgoing request never asked for a reasoning
trace, on any provider.**

TypeScript could not catch it. Both option types are all-optional, so the extra
property passes structurally — and this is a variable, not an object literal, so
excess-property checking never applies.

The models were reasoning the whole time. Google billed the tokens for it:

```
"usage":{"input":4496,"output":766,"reasoning":229,...}
```

229 reasoning tokens, and zero thought text, on a turn that showed the user
nothing. Pi maps `thoughtsTokenCount` into `usage.reasoning` whether or not any
thought PART is returned, which is why the accounting looked healthy while the
screen stayed empty — and why this took so long to find.

### Why the earlier guess was wrong

TASK-35 §5a proposed that the harness never set `thinkingLevel`. It was a
reasonable read and it was wrong: Flue defaults `thinkingLevel` to `"medium"`
when an agent does not set one, pi-agent-core maps that to `reasoning:
"medium"`, and the option arrived correctly at our adapter. Setting
`thinkingLevel` explicitly — tried during TASK-35 and reverted — changed
nothing, which was the clue that the break was below it, not above.

## 2. Verified against the real providers

Driven through the exact fixed line, one turn each, with the same prompt:

```
google/gemini-3.5-flash          api=google-generative-ai
  thinking_start:1 thinking_delta:1 thinking_end:1   reasoning=178 tokens
  315 chars of trace

openrouter/google/gemma-4-31b-it:free   api=openai-completions
  thinking_start:1 thinking_delta:5 thinking_end:1   reasoning=109 tokens
  312 chars of trace
```

Both produced **zero** before. Note the delta counts: Google delivers its whole
thought summary in ONE delta, OpenRouter's gemma streams five. That difference
decides what section 4 can honestly show.

Confirmed live in the desktop app afterwards — the journal now carries
`assistant_reasoning_started / _delta / _completed` on Gemini turns, which it
never had in any previous session.

### The architecture question, answered with data

Asked whether Studio was wrongly speaking OpenAI's protocol to Google. It was
not: `google/gemini-3.5-flash` resolves to `api=google-generative-ai` and gets
Google's native protocol, while only the `openrouter/*` models use
`openai-completions`. Pi was doing exactly the job it exists for. The
translation step just was not being entered.

## 3. The regression test

`tests/integration/local-byok.test.ts` drives the adapter against a mock
OpenAI-compatible server and asserts on the WIRE:

```ts
expect(mock.requests[0]?.body?.reasoning_effort).toBe('medium')
```

On the wire deliberately, not on the reply. Calling `stream` type-checks and
streams a perfectly good answer — the only evidence of the bug is what is
missing from the request.

Mutation: the bug was put back, and the test failed with `expected undefined to
be 'medium'`.

One thing the test had to work around, worth recording: a custom provider's
models are declared `reasoning: false` in `runtime.ts`, because the harness
cannot verify the claim for a user-declared endpoint. Every reasoning branch in
Pi's OpenAI adapter is gated on `model.reasoning`, so the test overrides that
one flag on the target. **Custom providers therefore cannot request reasoning
at all today.** That is a real gap and it is not this task's.

## 4. The transcript says only what is true when it says it

With traces arriving, the two-stage row from TASK-35 could finally be reached —
and its first stage stopped being defensible.

The instruction was to design this properly rather than take an option off a
list, and the principle given was: **if it is thinking when it starts, say so
then; if it is not, do not say it.**

| when | what shows |
|---|---|
| sent, nothing back yet | **nothing in the transcript** — the ring on the send control |
| a reasoning run opens | **"Thinking"**, counting from that moment |
| the run ends | **"Thought for 3s"**, openable |
| the model never reasons | nothing, then the answer |

`working` is gone entirely. Every place it appeared meant "a turn is running
and I have nothing to show you", and the ring on the send control says exactly
that, at the reader's own hand, from the instant they send. A second indicator
saying the same thing in vaguer words, sitting in the transcript where content
goes, is one indicator too many. That was the contradiction the instruction
identified, and removing the row is what resolves it.

### The consequence, stated plainly again

On Google the whole trace lands in one delta ~320ms before the answer, where
the wait was three seconds. So the transcript is empty for three seconds and
then a row appears saying "Thought" with no number. That is honest — a trace
seen once is not a span, and the alternative is charging the model for a wait
nobody watched it spend. On a provider that streams reasoning the counter
genuinely runs.

### Removed with it

The `working` row was the only consumer of a mechanism built for it in TASK-34:
the submission-receipt anchor (`admitted` on the projection), the assistant
item's `startedAt`, and `waitBeganAt`. All three are gone. Leaving them wired
to nothing would tell the next reader the row still counts from the receipt.

The label cross-fade went too. It existed to soften `working` becoming
`thinking`; with one claim left, the only change is "Thinking for 7s" becoming
"Thought for 7s", and fading between two strings that differ by a tense is a
flicker. The mark stops rippling at that moment, which is the beat the
transition was for.

## 5. The composer's stop control

Reported as: the ring does not feel like an outline of the circle, and the
square is not centred in it.

Measured in a real browser against the running app. The square was centred to
the pixel — `offsetX: 0, offsetY: 0` — so the second half of the report was
about something else, and the numbers said what:

| | size |
|---|---|
| the button (`--control-md`) | 22.06px |
| every other mark at `size="md"` | 14.78px |
| **the stop mark** | **10.39px** |
| the ring | 18.27px |

`<Icons.stop />` had been written with no `size`, so it fell back to the
text-relative step and painted two thirds the size of the arrow it replaced. A
mark can be centred to the pixel and still look wrong if it is the wrong size
for what it sits in.

The ring compounded it by measuring itself from the GLYPH — 10.4px of icon plus
5px of inset, landing at 18px inside a 22px control. It traced neither the mark
nor the button, and an arc matching no edge on screen reads as a loose ring
rather than as the control's outline.

Three changes:

1. `<Icons.stop size="md" />`, like every other mark in the row.
2. `IconButton` is now `relative`, so anything a caller overlays traces the
   CONTROL.
3. The ring is a stroked SVG circle positioned against the button. A border arc
   on a rounded box is drawn by the box model: mitre-cut ends, and at this
   diameter a visible rounded-rectangle curve pretending to be a circle. A
   stroked circle has neither problem. `pathLength={100}` normalises the
   circumference so the dash is a plain percentage, round caps give the arc
   proper ends, and `vector-effect: non-scaling-stroke` holds the line at
   ~1.4px at every `--ui-size`, the way the icon set holds its own weight.

The ring went just INSIDE the rim first, on the reasoning that a ring tracing
the edge reads as the button's own outline. Reported back as still wrong, and
the report was right: inside the rim the arc shares space with the mark,
crowding a glyph that is centred to the pixel into looking off-centre, and the
control ends up with something drawn ON it rather than around it. It now hangs
3px outside the button as a halo — measured clearing the rim by ~5% of the
button's diameter on every side, with 76px and 349px of slack to the nearest
clipping ancestor, so nothing cuts it.

The square itself was never off-centre. Measured `offsetX: 0, offsetY: 0`
twice, and Lucide's `Square` is `rect x=3 y=3 w=18 h=18` in a 24 viewBox —
symmetric by construction. What moved was the thing crowding it.

### The same bug, twelve more times

Auditing every icon-only button found the defect was not local. Thirteen call
sites passed no `size` to a mark standing alone in a round control, so it took
the text step instead of the control step. Measured on the running app,
identical 27.58px buttons were carrying marks of **12.99px or 14.78px**
depending on whether the call site remembered — a 14% difference between
neighbours in the same strip.

All thirteen now pass the size their button is. Re-audited: zero remaining. In
the browser, every 27.6px button now holds a 14.8px mark.

## 5b. The composer field's churn on the second line

Reported as: the field flashes hard once the text passes the first line.

`ComposerField` measured the very element it was animating. To learn the
content height it suspended the height transition, set `height: auto`, read
`scrollHeight`, wrote a height back, forced a reflow, re-enabled the transition
and wrote the target — and to answer the wrap question it also borrowed the
element's WIDTH, mutating the animating element a second time for a value that
has nothing to do with what is on screen. All of it ran on every keystroke.

Measured: **384 style writes on the textarea for 84 keystrokes**, ~4.5 per
keystroke, each one cancelling the in-flight height transition and starting a
new one from wherever it had reached. With `DURATION.slow` at 0.26s and
keystrokes arriving every ~120ms, a growth animation never got half way before
being restarted.

The fix is to stop measuring the animating element. `measure()` builds a
shallow clone — same classes, so same font, padding and border box; same
parent, so same inherited everything — sets it to the width in question, reads
`scrollHeight`, and removes it. A fresh element with `height: auto` reports the
content height directly, so the reset the old code needed does not exist. The
live element is then written to **only when the target actually moves**, guarded
by a `committed` ref.

After: **3 style writes for 120 keystrokes**, down from ~4.5 per keystroke to
0.03.

A second bug fell out of the same read. The remembered capsule width was
recorded as `clientWidth` but applied as a border-box `width`. `clientWidth`
excludes the reserved scrollbar gutter and includes the padding, so the wrap
question was being asked at a width about 20px narrower than the capsule really
offers — while the capsule direction asked it at the true width. The two
directions were decided against different widths, which is precisely the
oscillation the mechanism was built to prevent. Both now use the border-box
width.

### A measurement that was wrong, and how

Mid-investigation I recorded that the field's rendered height never reached its
inline target — 56px inline, 18px painted — and read it as proof of the defect.
It was not. The Browser pane was not compositing frames, so `document.timeline`
was frozen: every CSS transition on the page sat at `currentTime: 0` with
`playState: "running"`, and a stuck route transition was holding the whole app
at `scale(0.985)`, which is also why raw pixel figures drifted between readings.

The style-write counts are unaffected by any of that — mutation records do not
need a compositor — and the width bug is arithmetic. Those stand. The "height
never arrives" claim did not, and the smoothness of the result has to be judged
in the real app rather than here.

No unit test accompanies this one: jsdom has no layout, so `scrollHeight` is
always 0 and any assertion about measured heights would pass without exercising
anything. Verified by instrumented measurement in a real browser instead.

## 6. Verification

- Frontend: 293 tests, typecheck clean.
- Harness: 1287 pass. The 29 failures are four AppContainer/sandbox files that
  need the one-time administrator `sandbox:prepare`; identical before and after
  this change and untouched by it.
- Mutations, both halves:
  - the adapter's `streamSimple` reverted to `stream` — the new wire test
    failed on the dropped `reasoning`;
  - the `working` row restored — all five of the new absence tests failed.
    Worth doing precisely because they assert absence, which is the kind of
    test that passes vacuously.
- Layout measured in a real browser, before and after, numbers in section 5.

## 7. Not done

- **Custom providers cannot request reasoning.** Section 3. `runtime.ts`
  hard-codes `reasoning: false` for user-declared endpoints, which is honest
  about what the harness can verify and also means an Ollama or LiteLLM model
  that reasons will never be asked to.
- **Lowering Flue's coalescing window** so Google's single-delta trace arrives
  in pieces. It is the one change that would make the counter meaningful on
  that provider. Its own task, with its own measurement.
- **Model selection bound to a stale bundled registry.** TASK-35 section 4.
- **The supervisor's startup honesty.** TASK-34 section 3.
