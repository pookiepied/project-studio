# Studio voice implementation

Branch: `codex/openrouter-voice-mode`. No commit on `main`.

## Implemented path

The microphone remains open across turns with browser echo cancellation and
noise suppression requested. A level-based detector waits for 500 ms of silence
after speech; the transport button can end a turn. Transcription uses the
existing configured media slot. Final text enters the existing Studio stream as
`voice_input`, displayed as a user bubble. The voice role uses its separately
selected language model, minimal reasoning, a short prompt and a bounded trusted
capability overview. Regular text restores the normal Studio role. Replay never
speaks or submits work.

Voice can start from an empty Home or project page. The conversation id is
minted when voice opens, but nothing exists until the first utterance is
admitted: that transcription creates the row and title exactly as a typed first
message would, with the page's settings and project. Voice then reads the stream
from its own receipt, so the first reply is spoken rather than treated as
replayed history. Leaving without speaking creates nothing.

Assistant text is synthesized a phrase at a time, beginning before the language
model finishes. At most one additional synthesis is prefetched while a clip
plays. Interruption closes local playback immediately, drops late clips and
requests cancellation of active conversational generation after pending admission.
It does not cancel a worker. Synthesis already submitted to a provider can finish
and remain billable. Generated text remains canonical history even when it was
not heard; audio is not represented as a fully heard transcript.

Voice coordination offers start, inspect, steer and cancel. A worker uses the
chat's primary model, ordinary tool gate and conversation workspace under a
distinct agent authority. The original transcription is passed verbatim, separate
from preceding context summarized by the voice model. That summary is explicitly
fallible; this is not a complete copy of the parent's canonical history.
Recovery reuses a durable task identity and refuses automatic resend of an
already indexed task. Worker results wake the existing parent conversation.
Steering carries its own durable admission key so recovery cannot apply the
same correction as a second delivery.

Normal text and voice chats both expose `task_activity`: inspect observed inline
delegate and worker lifecycle stages, or steer/cancel an independently
addressable worker belonging to that conversation. Inline Flue `task` delegates
are awaited inside the parent execution and cannot receive a separately
addressed correction through this API. They expose live progress to another
active agent/UI, but a parent blocked awaiting that inline tool cannot run a
simultaneous model turn to inspect it. Converting that mechanism into independently
steerable workers remains separate work; no such support is claimed here.

The call UI displays worker participants with type, a distinct name from a pool
of over 100 names, and a generated vector avatar in existing UI colors. Active
names are allocated without collisions. Actual task stages drive their activity
indicator; settled participants leave after approximately one minute. Workers
do not each consume the microphone transcript or invoke an additional LLM to ask
the voice agent a yes/no question. The roster is a presentation of real work,
not an audio conference with separate speaking agents.

## Bounds and practical limits

- Audio uses the existing transcription and speech slots, including OpenRouter
  connections. No direct Realtime API integration or additional dependency was
  introduced. The selected conversational model must support tool calling for
  delegation. A free or slow model does not acquire a two-second SLA.
- This is a phrase-streamed cascade, not native full-duplex speech-to-speech.
  Time to first audio includes 500 ms endpoint detection, recorder flush, local
  decode, upload/transcription, model first phrase, synthesis, decode/playback.
  No live end-to-end latency measurement has been completed. Sub-two-second
  responses are a performance goal, not an implemented guarantee.
- Level-based VAD can misread noise or natural pauses. Browser AEC is best
  effort; speakerphone barge-in needs physical-device testing. Headphones avoid
  much of the echo path. Semantic turn detection is not implemented.
- Continuous takes over one minute are refused instead of executing a truncated
  instruction. Silent recordings are rotated every ten seconds. Speech output
  is bounded to 6,000 generated characters; longer results remain in chat.
- Corrections can take effect only at a model/tool boundary. A tool already
  acting can finish. Cancellation admission is not rollback or confirmed exit.
- Progress contains only fixed lifecycle stages, IDs and timestamps. It is
  bounded to 512 tasks per process and 64 per conversation response, disappears
  on restart, and never exposes tool arguments, prompts or private reasoning.
- Closing voice does not cancel useful worker work. A subsequent text message
  uses the primary chat role. No cross-window exclusive microphone/session lease
  is implemented; simultaneous voice/text controllers need coordinated use.

## Verification

Typechecking and full-suite results are recorded after final verification below.
New regression checks cover scoped image refusal, independent voice settings,
admission, transcript projection, replay suppression, phrase prefetch bounds,
late synthesis, playback interruption, lifecycle privacy, worker/steering
settlement separation and distinct participant naming. Existing registry tests
now include the worker and resolve explicit agent-name statics, preserving the
roster identity property when a function name and pinned ID differ.

## Call controls, approvals and parallel workers

- The microphone can be muted from the stage or the corner player. A muted
  track records and sends silence, and muting discards the half-said take.
- The transport always says what it does: "Send now" while listening
  (disabled until speech is heard or while muted), "Interrupt" while the
  voice agent thinks or speaks.
- Minimize folds the stage to a corner player that clears the side rail and
  keeps the call running. Escape only leaves voice mode from the full stage.
- Pending permission questions for the chat (voice workers raise them under
  the parent conversation) are asked on the stage; the corner player points
  to them. "Always" is not offered there because the stage does not know the
  chat's project.
- Spoken captions keep word gaps and drop Markdown marks (`captions.ts`).
- Voice turns ask the model for its quietest thinking level. For Claude's
  managed-effort models Pi turns "off" into adaptive thinking at high effort,
  so those models get their lowest supported level instead.
- One shared limit covers voice tasks and delegates: 8 running per chat and 16
  across the machine (`src/agents/agent-slots.ts`). A voice task past it waits
  in a queue (up to 24 per chat) and starts by itself when an agent settles;
  a delegate past it is refused with a sentence the parent can act on, since
  a waiting delegate could wait on its own parent. Flue's `task` tool consults
  the limit through a `globalThis` gate, and every prompt's Available Agents
  section ends with the limit sentence. The queue lives in memory, so a
  restart drops tasks that had not started yet. Corrections still go to the
  task they correct; the prompt forbids starting a task to redo one.
- Each voice task is the full Studio agent (`renderStudio`), not a delegate.
  It is named at admission (`voice-names.ts`), the name is stored as the
  task title, and both the voice agent and the call screen use it.
- The voice agent is told `voice_work` is a tool, that the `task` tool and the
  Available Agents list belong to the task's agent, and gets a names-and-counts
  capability overview instead of the text agent's cut-off discover block.
- Delegates (explore, general, plan) now follow the chat's permission mode
  (`mode: "inherit"`): Auto reaches them. Policy rules that ask in Auto still
  ask, read-only ceilings still hold, and asks and grants keep the delegate's
  own agent id.

## Talking over Studio

- Barge-in no longer cancels on loudness. Each mic frame is also scored as
  voice or not (`speechDetector.ts`: energy share in 250-3500 Hz, spectral
  flatness), and talking over Studio needs 250 ms of loud, voiced frames.
  Claps, knocks and typing do not get there. A take that was loud but never
  voiced is dropped before it reaches the transcriber.
- Talking over Studio holds it rather than stopping it (`VoiceConversation.hold`):
  the audio pauses mid-word and the reply keeps generating. The transcription
  decides: nothing said, or only a continuer ("yeah, go on", "mm-hmm"), and
  Studio resumes where it paused; anything else interrupts and becomes the turn.
- This also fixes replies being aborted with "The turn was aborted before it
  finished": any 120 ms of sound while Studio was thinking used to call
  `abortRun`.
- Muting sends a take that already holds speech instead of discarding it.
- Captions follow the voice: each phrase joins the caption when its sound
  starts (`StreamingSpeech.onPhrase`), not when its text streams in.
- Agents on the call are faces beside Studio's chip, on the same line, each
  with a state dot; details on hover, no expanding.
