# Interactive voice and computer use: what was built, and what is still unproven

*Seven stages, committed to `main` from `4549ef3` to the Stage 7 commit. The
plan is `documentation/work/voice-computer-interaction-plan.md`, the decision
is [ADR 0059](../documentation/decisions/0059-the-desktop-has-one-hand.md), and
the running record is the "Interactive voice and computer use" section of
`documentation/work/studio-observability-progress.md`. Everything here was built
and tested in a Linux container with no Windows desktop, no microphone, no
display and no provider key, so the last section matters as much as the first.*

## What changed for the person

- **Voice is a conversation about the screen, not a dispatcher.** The voice agent looks
  at a shared screen itself and does small things there. It sends only sustained work
  to a background task.
- **Share screen is the person's switch.** It is off at the start of every call, off
  again at the end, and never turned on by Studio.
- **The agent follows the person between pictures.** It learns where the pointer
  rested, when the person crossed to another display, which window came forward, and
  that they clicked, typed or drew. It gets these as a short event list each turn,
  not as video.
  - A picture of the display the person is pointing at is taken as their speech ends.
  - "Did you see this?" after moving to the second monitor therefore has a fresh
    picture of the right display, plus the rest event saying where "this" is.
- **Pointing goes both ways on the real screen.** The agent can show a point, ring,
  box or arrow with a label.
  - Show me holds the agent back and puts a pen on the screen.
  - The person's ink is sent to the agent as shapes, and it appears in the next
    picture.
- **One hand on the desktop.** The voice agent, its tasks and the person never send
  input at the same time.
  - Pause, Show me, Resume and Stop are buttons, and a short list of exact spoken
    phrases, with no model between the person and the result.
  - A correction to a task at the desktop stops the rest of its batch.
- **The agent knows what was heard.** After the person interrupts, the next turn
  carries the part of the reply they actually heard.
- **Voice tasks can use their own model.** `continue` carries a finished task's result
  into a new run.

## Stages

| Stage | Commit | What it did |
|---|---|---|
| 1 | `4549ef3` | The plan, two latency measurements (end of speech to transcript, end of utterance to first audio), the baselines |
| 2 | `4297ee2` | The per-actor desktop lease: ownership, generation fencing, refusal of calls queued before a loss, "observe first", pause, show me, resume, takeover from a pause, stopping, release on settlement, the person's control route |
| 3 | `467e224` | Screen sharing, the voice agent's short tool list and batch cap, the pointer sampled with each picture, one shared latest picture per conversation, the turn-start `interaction_context` signal |
| 4 | `d79dbdf` | The voice prompt, the capability overview and the Studio prompt teach the lease, freshness and bounded action |
| 5 | `23c2d62` | The screen watch, the glance at end of speech, `studio_computer_mark`, the native overlay, Show me drawing, the call's Share screen and Show me buttons |
| 6 | `8942bcd` | Voice-task model, `continue`, redirect checkpoint, `heard_before_interrupt`, the spoken-command matcher, Stop talking, Pause/Stop computer, four stop outcomes |
| 7 | this commit | Full checks, ADR 0059, observability contract, retry map, README map, this report |

## Departures from the plan, and why

- **The person draws on the live screen, not on a still picture inside Studio.**
  The plan's D7 said otherwise. The person asked for drawing directly on the screen.
  - The overlay is not hidden from screen capture, so the agent sees the ink in its
    next picture.
  - The agent's own marks are drawn by the same overlay, not by a C# window in the
    driver. That keeps one renderer in the app's own UI stack.
- **Agent marks are drawn by the client, read from the transcript.** This is how the
  computer pill already works. Tasks are refused marks, because their calls are not in
  the transcript the overlay reads.
- **"Stop <Name>" is not a spoken command.** The matcher would need task names. The
  model already handles it through `voice_work cancel`.
- **Closing a call needed no new lease release.** The voice turn's settlement
  already releases its actor.
- **Voice Stop computer does not cancel tasks.** The chat page's Stop and the
  desktop pill still do. Tasks learn of a stop through their next refused call.
- **`api-inventory.md` was not extended.** It declares itself a dated photograph and
  names `create-app.ts` as the living truth.
- **The opt-in routing eval (`tests/eval/voice-routing.ts`) was not written.** It
  needs a provider key and cannot run here.

## What each person-facing event leads to

The plan asked for one row per scenario, covering:
- **Admitted:** whether the request was admitted.
- **Maybe sent:** whether input may have reached the driver.
- **Owner after:** who owns the desktop afterwards.
- **Cleanup:** what was released or closed.
- **Evidence still valid:** which pictures and references can still be trusted.
- **Agent told:** what the agent hears about it.
- **Continuation:** what happens next.

| Scenario | Admitted | Maybe sent | Owner after | Cleanup | Evidence still valid | Agent told | Continuation |
|---|---|---|---|---|---|---|---|
| Voice agent clicks while a task owns the desktop | refused | no | the task | none | yes | refusal names the task; "never route it through another tool" | waits, steers or asks |
| Person presses Pause mid-batch | yes | the step in flight, at most | paused owner | held keys and buttons released (`released`, `pending`, `failed` or `not_running`) | no: everyone looks again | next call refused `paused`; signal says paused | `control wait`, then look, after Resume |
| Person presses Show me | yes | the step in flight, at most | person (`demonstrating`) | as for Pause; the overlay takes the pointer | no | `demonstrating`; each stroke arrives as a `drew` event | Done resumes; everyone looks again |
| Person says "stop the computer" | yes, before the model | the step in flight, at most | none | driver closed; outcome is one of four | no | `control` attribute says it was done and how | the agent acknowledges; tasks' next calls are refused |
| Correction to a task at the desktop | yes | the step in flight, at most | the task, kept | none | no, for that task | the batch is cut ("a correction from the person arrived"), then the steer arrives | the task looks again and continues |
| Correction to a finished task | refused as a steer | no | unchanged | none | n/a | "carry on with continue" | `continue` starts a new run with the result |
| Person cuts Studio off mid-reply | n/a | n/a | unchanged | speech stopped; the run is aborted if it owned generation | n/a | `heard_before_interrupt` on the next utterance | the agent answers from what was heard |
| Sharing turned off while a picture is taken | the call ran | possibly | unchanged | the picture is dropped | the old shared picture stays | "its picture was discarded; input already sent stays sent" | sharing must be turned on again |
| Person moves to another display and asks "did you see this?" | n/a | no | unchanged | none | the glance at end of speech is current | `display` and `rest` events; latest picture is the glance | the agent opens `latest` and answers |
| A task asks to show a mark | refused | no | unchanged | none | n/a | "marks are for the agent the person is talking with" | the task describes the location in words |
| Pulse fails three times in a row | n/a | no | unchanged | the watch stops | pictures still valid | "live pointer updates are unavailable" | pictures only |

## Verification that ran

- **Full checks, run in sequence:**
  - `CI=true pnpm -C "STUDIO HARNESS" check`: result recorded in the follow-up commit once the run finishes.
  - `CI=true pnpm -C STUDIO check`: result recorded in the follow-up commit once the run finishes.
- **Rust:** `cargo check` and `cargo test` under `STUDIO/src-tauri` were possible after
  installing the GTK and WebKit development packages in the container. 158 of 159
  passed. The one failure is the real OS credential store round trip, which this
  container has no keyring for and which this work does not touch.
- **Mutation checks: 44 of 44 caught.** For each rule, I broke the line, confirmed the
  test failed, and restored it:
  - Stage 2 (lease): A–J.
  - Stage 2 (wiring): K–N.
  - Stage 3: O–V.
  - Stage 4: W.
  - Stage 5: X–AI.
  - Stage 6: AJ–AR.
  - Each one is listed in the progress tracker's stage paragraphs and in the stage
    commits' tests.

## Not verified here, and how to verify it

Everything below needs a Windows machine with a display, a microphone and a provider key.

- **The PowerShell driver's new code has never run:**
  - the `pulse` op;
  - the pointer and front window sampled with each screenshot;
  - `release_held`.
- **The overlay window on a real display:**
  - it covers the right monitor at every DPI scale;
  - clicks pass through while marks show;
  - it takes the pointer only in Show me;
  - it never takes keyboard focus;
  - ink and marks appear in the agent's next picture;
  - two monitors with different scales.
- **The coordinate mapping end to end.** A mark at the place a click would land
  should sit exactly under the pointer.
- **Voice latency with the end-of-speech glance running in parallel with
  transcription.** This uses the Stage 1 measurements `client.voice` `transcribed` and
  `first_audio`.
- **Whether real models use the prompts as intended:**
  - look before answering;
  - prefer pointing when asked "where";
  - open `latest` instead of taking a new picture;
  - honour the `control` and `heard_before_interrupt` attributes.
- **The voice-task model refusal against the live catalog.** The route is tested with a
  stub.

The session that built this ends with a single prompt for running exactly these checks
on a real machine.
