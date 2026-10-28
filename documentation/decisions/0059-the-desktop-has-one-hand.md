# 0059 — The Desktop Has One Hand

**Status:** Accepted
**Date:** 2026-10-28
**Builds on:** [ADR 0055](0055-the-desktop-is-driven-by-what-windows-already-has.md)
(the computer server and its driver), [ADR
0058](0058-agent-definitions-and-delegation.md) (delegates share their
starter's instance, so the instance id names an agent), [ADR
0012](0012-permission-and-containment.md) (the kernel decides, per call).
**Plan and record:** `documentation/work/voice-computer-interaction-plan.md`;
`report/voice-computer-interaction.md`.

## Context

Voice mode sent every look at the screen to a background task. A task took
seconds to start and minutes to answer, so "what is this?" in a call felt
like talking to someone in another room. Letting the voice agent look and act
itself raised the question the per-conversation lock of ADR 0055 could not
answer: within one conversation the voice agent, its tasks and the person all
want the same mouse, and nothing said which of them had it, how it changed
hands, or how the person took it back.

Between pictures the agent was blind. A person who moved to their second
monitor and said "did you see this?" was asking about a screen the agent had
never seen, and the agent had no way to know it had moved. And there was no
way to point: words are bad at "this one".

## Decision

**1. One hand, held per actor.** The desktop is a lease held by one actor at
a time: the conversation's own agent, one of its tasks, or another
conversation. The actor is the Flue instance id the harness puts in a system
server's `_meta`, never a model argument. Looking is open to every actor;
input is the owner's. A call queued before its actor lost the desktop is
refused even if the actor gets it back. The owner's batches are rechecked
before every driver request, so a change of hands stops a batch between
steps, not after it. After any change that may have moved the screen, every
actor looks before input. Holding the lease is coordination, never
permission: each action is still approved by the kernel.

**2. The person's hands bypass the model.** Pause, show me, resume and stop
are buttons and, for a strict whole-utterance grammar of final transcripts
only, spoken commands. They reach the lease through admitted routes and a
private RPC with no model between. A spoken command still reaches the agent,
marked with what Studio already did, so the agent acknowledges it instead of
doing it again. A stop reports one of four outcomes and no surface calls an
unconfirmed one stopped. A correction to a task at the desktop checkpoints
it: the rest of its batch is refused at the next step and it looks again,
keeping the desktop.

**3. Sharing is the person's switch.** The voice agent sees and acts only
while the person shares the screen in the call. It is off when a call starts,
off again when it ends, kept in process memory only, and never turned on by
Studio. The voice agent holds a short tool list - looking, pointing, the lease
and bounded actions; batches of at most six steps - enforced by both the
harness's tool list and the server, from one table.

**4. Between pictures, events - not video.** While sharing is on, the server
samples the pointer, the front window and the person's input counts twice a
second and folds them into a short, expiring list: where the pointer rested,
when it crossed displays, which window came forward, that the person clicked
or typed, what they drew. Each voice turn starts with one bounded signal of
that state - a snapshot the tool boundary rechecks - not a prompt rewritten per
mouse move. As speech ends, the client asks for a picture of the display the
pointer is on, taken under its own actor so it never counts as the agent's
look before input. Each conversation keeps one shared latest picture, with
who took it, the pointer sampled with it, and why it may be stale.

**5. Pointing goes both ways, on the real screen.** The agent shows marks -
point, ring, box, arrow, with short labels - through one native overlay that
passes every click through and fades them. Show me holds automation back and
turns the same overlay into a drawing surface for the person. Each stroke
reaches the agent as a shape and a box in desktop pixels, never as points.
The overlay is deliberately not hidden from capture: the person's ink and
the agent's marks belong in the next picture. Tasks cannot show marks;
their calls are not in the transcript the overlay reads.

**6. Workers keep their own model.** Voice tasks may run on a model chosen
for them; unset, they use the chat's. A model the catalog says cannot call
tools or see is refused with a sentence. A finished task is never revived:
`continue` starts a new task that carries its result and says it is a new run.

## Options considered

- **Stream frames to a realtime model**, as live screen-sharing assistants
  do. Rejected for this version: Studio's voice agent is a turn-based model
  behind Flue, a frame a second would bury its context and budget, and most
  frames say nothing. The event list plus a picture at the end of speech
  answers "did you see this" at a fraction of the cost.
- **Draw the person's marks on a still picture inside Studio**, the plan's
  first design. Rejected on the person's request and on merit: drawing on the
  live screen is what a person means by "let me show you", and leaving the
  ink on screen makes the next picture carry it exactly.
- **Exclude the overlay from capture.** Rejected: the agent would see a
  screen without the ink the person drew for it.

## Consequences

- One server's lease is not OS-wide arbitration between harness processes.
- Sampling keeps the Windows driver alive while sharing is on; it is skipped
  while a call runs and stops after three failures, which the next turn says.
- The overlay covers one display at a time; marks for another display while
  the person draws are dropped rather than moving the window under the pen.
- Not verified in the build container: the driver, the overlay on a real
  display, and the voice loop end to end. The report names each.
