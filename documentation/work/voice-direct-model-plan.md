# Voice: a direct model versus the delegated worker (plan only, 2026-10-21)

This is a comparison and a plan. Nothing here is implemented.

## The question

Would voice work be faster if the voice conversation drove the model, and the
computer, itself (a "direct model") instead of handing work to a `voice-work`
worker? And can a direct model still be interrupted in voice mode?

## What the measurements say

From the recorded runs (`voice_fce0afd3`, `voice_54599a5c`):

- About 60s of a 117s task was two screenshots waiting out the 30s MCP
  timeout. That is fixed on this branch: oversize answers fail at once, and
  screenshots stay under 1 MB. It was never the delegation's fault.
- Each worker model turn took 44-60s. `voice-work` uses `model: { inherit: true }`,
  so it runs on the conversation's chosen model, often a slow reasoning model.
- The worker reports back in under 2s once it finishes (finished signal 23ms
  after settling, answered in 1.5s). Delegation itself costs a few seconds per
  task at most.

So the slowness is the model the worker runs on, not the hop to the worker.
A direct model only gets faster if it is also a *faster model*, and the same
gain is available without giving up delegation.

## Comparison

| | Direct model (voice agent drives the computer) | Delegated worker on a fast model |
|---|---|---|
| Time per computer step | Fast model: a few seconds | Same: a few seconds |
| Time to first spoken reply | Slower: every turn carries tools and screenshots | Unchanged: voice context stays small |
| Barge-in (user talks over it) | Stops the speech **and** the hand; a half-done click sequence is abandoned | Stops only the speech; the worker continues |
| "Stop" / "do something else" | Abort of the current model request; Flue already does this for steering (100ms poll) | `voice_work` cancel or steer, joins at the next tool batch |
| Image limits | Screenshots enter the voice context; the new 20-picture window applies, but every voice turn pays for them | Screenshots stay in the worker; voice never sees them |
| Failure blast radius | A stuck tool call stalls the conversation you are talking to | The worker stalls; voice still answers and can cancel it |
| Contract (no automatic replay) | An interrupted tool batch must not be re-run; needs care | Already holds: workers have `maxAttempts: 1` |

## Can a direct model be interrupted?

Yes. Flue's stream already aborts a running model request when steering is
pending (`emitTurnRequestAndStream` polls every 100ms and aborts with
"Response interrupted by steering"). What cannot be interrupted safely is a
tool that is mid-effect (a drag, typing). The model request can be stopped;
the effect is not undone. With the hand inside the voice agent, every
barge-in such as "uh-huh" or "wait" has to decide whether to stop the hand,
which is the main reason to keep the delegate.

## Recommendation

Keep delegation; make the worker fast.

1. Give `voice-work` its own model policy instead of `inherit`: a fast
   vision-capable model, chosen in settings ("Voice task model"), defaulting to
   the conversation's model when unset. Expected gain: 44-60s turns become
   2-6s turns.
2. Let the voice agent restart a task on the conversation's model when the
   fast one fails or the user asks for "think harder".
3. Push progress: the latest-step line shipped on this branch is the pull
   half. Add a coalesced "progress" signal, at most one every ~5s, that the
   voice agent may speak or ignore, and that never talks over the user.
4. Later, and only read-only: let the voice agent take a single glance
   screenshot to answer "what's on screen?" without starting a task.

## Measuring before and after

Run the same three scripted voice tasks (open a settings page, fill a form,
find a file) on the inherited model and on the fast model. Record from
observability: worker model-turn durations, tool durations, time from
request to first visible action, time to the finished signal. Success means
median model turn under 6s and no task slower end to end.
