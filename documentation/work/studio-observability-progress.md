# Studio observability implementation tracker

## Desktop presence and cursor refinement (2026-10-30)

`GET /api/computer/activity` and `computer.activity` expose only the live lease's
existing conversation ID and mode through the existing private computer RPC.
The operation inherits HTTP execution context and MCP request/connection
observations; no screen content, new capture policy or action retry is added.
The main client window owns pill renewal across navigation; the rail shares its
bounded poll and distinguishes idle from missing evidence. Native renewal has a
four-second expiry and placement follows the pointer's monitor work area using
physical coordinates, including negative origins and mixed scaling. The desktop
cursor uses per-pixel alpha instead of magenta colour-key transparency and shares
the browser's custom dart geometry and compact neutral badge.
Stop delivery failure returns under the initiating client request UUID so a late
reply cannot change another press or owner's button state; only the live lease
controls exit visibility. Existing native arrival observations still omit args.

Coverage: `computer-activity.test.ts` (lease exit/release/stopping and transparent
neutral rendering), `http-admission.test.ts` (presence admission), client
`useComputerPresence`, `ComputerPresenceMonitor`, `useComputerIndicator` and
`BrowserPanel` and `ComputerIndicatorWindow` suites, and native `indicator_tests`
(monitor coordinates and stale renewal expiry).
The former transcript-derived pill assertions move to the live-presence monitor;
chat Stop cleanup remains covered independently. Live monitor switching, native
alpha composition and focus preservation are not established by these fixtures.
This change does not close the overall Studio readiness gate.

## Interactive voice and computer use (in progress, 2026-10-28)

The plan, its verified starting state and its completion criteria are in
`voice-computer-interaction-plan.md`. Stage 1 adds two client observation
names, `client.voice` and `client.computer`, to the fixed allowlist on both
sides. `client.voice` carries `stage: transcribed` (end of speech to
transcript, with `failed`) and `stage: first_audio` (end of the submitted
utterance to the first sound of the reply, once per utterance) as durations
only; no words, audio or levels. Baselines on this container: harness 2,618
passed, 10 failed for environment reasons (listed in the plan), 62 skipped;
client 1,666 passed.

Stage 2, the desktop lease (ADR 0059). `computer/control.ts` now keys
ownership by actor (conversation plus agent instance; a delegate rides its
starter's instance), with a generation per ownership interval, per-actor
revocations that refuse calls queued before a loss, and a change counter that
makes an actor look before input after anyone else's input, a mode change or
the person's own clicks and keys. Every driver request inside a call rechecks
the lease, so a batch stops between steps. Observations are admitted for any
actor and no longer wait behind another conversation's work. A tool error now
fences only its own actor's queued calls. New: `studio_computer_control`
(status, acquire, release, wait), driver op `release_held`, the private
`studio/computer` method (state, pause, demonstrate, resume, release_actor),
`POST /api/conversations/:id/computer/control`, and release on settlement
(a worker's original submission, or any run of the conversation's own agent).
Operations: `computer.control` (attribute `action`; progress event
`computer.control.result` with `stage`, `result`, `heldInput`,
`inFlightUncertain`), `computer.stop` (progress `computer.stop.result`:
`cleanup_confirmed`, `cleanup_unconfirmed`, `not_running`, `unavailable`) and
`computer.release` (attribute `agentInstanceId`); all inherit the HTTP or
runtime execution parent and carry no screen, window or task content. The
actor reaches only system servers, in `_meta`, never third-party ones. No
retry is added: a refused or uncertain input is reported, never resent.
Coverage: `computer-lease.test.ts` (driver stand-in through the real session),
`computer-control-wiring.test.ts`, updated `computer-activity`, `computer-batch`
and `computer-server` tests.

Stage 3, screen awareness for the voice agent. The driver samples the pointer
and the front window in the same operation as a screenshot's pixels. Each
conversation keeps one shared observation (`computer/observations.ts`): the
newest picture with who took it, its frame and scaling, that pointer, and the
desktop change count at capture; staleness is derived when read (input or a
control change since, or older than 15 s). Pictures are kept for the eight
most recent conversations only; nothing queues, and task status still carries
no bytes. `studio_computer_control action latest` hands any actor of the same
conversation that picture; it never counts as the reader's own look. Screen
sharing is the person's switch (`PUT /api/conversations/:id/computer/sharing`,
operation `computer.sharing`, stage `on`/`off`), off by default, process memory
only, carried on each voice call in `_meta` and pushed to the server when
turned off; a voice call's picture that completes after sharing ended is
discarded rather than delivered. While sharing is on, the voice role is offered
the short computer list in `contracts/voice-computer.ts` (enforced by the
harness tool list and the server), with batches capped at 6 steps. Each voice
turn starts with one `interaction_context` signal (at most 1,500 characters:
sharing, lease, the latest picture's provenance and freshness, the window
title quoted and labelled untrusted). No new diagnostic content: screenshots
and titles stay in tool results under the existing gated MCP capture.
Coverage: `computer-lease.test.ts` (shared picture, sharing),
`computer-control-wiring.test.ts` (offered tools, context block, sharing route).

Stage 4, prompts. The voice prompt no longer sends a quick look at a shared
screen to a task: it teaches the lease (acquire, release, wait, never fight),
freshness and the pointer sampled with the picture, short bounded actions,
the person's four controls as not the agent's to call, and screen text as
content. The voice capability overview separates what a task can call from
the short computer list the voice agent holds while sharing. The Studio prompt
gains a Desktop Control section for workers and delegates; a voice task's body
says the desktop may be shared. No new boundary, so no new observation.
Coverage: `agent-slots.test.ts`. The opt-in routing eval needs a provider key
and is not part of this stage.

Stage 5, the shared screen between pictures, pointing and drawing. Live
awareness is events, not video: while sharing is on the computer server
samples the pointer, the front window and the person's input counts twice a
second (driver `pulse`, which never consumes the input a tool result must
report) and folds them into a short expiring list (`computer/screen-watch.ts`:
pointer rests, display crossings, window changes, input bursts, drawings; at
most 24 events, 60 s). The turn's `interaction_context` gains the pointer now
and the six newest events, marked when they came after the latest picture.
As speech ends the client asks for a glance (`POST .../computer/glance`,
operation `computer.glance`, stage `glanced`/`current`/`sharing_off`/`failed`/
`not_running`): a picture of the pointer's display under its own actor, so it
is shared but never counts as the voice agent's look before input. The new
`studio_computer_mark` tool (29 tools) shows points, rings, boxes and arrows
on screen through a native overlay window (`screen_overlay.rs`, native
commands `screen_overlay_*` recorded as received); tasks are refused it. Show
me holds the lease (`demonstrate`) and opens the overlay for drawing; each
stroke goes to `POST .../computer/drew` (operation `computer.drew`, counts
only) as a shape and box in desktop pixels, never points. Sharing starts the
computer server; everything else here still never does.
Coverage: `screen-watch.test.ts`, `computer-marks.test.ts`, `computer-lease.test.ts`
(watch, glance, drawing, marks), `computer-control-wiring.test.ts` (context,
routes); client `ink`, `marks`, `markCalls`, `useScreenShare`,
`ScreenOverlayWindow`, `VoiceModeOverlay`. Not verifiable here: the overlay on
a real display, the driver's pulse on Windows.

Stage 6, the person's controls and the worker's model. Voice tasks may run on
their own model (`GET/PUT /api/media/voice-task-model`, operation
`voice.task_settings`; null is the chat's own, the default); the catalog's
"unsupported" for tool calling or vision refuses a choice with a sentence.
`voice_work continue` starts a new task carrying a settled one's result,
admitted under the same rule as a start. A steer to a running task first
checkpoints its desktop (operation `computer.checkpoint`, stage
`fenced`/`not_owner`/`not_running`): the rest of its batch is refused at the
next step and it must look again, keeping the desktop. The client carries
`heard_before_interrupt` (phrases that began to sound, at most 600
characters, "" when nothing did) and `control` (what a spoken command already
did) as attributes on the `voice_input` signal - words in gated content, never
in observation attributes. The call has Stop talking, Pause/Resume computer and
Stop computer; a computer stop now answers one of four outcomes
(`cleanup_confirmed`, `cleanup_unconfirmed`, `not_running`, `unavailable`) and
no surface rounds an unconfirmed one up to "Stopped". Spoken commands match
whole final transcripts only (`controlMatcher.ts`). Closing a call needs no new
release: the voice turn's settlement already releases its actor, sharing goes
off and the overlay resets.
Coverage: `computer-lease.test.ts` (checkpoint), `media-routes.test.ts`,
`browser-stop-route.test.ts`, `agent-slots.test.ts`; client `conversation`,
`controlMatcher`, `useScreenShare`, `BrowserPanel`, `VoiceModelSetting`,
`VoiceModeOverlay`, harness `conversation` wire.

## Conversation workspace (2026-10-21)

The side workspace now projects durable transcript submissions into scoped tasks
and keeps selection/resources per conversation. Manual collapse is a persisted
window preference. Agent list requests and displayed rows are parent-filtered;
polling cleanup rejects late responses. The existing worker stream supports
read-only inspection, with parent product scope distinct from worker instance
addressing. Stop acceptance no longer fabricates a terminal state; background
jobs retain the backend's `stopping` state. No capture policy or body fields
were added. Regression coverage: `workspace-lifecycle.test.tsx`,
`workspaceTasks.test.ts`, `workspace-polling.test.tsx`, `TasksSection.test.tsx`,
`WorkspaceOverview.test.tsx`, and `worker-inspection.test.ts`.
Inline delegates without a public stream and persisted worker attachment
previews remain unsupported. Native GUI execution is not covered by these tests.

## Reply presentation integration (2026-10-29)

The pending workspace and reply renderers are integrated with the voice/computer
work on main. Admitted `GET /api/media/workspace/:conversationId` and
`GET /api/web/image` reuse HTTP request identity and the existing checked binary
network transport. File roots are resolved before delivery; URLs, paths, image
bytes and visual data never enter observation attributes. No new retry authority,
capture switch or permission concept is introduced. Primary task inspection
retains its image conversation scope; worker inspection explicitly clears it.
Regression evidence and commit IDs are in `report/side-workspace-integration.md`.
Coverage includes malformed addresses, reserved file-URL characters, linked
directory escape, finite visual numbers and image-scope separation. Image paint,
provider compliance with visual prompts, native workspace animation and the live
voice/overlay scenarios remain unverified by these checks.

Final Windows gates passed sequentially: 2,736 harness tests (28 skipped),
1,761 client tests and 161 native tests, with zero failures. These counts close
the automated integration gate, not the remaining live voice/overlay scenarios
or the broader Studio readiness inventory.

## Media limits in one place, request picture rules, faster computer steps (2026-10-21)

Every picture, attachment and document limit now lives in
`src/contracts/media-limits.ts` (client: `STUDIO/src/domain/attachments/limits.ts`,
held equal by `media-limits.test.ts`); `documentation/architecture/media-limits.md`
is the table and the decisions. The per-conversation `ImageBudget` was removed
(it refused re-reading an old picture, which the request window relies on);
`picture-size.ts` keeps the per-picture check. The request window now keeps 50
pictures, always sends the latest user message's pictures, keeps to 20 when any
picture is over 2000 px or of unknown size, and lowers the count for small
context windows; `provider.request.images` is unchanged. The composer refuses
past 15 MB of images per message. Computer use: `studio_computer_batch` runs up
to 20 steps inside the same desktop-ownership gate and Stop fence as single
tools (one MCP call, so one existing operation), halts at the first failure and
lists the steps not run; UI references now survive Studio's own input and are
refused when stale or off screen; the post-input wait ends once window state
and pixels are steady on three samples (300-800 ms instead of a fixed 800).
No new effectful boundary or content field. Coverage: `media-limits.test.ts`,
`image-window.test.ts`, `computer-batch.test.ts`, `computer-driver-contract.test.ts`,
`computer-server.test.ts`, `media.test.ts`, `filesystem.test.ts`, client
`images.test.ts`.

## Picture window per model request (2026-10-21)

A conversation resends every earlier picture on every turn, so a computer-use
run past about thirty screenshots was refused by the provider (Anthropic's 32 MB
request and 20-picture rules; lower counts on some OpenRouter routes).
Screenshots arrive through MCP and never passed `ImageBudget`. Both alias stream
paths in `local-adapter.ts` now send a projection that keeps the newest pictures
(at most 20 and 20 MB of base64, no gaps) and replaces older ones with a text
saying how to get them back. When it cuts, it records `provider.request.images`
with stage `older_images_omitted`, provider, model and the two counts; no
content. Attached and read pictures also report pixel size from their header,
with a note when the provider will scale them down. Coverage:
`image-window.test.ts`, `image-dimensions.test.ts`, `attachment-copies.test.ts`,
`filesystem.test.ts`, `local-openai-compatible-provider.test.ts`.

## Oversize MCP answers and bounded pictures (2026-10-21)

An MCP stdio answer over the line limit used to be dropped with only a
diagnostics line, so its request waited out the 30s deadline: two full-display
PNG screenshots of a photo-like screen (2-3 MB) were lost this way in a voice
run. The connection now reads the request id from the kept preview (only from
the first two top-level members) and rejects that request at once with
`ExtendError("too_large")`, recording an `mcp.connection` progress event with
stage `response_oversize` and the `rpcId` only. The stdio limit is raised from
1 MiB to the 8 MiB the HTTP channel already accepts, and the decoder now counts
bytes incrementally instead of re-measuring the buffer on every chunk. At the
source, computer and browser screenshots keep a 1 MB picture budget: an
over-budget PNG is sent as a JPEG (the computer driver shrinks a JPEG still over
it; the browser refuses a full page with a way forward), and the tool text says
which. A voice task's running line in the environment block names its latest
observed step (tool name only, never arguments) from the same process-memory
trail as `inspect`. Task activity names the `owner` worker of a worker's inline
delegate, so the desktop indicator's Stop cancels that worker. Self-hosted
connections (9router): the probe's wire answer no longer carries `servedIds`;
adoption records the limits, vision, tools and reasoning a listing states
(only into fields still unknown); and declared vision now reaches the runtime
model's inputs, where every self-hosted model used to be text-only and Pi
replaced each picture with a placeholder. No new operation, route or content
field. Coverage: `mcp-connection.test.ts`,
`framing.test.ts`, `computer-driver-contract.test.ts`,
`browser-screenshot-budget.test.ts`, `task-projector.test.ts`,
`useComputerIndicator.test.tsx`, `useDelegatedComputerUse.test.ts`,
`local-openai-compatible-provider.test.ts`, `provider-probe.test.ts`.

## Sub-agent inspection and delegated computer presence (2026-10-21)

`task_activity` gains `inspect`, a read of one task's recent steps through the
new `task.inspect` operation (child of the tool's execution parent, scoped to the
owning conversation). Its `task.inspect.read` progress event carries only
availability, entry count and the dropped/more flags. The steps themselves are a
bounded product projection held by the task projector: assistant text, tool
names, arguments and result text, never reasoning, image bytes or typed text and
keys, redacted with the shipped rules and cut at 600 characters an entry, 48
entries a task and 64 tasks. They reach the model as the tool result, under the
existing gated tool capture. The trail is process memory: restart, eviction and
unobserved events are reported as unavailable or dropped, never filled in. A read
re-runs and resends nothing. The voice agent and voice workers get a read-only
surface (`status`, `inspect`); steering stays with `voice_work` and the text
conversation. Workers now mount `task_activity` over their own delegates.

Task activity also carries a sticky `computer` flag once a delegate or worker
calls a Studio computer tool. The client raises the existing desktop indicator
from that projection, read on the call stage's existing 1.5s activity cadence,
and the indicator's Stop also cancels voice tasks driving the desktop. No new
route, permission, collection policy or native command is added. Inline
delegates are inspected through parallel calls or after their `task` returns;
live inline steering remains unsupported. Coverage: `task-projector.test.ts`,
`task-control.test.ts`, `task-settlements.test.ts`, `useComputerIndicator.test.tsx`,
`useDelegatedComputerUse.test.ts`, `conversation.test.ts` (voice).

## OpenRouter-first voice and task progress (2026-10-21)

The voice role shares Studio's canonical conversation, with a separately selected
language model and existing media transcription/speech transports. Speech replay
is suppressed; local playback interruption is distinct from model abort and
worker cancellation. `voice-work` is a registered worker kind with its own
instance and agent authority, using its admitted parent's workspace, selected
working model and existing CallGate. It does not inherit a grant from a voice
model's decision. Conversation-owned image reads remain gated and bounded to
image paths in attachments/artifacts.

New operation boundaries are `voice.settings`, `voice.work`,
`voice.work.dequeue` (a queued voice task starting once a running agent
settles; it reuses the task id minted at admission), `task.steer` and
`task.cancel`; the existing dispatcher, invocation receipt map, HTTP and Flue
boundaries cover the surrounding transport and runtime lifetimes. Steering uses
the original worker instance and binds its admission writer before the async
dispatch. Worker settlement follows the original host submission. The bounded
product progress projection retains no tool bodies or private reasoning.

Verification results and implementation limits are recorded in
`report/studio-voice-implementation.md`. This entry does not claim measured
microphone latency, native speech-to-speech, complete Studio readiness, or live
steering of framework-inline delegates.

## Voice on a loudspeaker, and the screen kept on (2026-10-22)

Voice mode now runs WebRTC's AEC3 echo canceller itself
(`@ennuicastr/webrtcaec3.js`, BSD-3, WebAssembly embedded in the library)
in an audio worklet, so talking over Studio works on a loudspeaker. The
microphone (opened without browser processing) and Studio's playback share
one `AudioContext`; the canceller's reference is exactly the samples sent to
the speakers, and the detector, meter and recorder all hear the cleaned
signal. Voice pause no longer suspends that context (the microphone shares
it): the sink stops its clips and reschedules them from their offsets. If
the worklet cannot start within 3 s, the microphone is reopened with the
browser's processing, as before. The desktop CSP allows
`'wasm-unsafe-eval'` for this. Earlier attempts in this change set (a WebRTC
loopback reference, a learned echo-level gate, a transcript echo check, and
half duplex) were removed. A Screen Wake Lock is held while voice mode is
open and re-requested when the page is shown again.

None of this adds an entry point, route, command, job or ID, and no audio or
transcript enters diagnostics. Whether a session ran with the canceller or
fell back is not observed: browser devices have no native capture, and the
client observation names are unchanged. Tests run the real WebAssembly
against a simulated room (echo reduced by more than 20 dB at 100 ms and
250 ms delays, a talker over it kept audible) and cover the sink's pause and
resume; the worklet was observed starting in 38 ms in Chromium with a
synthetic echo reduced by about 30 dB.

Follow-up (2026-10-24), after a phone still answered itself: AEC3 only finds
an echo returning within about half a second, and removed almost nothing at
600 ms and beyond, which a phone browser's output and capture path can reach.
The filter now measures the delay (log-loudness envelopes of what was played
and heard, compared at 10 ms steps up to 1.5 s, believed when found twice) and
holds the reference back by all but ~150 ms of it. A new hold-back takes
effect with a fresh AEC3 only once Studio has been silent longer than the
delay plus 300 ms, because AEC3 re-aligned or started while echo was arriving
kept leaking for seconds. The measured value is kept in the browser's
`localStorage` (`studio.voice.echoHeldBackSeconds`, a number only) and starts
the next conversation aligned, so on a slow-echo device only the first reply
of the first conversation can leak. When the canceller cannot start, voice
mode now says so on the listening line. Tests cover a 700 ms echo (the second
reply reduced by more than 20 dB, a person between the replies kept) and a
remembered delay cancelling the first reply. The delay this phone actually
has, and the result on it, are not yet verified.

Second follow-up (2026-10-24), after the phone's microphone reached Studio
not at all: the context now runs at the device's own rate (AEC3 resamples)
instead of a forced 48 kHz, and before voice mode listens it asks the worklet
for quarter-second peaks in and out; no non-zero microphone through the
canceller within 3 s closes the graph and reopens the microphone with the
browser's processing, with the existing "could not start" line shown. In
Chromium a live source passed and a silent one fell back after 3 s; a
44.1 kHz filter test was added. Which of these the phone hit is not known,
because no client observation carries it.

## Other-device HTTPS (2026-10-22)

The existing remote listener answers TLS on the same ports when a certificate
pair is configured (plan §3.7 amendment). It adds no entry point, route,
command, transport, job or ID. Connection scheme selection, handshake
failures and an unusable certificate are debug/warn log lines only; no path,
certificate, key or peer value enters diagnostics. The existing remote HTTP
observation gaps and capture policy are unchanged, and this entry claims no
new coverage. Native tests cover the certificate-to-host match, a mismatched
key, unreadable files without the path in the sentence, the configuration
order, and one real port serving a TLS client and a plain client through the
same gate. No physical-iPhone verification is claimed.

## Other-device pairing follow-up (2026-10-20)

Pairing renewal uses the existing `remote_pairing_code` command with an optional
renewal flag; no new native command or HTTP route is added. The existing command
arrival registry remains applicable and does not claim command completion.
QR submission uses the existing pairing endpoint, retains native authentication
and verifies cookie acceptance before mounting the workspace. The code travels
in a URL fragment removed before requests; no credential, code, raw user-agent
or URL content is added to diagnostics. Device IDs remain unchanged; restored
revocation channels retain the original device identity. Storage failures remain
product failures rather than successful pairing/removal. UI refreshes do not
replay failed pairing submissions. Existing remote HTTP observation gaps and
capture policy are unchanged. Regression evidence and review limitations are in
`report/other-device-pairing.md`.
The sequential root gate passed 2,567 harness tests (28 skipped) and 1,602 client
tests. Serial native library checks passed 154 tests, excluding the existing
real-keyring self-test; Clippy with warnings denied, the production frontend
build and the embedded desktop debug build passed. No physical remote-device
verification or new diagnostic collection coverage is claimed.

## Steering transcript ordering follow-up (2026-10-20)

The runtime's UI projection now splits assistant display groups at user messages,
including steering joined to an existing submission. Canonical message and
submission identities remain unchanged. Live encoding keeps each source message's
group instead of redirecting all output to the submission's first bubble. This is
a projection correction, not a new execution or capture boundary; existing client
projection and runtime observations retain their identity and privacy contracts.
The stop integration fixture checks bounded live SSE and saved history ordering;
the client transcript fixture checks the pending-to-echo rendering transition.
Sequential full gates passed: harness typecheck/lint/build and 2,567 tests
(28 skipped); client typecheck/lint and 1,588 tests. Deliberately removing the
live grouping boundary failed the SSE ordering assertion; restored bytes matched
their pre-mutation SHA256. Details are in `report/steering-transcript-order.md`.

Goal: finish and verify the full Studio side before implementing the independent
Codex/Claude inspection tool. Status: **Stage A implemented and verified** against
the coverage inventory below. The external inspector has not been started.
Started 2026-10-16 against the existing working tree. Preserve unrelated edits.
Work branch: `codex/studio-observability`; review commit remains unmerged.

Final verification: harness gate #19 and client/native gate #20 passed. The only
intervening source change was a client-test type annotation. All 1,203 final
source/dependency hashes match the frozen manifest. Earlier entries below are
historical checkpoints, including failed or deliberately interrupted runs.

## Implemented foundation

### Active follow-up checklist, 2026-10-20

Audio compatibility follow-up: retain OpenRouter's model-advertised voices,
resolve a missing voice under `media.voice.resolve`, and keep explicit voices
unchanged. Browser dictation now encodes real mono PCM WAV; OpenAI multipart
filenames match the supplied MIME type. Read-aloud and dictation errors use a
bounded details popover. Parent/privacy and provider-wire regressions cover the
changed boundary. Browser proof confirms WebM/Opus decoding to 16 kHz PCM and a
long error contained within a 360-by-480 viewport. Sequential full gates passed:
harness typecheck/lint/build and 2,567 tests (28 skipped), then client
typecheck/lint and 1,587 tests. Client production build passed as well. Detailed
results are in `report/audio-provider-compatibility.md`; live paid provider calls
remain outside the automated proof.

- [x] Finish live steering: interrupt the provider request, join the durable
  correction once, preserve ordinary queued work and give Stop priority.
- [x] Use one composer action slot: Stop while running with an empty draft;
  Send to queue while a draft is present. Keep voice controls and layout stable.
- [x] Verify the three-message queue limit in the client and harness.
- [x] Verify computer mouse position/activity updates and keyboard activity
  without key values or typed text. Separate automated proof from desktop tests.
- [x] Match computer cursor and custom hint styling to Studio browser.
- [x] Review active-tool Stop cleanup and document cancellation boundaries.
- [x] Run full harness/client checks sequentially, commit and push only main,
  and remove other branches only when proven safe.

Live steering regression tests now prove provider interruption, conversation
isolation, preserved queued work, Stop priority and content-free diagnostics.
Computer protocol fixtures prove active-call draining, queue refusal and an
honest failure result for unconfirmed cleanup. Native drawing is tested offscreen;
physical mouse/keyboard hooks, overlay focus and multiple monitors still require
hands-on verification. Full sequential gates passed: harness typecheck/lint/build
and 2,561 tests (28 skipped); client typecheck/lint and 1,579 tests. The client
production build also passed. Hash-verified mutation controls were restored;
main is the only local and remote branch. Detailed evidence and the Stop policy
are tracked in `report/live-steering.md`.

### Queue promotion delivery, 2026-10-20

The composer queues follow-ups through one send icon. Successful queue promotion
retains its submission ID, records `client.projection` /
`queued_message_promoted` without content, displays the pending user message and
reattaches the existing conversation reader from its retained offset. No new
submission, retry owner, permission or capture setting is introduced. Client
fixtures cover failed promotion, stale queue reads, immediate pending display,
echo deduplication, retained-offset recovery and already-settled promotion.
Existing real-harness queue/steering fixtures verify safe-step joining and
persisted user messages with no separate assistant turn for the correction.

### MCP discovery browsing and explicit loading, 2026-10-20

`native/discover` retains the existing tool gate and conversation adoption set.
List/search, read-only inspection and explicit named/all loading now have child
operations `discover.list`, `discover.inspect` and `discover.load`. Operational
observations contain counts, continuation state and serialized schema bytes only;
arguments and results retain the existing gated content path. Native and third-party
MCP share enablement and byte bounds. Cursors bind the catalog/search, not authority.
No MCP request, retry, capture switch or permission concept was added. Unit coverage
includes parent linkage, failed outcomes, content exclusion and pre-adoption
refusals. The full harness check passed typecheck, lint, build and 2,548 tests
(28 skipped). The sequential client check passed typecheck, lint and 1,571 tests.
Focused harness coverage rose from 52 to 88 tests; negative controls caught the
wrong page size, bypassed enablement and missing byte guards before restoration.
Earlier gate results below are historical.

### Computer/browser presence and shared desktop ownership, 2026-10-19

The existing computer MCP boundary now carries bounded non-injected input
summaries and current pointer/window state through tool results. It keeps physical
key values out of collection, invalidates stale refs, preserves action failures,
and does not automatically stop or replay input. The driver owns the hook/message
loop and a click-through, nonactivating pointer marker; shutdown/refusal cleans up
Studio-held input. One shared desktop owner coordinates conversations, with Stop
remaining outside the input queues. Browser presence uses its existing admitted
private route and distinguishes viewer-only samples from manual page commands.
Cursor shape/press telemetry remains visual-only; aggregate model-context results
use the existing gated capture policy. No raw private-input diagnostic collection
was enabled. Hook loss, physical attribution, native visual behavior and hands-on
desktop workflows remain unproven. The roadmap records deferred manual checks;
verification is tracked in `report/computer-use-presence.md`.
Full sequential checks passed: harness typecheck/lint/build and 2,512 tests
(28 skipped); client typecheck/lint and 1,568 tests. Native hooks and marker behavior
on the user's desktop remain explicitly unverified.

### Computer-use observation and recovery, 2026-10-19

Computer control now uses UUID-scoped accessibility refs, target process identity
checks, display-relative accessibility coordinates, explicit ambiguous-window
refusals, and consistent bounded action observations. Replacement candidates are
reported without adopting the foreground window or replaying input. A per-session
tool queue keeps observations together and invalidates queued/stale work on stop
or failure. Existing tool-gate/MCP capture covers the boundary; no new content
collection is enabled. The developer contract records unsupported native delivery,
settlement, same-process handle reuse and cross-conversation arbitration evidence.
Regression coverage uses isolated driver-policy doubles without desktop input.
Implementation and verification are tracked in `report/computer-use-recovery.md`.
Full sequential gates passed: harness typecheck/lint/build and 2,498 tests
(28 skipped); client typecheck/lint and 1,564 tests. The real Chrome profile-picker
flow was not exercised on the user's desktop.

### Image read presentation, 2026-10-19

Native `read` already sends supported image bytes as image content to the model.
The client now groups adjacent successful image reads into a disclosure with
thumbnails and the existing media lightbox. Text reads remain non-expandable.
Persisted images reuse the conversation attachment resolver and its existing
instrumented byte transport; no new tool, identity, route or capture policy is
introduced. Preview clicks and image paint remain unobserved local presentation.
Coverage: `ImageReads.test.tsx` and the image case in `ToolGroups.test.tsx`.
Validation: harness check passed 2,468 tests / 28 skips; the final client check
passed all 1,561 tests. The earlier client library-test timing failure, passing
unchanged reruns, mutation evidence and visual verification are recorded in
`report/image-read-previews.md`.

### Browser reliability and shared appearance correction, 2026-10-18

The detached viewer resolves its own client, with bounded, visible recovery of
address/frame reads only. Manual inputs are never replayed; input refusal is
separate from transport failure. A page-title evaluation cannot block frames or
lease renewal. Frame dimensions use capture metadata and previews never upscale
small viewports. Scroll coalescing retains ordering relative to clicks.
Shared native preference-store/browser storage subscriptions update every window
without persistence echoes. The existing client recorder emits only the fixed
`client.window` / `appearance_received` stage, with no preference values.
Validation for this correction is tracked in `report/browser-window-fixes.md`;
the previous extension's gate counts below are not this correction's results.

### Detached live browser extension, 2026-10-18

Branch `codex/live-browser-window` adds an admitted conversation-scoped human
browser-control route and private system MCP RPC. `browser.interaction` joins
the HTTP parent to conversation and MCP connection/RPC identity. The existing
client request and native service boundaries cover delivery. Native
`open_browser_window` reports arrival and a separate creation/focus operation
with success/failure. Paint and IPC-arrival parent joining remain unsupported. The browser
child's CDP frames and numeric cursor events are transient product data;
per-frame diagnostic observations are unsupported. Manual input and frames are
excluded from MCP content capture even under scoped consent. No resend owner
is introduced. Tests cover lease exclusion/expiry, cross-conversation isolation,
admission/validation, capture privacy, and actual installed-browser input,
frames, cursor telemetry, popups and detach preservation. Validation outcomes
are recorded with the implementation report; earlier gate counts above remain
historical and do not certify this extension.

Extension validation on 2026-10-18: harness typecheck/lint/build and the complete
verbose suite passed (2,467 tests, 28 skipped); client `pnpm check`
passed (1,545 tests); native Cargo tests passed (150), and Clippy passed with
warnings denied. The final rendered-window fixture passed with an isolated
Vite cache. Negative controls covered control exclusion, tab bounds, private
content, real input delivery, detached-client startup and native window identity
and outcome reporting. These results validate this extension, not the remaining
Studio readiness inventory as a whole.

### Live inspection follow-up: task continuity and job termination (2026-10-17)

Branch `codex/studio-run-continuity`, based on the installed Inspector branch.
The live Next.js test built successfully, then reverted to an earlier HTML-only
request after a job-induced instructions-update signal and deleted the new work.
Private transcript evidence stays outside the repository. This does not establish
that the provider lost the latest request; the exact historical wire context is
unavailable.

- Move changing job/delegate facts from digested instructions to the existing
  admission hook's `background_work` signal. Current tool results still deliver
  subsequent changes. Keep latest applicable user intent explicit in the prompt.
- Background jobs now distinguish `stopping` from `stopped`; the latter and its
  timestamp require close confirmation. Jobs and runtime shutdown wait up to two
  seconds for confirmation. Windows taskkill asynchronous errors/nonzero exits
  receive a direct-root fallback instead of being ignored or crashing the host.
- Clarify required plan update fields without weakening the input schema.
- Coverage: existing admitted runtime-signal and background-job boundaries; no
  recording policy expansion, new credentials, provider replay or permission bypass.
- Regression proofs: original code failed all three new context/stop assertions;
  deliberate reintroduction of job instructions and removal of taskkill handlers
  failed all four corresponding assertions. Mutations restored. A built runtime
  test retains both old/new requests across start/stop with no instruction churn;
  direct and shell-launched child termination fixtures pass.
- Full checks passed sequentially: harness typecheck/lint/build and 2,455 tests
  (28 skipped, 186 passed files and two skipped); client typecheck/lint and 1,538
  tests (169 files). Client exit was zero with the previously recorded
  `running-mark.test.tsx` worker-termination warning; that teardown issue remains
  separate. Native code was unchanged, so Cargo checks were not rerun.
- A built-runtime mutation reintroduced job facts into instructions. Both old
  and current requests remained present, while `instructionChurn` became true
  and the regression failed. Restoring the fix restored the exact full-gate
  source hash and the regression passed again. This rules out basic input loss
  in this controlled Flue path, not provider-specific historical serialization
  or model behavior. The original GLM incident still requires a live repeat.
- Changed source: `agents/studio.ts` and `context/system-prompt.ts` for stable
  instructions and task continuity; `process/background.ts`, `process/exec.ts`,
  `tools/shell/jobs.ts` and `application/studio-runtime.ts` for stop lifecycle;
  `tools/plan/plan.ts` for required-field examples; the scripted test provider
  and regression/cleanup fixtures for verification. No client/native source or
  dependencies changed. No unrelated product rules were introduced.

- Version 1 observation/identity/policy/health/page contracts.
- Cryptographic UUIDv4 for new client records, including remote HTTP fallback.
- Explicit logical-operation retry context helper; external IDs preserved.
- Disabled-by-default bounded local recorder, byte/count limits, sequence/boot
  cursors, drop/eviction health, scoped content redaction and deletion.
- Reusable operation wrapper, Flue live observation capture and interceptor
  execution starts/ends, language provider callbacks, tool gate stages/bounds,
  MCP request/connection IDs and HTTP response/admission correlation.
- Scope-protected local diagnostic policy/read/delete API and remote proxy refusal.
- Disabled OTel exporters no longer retain observations; explicit memory exports
  capped; test dumps now preserve span/event timing.
- Root AGENTS.md and developer observability contract for future features.
- Root CLAUDE.md points Claude Code at the same rules and contract.
- Client requests now propagate cryptographic request IDs to admission.
- Local Diagnostics settings pane: explicit start/stop, conversation-content
  consent and selection, event limits, loss counts, clear and bounded clipboard
  export. Export stops recording and checks boot/policy consistency across pages.
  Stopping preserves the retained window; revoking content/scope clears it.

The coverage inventory below defines the boundaries and limitations. The recorder
is process-local, not durable storage. Verification-log entries are chronological;
later repairs supersede the open findings in earlier checkpoints.

## Coverage and explicit limits

| Boundary / deliverable | Current evidence / remaining work |
| --- | --- |
| HTTP and admission | Request IDs, response headers, receipt linking and client propagation. Admission indexes direct invocations before runtime scheduling; repeated receipts keep their original execution. Real-router fixtures verify two successive submissions and request-to-title joins. |
| Flue agent/model/tool/task/compaction | Runtime observer and execution boundaries, actual producer admission hooks and bounded invocation mappings. Rebuilt integration fixtures prove successive/concurrent request joins, model-to-submission identity, refusal and active-model cancellation. Unit fixtures cover recovery without admission proof, returned errors and capture epochs. Interceptor steps are not provider-attempt counts. Full harness gate passed. |
| Tool stages | Validate/authorize/containment/snapshot/queue/execute boundaries preserve synchronous gate ordering. Unit fixtures cover deadline/error classification; real-harness refusal proves no execution occurs after denial. Returned error and cancellation mutations fail the real integration assertions. |
| Language provider | Target/hook/response/parsed item observers compose original callbacks. Actual HTTP attempts on supported Pi fetch adapters have separate IDs and already-serialized request bodies; Request/Response objects and fetch receivers are preserved. Unsupported adapters retain their original fetch path. Response byte archives and unsupported adapter wire payloads are unavailable; parsed items are not network bytes. Provider-settings writes run `provider.language.reload` (rebuild of the local runtime from settings; failure recorded, write kept). Direct-HTTP connect fallback between judged addresses records `net.http.address_fallback` without address/host/URL (`net-http` and `local-openai-compatible-provider` fixtures). A reload is not a turn and proves nothing about provider reachability. |
| MCP | Connection/RPC IDs, request/notification/connection facts and registry server links. Supervision keeps one logical operation with new attempt IDs on actual restarts; incoming shared notifications deliberately have no conversation/content owner. Connection, wire-frame, duplicate-reply and supervisor fixtures pass. Captured JSON-RPC frames are not transport byte archives; unsupported wire evidence stays explicit. |
| Client delivery/UI | Submission/stream/delivery/projection and first/final paced DOM commits join request/conversation/submission/stream/message/block IDs. Bounded uploads, epoch policy, registry parity and persistent outage-aware badge. Real paced-text and badge fixtures pass. DOM commit is not screen paint; historical remounts are display observations, not new executions. |
| Native host | Separate bounded 2,000-event ring, host-only ingestion, verified device provenance, request/stream/byte/lifecycle IDs and command-arrival IDs. Real loopback receipt fixture and source-ingest tests pass. Diagnostic/service arrivals avoid recursive recording. Detached-browser creation/focus has separate start/end outcomes. Other window/clipboard/remote-management completion and generic IPC-to-transport parent joins are unsupported; plugin-managed OS UI calls are outside custom IPC capture. |
| Background commands/media/retrieval/hooks/skills/snapshots | Detached process/media lifetimes; invocation/submission/request links for title/improve/describe; title retry scope distinct from authorization; resolved media targets, model-advertised OpenRouter voice resolution and retrieval fallback attempts; snapshot, command expansion and skill packaging boundaries. New tools/MCP/agents through these registries inherit their boundaries. Per-storage-row and arbitrary internal function tracing are intentionally excluded. |
| Configuration/user control | Enable/stop/scope/delete/copy, bounded retention, capture epochs, optimistic policy guards, serialized native reconciliation and persistent status. Stale receipt, deletion, outage and policy-race fixtures pass. Synchronization polls every three seconds; it is not an instantaneous distributed consent transaction. Retention is count/bytes and process lifetime; no time-based expiry or durable content storage. |
| Extensibility | Operation/job/provider helpers and shared AGENTS/CLAUDE contract. Client event vocabulary and native command policy have registry parity tests. Unsupported content/clock/delivery evidence is explicit. |
| Performance/failure safety | Opaque bounded-source handles, JSON input bounds, fixed projections, Flue snapshot key reuse, privacy/error/proxy/accessor guards, byte/count caps and local benchmark measurements. Added capture overhead measured separately from mandatory Flue snapshot work. Measured acceptance budget met; final review, full checks and source-hash audit passed. |
| Verification/review | Thirteen scoped read-only review passes; findings repaired and mutation-verified, latest four passes without actionable P1/P2 findings. Rebuilt integration slice: ten tests pass. Full harness/client/native checks, Clippy and unchanged-source audit passed. Client teardown warning and isolated follow-up are recorded below. |

## Verification proof map

These are regression and mutation proofs, not substitutes for the final full gate.
All deliberate mutations were restored before the final source manifest.

| Invariant | Regression evidence | Deliberately broken behavior |
| --- | --- | --- |
| Request/admission/submission joins remain causal under concurrency and recovery | `invocation-observations`, `invocation-boundary` and real `observability` integration fixtures | Nested prompt identity, producer mapping, missing admission proof, deduplicated receipt and refusal cleanup; batches #14-15 failed as expected. |
| Capture deletion cannot restore old content through a late child/callback | Recorder, provider, runtime and native epoch fixtures | Child/submission epoch guards and native stale policy/receipt guards; expected failures recorded in batches #6-8 and #14. |
| Provider/tool content cannot bypass credential and argument-fragment handling | Content-capture and provider fixtures | Fragment/scalar guards and quoted-text credential matcher; batches #10 and #12 failed as expected. |
| Returned tool failures and active cancellation remain distinct from successful execution | Operation fixtures and real refusal/cancellation integration cases | Returned `isError` and aborted-turn classification removed; batch #15 failed both integration assertions. |
| MCP settling evidence remains the first actual response frame | MCP connection/wire fixtures | Duplicate-response replacement mutation failed; original first-settlement behavior restored. |
| Recording cannot invoke provider accessors or replace product responses | Provider HTTP and error-classification fixtures | Request body/response metadata accessors and arbitrary error names; batches #7 and #9 failed as expected. |
| Native diagnostics do not recursively record their own polling/upload calls | Native command-policy and capture fixtures | Self-exclusion removed; batch #8 failed as expected. |
| Display events describe actual paced DOM commits | Assistant text-display fixture | Premature settled event; batch #7 failed as expected. |

## Verification log

- Initial focused harness run: 6 files / 112 tests passed (recorder, existing OTel,
  bounds, MCP connection, HTTP admission and architecture).
- Initial client run: 2 files / 13 tests passed (ID generation and existing transport).
- Initial typecheck succeeded before later changes; repeat after latest changes.
- Lint identified a Pi import outside the gateway and two non-null assertions;
  these have been corrected and need a clean rerun.
- Built-in `codex review` requested against the implementation files, excluding
  pre-existing unrelated UI edits. Review completed with three concrete findings:
  P1 truncation inside PEM secrets, P2 compound token keys, P2 wide-object
  enumeration cost. The first two were repaired and have regression tests.
  **The wide-object cost finding remains open.** Generic object enumeration can
  exceed the byte budget's apparent CPU bound; do not certify passive overhead
  until source-boundary capture/serialization has addressed it and been measured.
- A tool-gate regression test caught an added async yield before validation that
  allowed unregistration to overtake authorization. Synchronous validation and
  containment now use a synchronous observation helper; the 42-test gate suite
  passes again. Keep that ordering invariant.
- Latest focused harness run: 3 files / 53 tests passed (gate, recorder, provider
  callback composition). The prior rebuilt real-harness run passed all four
  observability integration cases; its one failure was the gate ordering case
  above in another file, now repaired.
- Client typecheck and targeted lint passed after wiring the control API/requests.
  Local UI/settings/client focused run: 3 files / 55 tests passed. Earlier
  conversation/client/UUID run: 3 files / 83 tests passed.
- `cargo test diagnostics_never_leave_the_local_host --lib`: passed (1 test).
- Full harness `pnpm check` session 50140 completed: typecheck/lint/build passed;
  2,388 tests passed, 28 skipped and one recovery test failed. The recovery case
  also failed in isolation: its 30s deadline was shorter than Flue's actual 30s
  lease expiry plus up to 15s scan interval and fixture model delay. With the
  imported lease duration plus 45s budget, the same terminal-state assertion
  passed in 38.94s. Final full rerun is still required after subsequent changes.
- Full client check session 87816 passed typecheck/lint but surfaced one failure
  in the existing ToolDetails MCP rendering test and a worker termination timeout.
  It was explicitly stopped to return to the repository's sequential-suite rule.
  Rerun it after the harness ends and isolate the failure before assigning cause.
- Isolated ToolDetails failure came from two matching region roles. Its assertion
  now selects the existing accessible section name. Client focused runs passed
  120 tests across seven files, then 10 tests across three files including new
  capture transport lifecycle/abort/replacement fixtures. Full client rerun open.
- Native full `cargo test --lib` passed all 141 tests twice; latest session 35167
  includes review repairs and deletion-race fencing. Clippy with warnings denied
  passed after native transport/byte/provenance changes; repeat after latest edits.
- Review #2 completed read-only. Five findings: native stale consent application,
  missing reconciliation on policy failures, pre-clear span resurrection,
  reader-gone misclassification and paired-device attribution. Repairs added,
  including host-vs-device source IDs established at the pairing gate and forged
  device-header replacement. Repeat review and mutation verification remain.
- Latest focused harness recorder/source-ingest run passed 15 tests, including
  stale consent rejection and paired source provenance. Client/native source
  timestamps remain separate from collector receipt clocks; no cross-process
  monotonic subtraction is valid.
- Background/media/retrieval changes passed the existing 64-test focused run.
  Added detached identity/privacy/terminal-once fixtures in job-observations.test.ts;
  these await execution while the full client suite runs sequentially.
- Full client check is running in session 97563. Typecheck and full lint passed;
  it completed successfully: all 167 files / 1,531 tests passed. Subsequent client
  mutation check restored the original production guards and passed all four
  transport lifecycle tests.
- Latest harness focused run passed all 65 tests across six files, including job
  lifetimes, media jobs/generation/routes, retrieval and document reading.
- Mutation checks: removing client stale-poll guards made the replacement-capture
  assertion fail; removing the detached capture epoch fence made its deletion
  assertion fail. Both mutations restored, focused suites green. Further coverage
  mutation checks remain (these two checks are not blanket test certification).
- Clippy with denied warnings passed again after native clear revision fencing.
- Read-only review #3 completed (log `%TEMP%/studio-observability-review3.log`).
  Three findings repaired: ordinary async completions now use capture-bound
  writers (also applied to provider, interceptor and MCP send callbacks); native
  writes recheck consent under the recorder lock; background stop records progress
  and emits terminal cancellation only after process close confirms it.
- Latest focused run passed 95 tests in five files (MCP connection/supervision,
  job observations, provider callbacks and tool gate). Additional source-ingest
  tests passed all six, including native schema/clock/dedup/stale-epoch/privacy
  and diagnostic-scope enforcement for trailing-slash requests.
- Native full repeat session 12326 passed all 141 tests after native forwarding
  changes. Client transport tests passed all four after separating native sync
  time from client HTTP deadlines; current client typecheck session 19090 passed.
  Harness typecheck/lint session 49145 passed. Final checks must include changes
  made afterward; these results are not a full final Studio certification.
- MCP now captures actual encoded/decoded JSON frames through a deferred,
  consent-gated serialized-content handle. Capture checks input length before
  parsing; oversized/invalid frames have explicit omission/truncation markers.
  Decoded raw frames are retained only while an in-scope content-captured request
  is waiting, and released on success/rejection/timeout. Incoming shared messages
  still do not acquire a conversation owner. The product serializes arguments
  exactly once; new tests assert frame fidelity and credential redaction.
- Latest focused run passed 104 tests across six files (framing, recorder, MCP
  connection/supervision, jobs and source ingest); targeted lint passed. Removing
  the serialized-input budget guard made its regression test fail; guard restored.
- Prior full harness check session 23366 has no live handle or corresponding test
  process; its log has no completion result. It cannot count as a passed gate.
  Current full harness check is **session 5889**, output
  `%TEMP%/studio-observability-harness-check-current.log`. Typecheck, lint and build
  passed; Vitest is live. This run began before the last fetch-receiver and
  structured-argument-string refinements, so final certification still requires
  checks covering the final source. Do not run another full/integration suite
  concurrently or restart this process merely because output is quiet.
- Review #4 completed: duplicate MCP response-frame overwrite, omitted native
  Error details and unfenced HTTP completions were repaired. Tests passed, and
  deliberate mutations reproduced all three regression classes.
- Review #5 completed read-only in session 22147; log:
  `%TEMP%/studio-observability-review5.log`. It found a child-context bypass of
  submission capture epochs and aborted-turn misclassification. Both repaired:
  descendants inherit consent, only new top-level invocations retag, aggregate
  events check both context and submission epochs, and explicit aborts cancel.
- Latest nine-file focused run passed 134 tests. Later focused additions passed
  81 tests across six files and 58 tests across four files. These cover original
  results/rejections, provider callback semantics, token-count retention, argument
  string redaction, runtime content fencing and returned tool errors.
- The rebuilt real-harness observability integration suite passed all five tests,
  including original `args.pattern` capture that the fallback projection lacks.
  Removing source-bridge installation and rebuilding made that integration test
  fail (`projected` instead of `captured`); installation restored. Later context
  fencing refinements still need a fresh rebuilt full run.
- Offline patch install and frozen-lockfile verification passed with no new
  dependency versions. The Flue patch hash and dependent references changed;
  only generated lockfile references changed. The optional source hook also
  contains callback/property-access failures, and teardown cannot block shutdown.

## Source-boundary capture repair and remaining audit

JavaScript generic object key enumeration cannot provide a constant CPU budget,
even if the output loop stops after 100 keys. Moving `Object.keys` elsewhere or
changing it to `for...in` does not fix this. Do not mask the finding with a looser
benchmark or omit evidence without exposing that omission.

The hot content paths now use explicit bounded inputs. Recorder `content` accepts
scalars or opaque source handles, with a compile-time rejection fixture for bare
objects. MCP and supported Pi HTTP attempts capture existing serialized JSON.
Provider callbacks use declared-field projections and label them `projected`.
Native tool input fields derive automatically from their existing JSON schemas.
The optional installed Flue patch reuses key lists its mandatory frozen snapshot
already visits: scoped capture retains only 101-key prefixes for 128 objects in
a weak index. Original small envelopes keep their original fields; missing indexes
and width/depth/work/byte limits explicitly report truncation. Framework snapshot
creation still has its existing input-dependent cost; it is not claimed bounded
by the added recorder budget. Standalone generic serialization is for owned
bounded metadata/parsed JSON, not foreign callback objects.

Measured locally on a 500,000-field fixture over seven samples: generic traversal
median 176.83ms/max 254.58ms; declared projection median 0.016ms/max 0.100ms;
indexed original-field capture median 0.392ms/max 1.310ms. These are measurements,
not universal latency guarantees. A VM timeout experiment confirmed a 5ms timeout
still spent 144-183ms in native enumeration, so that workaround was rejected.
Projection and source-index tests forbid extra enumeration; mutation checks
confirmed the guards fail when removed. The source indexing hook never introduces
extra copies of payload data or changes Flue event/persistence fields.

Error projection includes non-enumerable message/cause/classification fields and
labels inaccessible accessors. Structured JSON tool-argument strings are redacted
semantically; incomplete fragments are explicitly omitted. Known numeric token
counts survive redaction while credential-like token fields remain redacted.
Oversize BigInts and unsupported values have bounded omission paths.

Background dispatch now records an invocation/admission join and keeps a bounded
10,000-invocation index for detached Flue execution parents and consent epochs.
Titling retains first-admission context through deferred work and retries, with
its real runtime instance distinct from diagnostic conversation scope. Ephemeral
improve/describe instances have no product content scope. Media adapter dispatch
records resolved model/protocol/slot, and detached jobs retain model/slot/shape.
New focused tests cover reuse, cross-agent mismatch, epoch changes and eviction;
final mutation and real-runtime verification of these additions remain open.
The HTTP fetch observer now avoids body getters and preserves exact responses
when metadata inspection fails; focused fetch/job tests passed all ten tests.

Remaining coverage work must not be lost: broader native delivery and UI/display fixtures; final
coverage inventory and end-to-end joins; remaining mutation checks; final full
harness/client/native gates and repeat review. Provider response-byte taps must
respect backpressure; an eager `Response.clone()` reader is not an acceptable
shortcut. The external collector/inspector remains a separate second task.
- `git diff --check`: passed. New tests still require the repository's mutation
  verification procedure. Native clippy, full native checks and a final repeat
  review remain open. Do not describe focused passes as full certification.

The original audit/design is in `studio-inspector-plan.md`; its historical
findings describe the pre-implementation baseline. This tracker is the source of
truth for implementation progress, not evidence that the whole goal is complete.

## Latest boundary verification

- Full harness run 5889 ended: 2,427 passed, 28 skipped, three failures across
  184 files. The failures are new assertions against modules already transformed
  before their fixes (media dispatch/job target metadata and HTTP metadata guard).
  Fresh focused runs pass those cases. This mixed-source run is not a green gate.
- Review #6 completed read-only. Its P1 finding (persistent Flue worker context
  overriding an indexed invocation) is repaired by preferring the index at a
  detached top-level entry. Descendants retain their immediate parent. A direct
  interceptor test verifies both request identity and old consent fencing.
- Mutation batch #6: removing invocation-parent preference, submission epoch
  checking, abort classification, returned-tool-error classification, job target
  metadata and deferred titling context produced six failures in five harness
  files. Removing the outage badge and native stale-receipt check also failed
  their respective fixtures. All mutations restored. Logs under `%TEMP%`:
  `studio-observability-mutations6-{harness,client,native}.log`.
- Native real-loopback delivery fixture passed; it exercises the actual JSON
  contract and authentication, duplicate receipt, stale receipt, malformed body,
  over-count and failed HTTP response. The client badge tests passed both cases;
  the real paced-text display fixture passed with original message/block joins,
  first/settled DOM commits, no duplicate commits and no captured display body.
- Native command ingress now records fixed command labels and UUIDs at the shared
  IPC handler. Arguments remain excluded, diagnostic controls do not self-record,
  and unrecognized names do not become event data. Arrival is not completion;
  command-specific outcomes and IPC-to-transport causal joins remain unsupported.
- Rebuilt combined harness slice passed all 76 tests in ten files, log
  `%TEMP%/studio-observability-final-slice6.log`; it includes real titling/admission
  joins and the source bridge. Later native ingress changed the ingestion schema,
  so a final full rebuild/check remains necessary.
- Mutation batch #7 confirmed failures for invocation index retention, request-body
  accessor reads, missing native command ingestion, premature final DOM commits
  and diagnostic-command self-recording. All mutations restored; fresh focused
  runs passed 16 harness tests, three client fixtures and three native fixtures.
- Full gate #7 was deliberately stopped before source edits to fix direct
  submissions inheriting an unrelated worker context. Admission now indexes them
  too, and runtime facts re-enter the known invocation context when the worker is
  unrelated. Both real integration suites passed; their combined run's sole
  failure was a new duplicate-receipt index fixture, now fixed and rechecked.
- Review #7 completed read-only. Nameless streamed JSON arguments now receive
  semantic redaction/incomplete-fragment omission. Native service command arrivals
  are excluded because the detailed service observer owns diagnostic route
  suppression. The latest diagnostics fixture passes all three native cases.
- Local performance acceptance budget: for the measured small and 5KB serialized
  fixtures, added recorder batch-average cost below 1ms/event and retention within
  configured count/byte limits. Seven 1,000-event samples measured enabled median
  0.052ms/event (small) and 0.148ms/event (bounded), maximum batch averages 0.072ms
  and 0.160ms; disabled medians 0.00027ms and 0.00060ms. The larger fixture retained
  733 events/4,189,743 bytes under the default 4MiB cap, with no dropped events.
  These are local batch measurements, not per-event worst-case guarantees.
- Additional boundary repairs: owner-discovery IPC calls also exclude themselves
  from native command capture. Error classification uses fixed known names and
  descriptor reads; arbitrary names/accessors remain content-only/unclassified.
  Response status/ok uses platform getters, preserving responses without invoking
  provider overrides. New tests and deliberate mutations verified both changes.
- Mutation batch #8 produced four expected harness failures for direct admission
  indexing, unrelated-worker consent restoration, duplicate-receipt replacement
  and nameless JSON argument redaction; the native self-poll mutation failed too.
  Batch #9 produced both expected failures for error-name leakage and response
  accessor invocation. All mutations restored. Fresh run: six files/41 tests pass;
  native diagnostics pass three fixtures. Typecheck and targeted lint pass.
- Full attempt #9 stopped at lint on an unsafe descriptor assignment, before
  running the suites. The value now narrows from `unknown`; targeted lint and
  typecheck pass. Full attempt #10 (session 55050) was deliberately stopped for
  the review #8 repair below; it is not a passed gate.
  `%TEMP%/studio-observability-final-full10.log` runs harness then client;
  successful completion proceeds to native tests and Clippy in logs
  `studio-observability-final-{native,clippy}10.log`. A source SHA256 manifest is
  `%TEMP%/studio-observability-full10-source-manifest.txt`. Do not edit source
  during a final gate. Review #8 completed in session 58168, log
  `%TEMP%/studio-observability-review8.log`.
- Review #8 found typed Responses argument fragments still entering `delta`.
  The repair also covers Pi tool-call deltas, Anthropic partial JSON and nested
  Completions arguments. All explicitly omit fragments, even syntactically valid
  JSON scalars; complete standalone argument objects are structurally redacted.
  Final tool/runtime arguments remain separate evidence. Provider callbacks keep
  their exact original objects and normal text deltas. Generic direct-agent
  admission indexing now covers future agent routes too, without making their
  instances product conversation scopes.
- Mutation batch #10 failed three checks as expected for fragment privacy,
  scalar-argument omission and future-agent admission identity. Restored source
  passes six files/44 tests, typecheck and targeted lint. The earlier partial-JSON
  fixture now asserts the more precise argument-fragment omission reason; its
  privacy requirement is unchanged.
- Full attempt #11, session 44589, was stopped for the connection-identity and
  integration-coverage audit. It is not a completed gate. Its log is
  `%TEMP%/studio-observability-final-full11.log`, followed only on success by
  `studio-observability-final-{native,clippy}11.log`. Source manifest:
  `studio-observability-full11-source-manifest.txt`. Review #9 is session 65994,
  log `%TEMP%/studio-observability-review9.log`. Both remain unverified at this
  checkpoint. No external inspector work has started.

## Live failure and admission-source audit

- Reviews #10, #11 and #12 completed read-only without concrete P1/P2 findings in
  their scopes. Logs: `%TEMP%/studio-observability-review{10,11,12}.log`.
- Media binding now includes selected connection ID; polled job identities include
  opaque `externalJobId` alongside Studio `jobId`. Abort/stream/history paths keep
  instance/conversation identity without replacing the active invocation.
- Mutation batches #11-13 verified self-parent protection, binding connection ID,
  quoted-text credential redaction, abort non-admission and provider job mapping.
  All restored. Fresh focused checks passed 74 tests in six files, typecheck/lint;
  client badge/display fixtures passed three tests and client typecheck.
- Quoted JSON/compound credential fields and complete quoted passphrases are now
  redacted in text too. The field-name matcher is bounded. Seven local samples of
  9K/90K/900K repeated identifier characters averaged 0.162/0.491/4.528ms through
  the full text rule set. These are measurements, not universal CPU guarantees.
- New real-harness refusal/cancellation assertions initially failed. A temporary
  isolated probe confirmed that Flue's nested session prompt omits submissionId;
  treating it as another durable entry discarded the parent's submission link.
  Nested prompts now inherit the active submission/parent/consent. Model
  interception is explicitly a stream step, not a count of provider attempts.
- The scripted `askme` model repeats after a denied write by design. The fixture
  now verifies refusal and absence of execution, then cancels its next ask; it
  does not require a successful final answer from that scripted loop. Both real
  failure cases passed after the parent fix (`failure-slice15.log`).
- Missing/evicted admission proof now withholds old/recovered content as
  `start_unobserved`, including terminal aggregates outside an execution context.
  Replayed receipts do not recreate an evicted execution's parent/consent.
- Flue patch recipe #12 adds identity-only hooks at the actual direct/dispatch
  admission sites, before worker scheduling. They carry no body/credential data
  and contain callback failures. Producer-context mapping handles concurrent
  requests without borrowing the latest pending instance. Failed admissions
  remove provisional candidates; ambiguous request families remain unlinked.
- The rebuilt observability suite passed all seven integration cases, including
  concurrent enqueue-to-request and model-to-submission joins. Log:
  `%TEMP%/studio-observability-admission-source16.log`. Registry/capture focused
  checks passed 49 tests in five files, with typecheck/lint.
- Mutation batch #14 produced six expected unit failures for nested parent,
  missing consent proof, deduplication, producer mapping and refused-candidate
  cleanup. All restored. Batch #15 produced all three expected integration
  failures (concurrent identity, refusal and cancellation), log
  `%TEMP%/studio-observability-mutations15.log`. The hook-throw test completed its
  expected product replies before failing on the missing identity, proving the
  optional hook's failure containment. Source was restored and rebuilt afterward.
- Patch-commit kept package versions unchanged; the lockfile changes are patch
  hash references only. Generated trailing patch-header tabs were removed.
  Offline installation and frozen-lockfile verification passed afterward.
- The final rebuilt slice passed all ten tests in the observability and tasks
  suites (`%TEMP%/studio-observability-final-slice17.log`). Read-only review #13
  completed without actionable P1/P2 findings in the invocation/context/source
  repairs; log `%TEMP%/studio-observability-review13.log`.
- Full gate #18 has started with source held fixed. Root `pnpm check` runs harness
  then client; only success proceeds to native tests and denied-warning Clippy.
  Logs: `%TEMP%/studio-observability-final-{full,native,clippy}18.log`. Source and
  dependency SHA256 manifest: `studio-observability-full18-source-manifest.txt`.
  Do not certify readiness until the actual completion results and unchanged
  manifest have been inspected. External inspector work remains unstarted.
- At 2026-10-17 05:39, session 9119 was missing and no harness/native test
  process remained. Gate #18 has no completion summary and is not a pass.
  Comparing all 1,203 source/dependency manifest entries found zero changes.
  Gate #19 restarts the sequential root/native checks from that unchanged state;
  logs and manifest use the same names with `19` in place of `18`.
- A temporary checkout of the staged client passed application/tooling
  typechecks and both observation UI files (three tests). The initial staged
  typecheck exposed an omitted provider mock update; its four diagnostic method
  stubs are now included in the commit scope. Shared UI/native files were staged
  by instrumentation hunks only, preserving unrelated working-tree changes.
  Logs: `%TEMP%/studio-observability-staged-{client,fixtures}19.log`. This proves
  the staged client compiles independently; it is not a full staged-tree suite.
- Gate #19 completed the full harness check: 184 files passed, two skipped;
  2,448 tests passed, 28 skipped. The client typecheck passed, then lint found
  an unnecessary assertion in the new capture-badge fixture. The fixture now
  uses an explicit variable type. Manifest comparison confirms that this is
  the only changed entry among 1,203 files; no harness/native source changed.
  Gate #20 runs the full client check followed, only on success, by native
  tests and denied-warning Clippy. Logs:
  `%TEMP%/studio-observability-final-{client,native,clippy}20.log`; frozen source
  manifest: `studio-observability-full20-source-manifest.txt`.
- Gate #20 passed client typecheck/lint and all 169 files / 1,534 tests.
  Vitest exited zero but reported a fork-worker termination timeout for the
  unchanged `running-mark.test.tsx`. Its isolated rerun passed all five tests
  without that warning (`studio-observability-running-mark20.log`). A full client
  repeat, log `studio-observability-final-client21.log`, checks reproducibility
  under suite load; no source changes were made for it.
- Native gate #20 passed all 142 tests, including real harness lifecycle and
  transport fixtures; Clippy passed with `--all-targets -- -D warnings`.
  Source audit after all gates compared 1,203 entries with zero mismatches.
  Final manifest SHA256:
  `2A91143DC5990A365435AEC3CDFA9C6E38EC63D78E90013C20DE42D38FE15BB3`.
- Full client repeat #21 passed typecheck/lint and all 169 files / 1,534 tests
  without a worker-shutdown warning. Source remained unchanged. The warning in
  #20 was not reproduced in either the isolated fixture or the full repeat;
  no unrelated test or product behavior was changed to suppress it.

## Stage A closure audit

| Acceptance requirement | Final evidence |
| --- | --- |
| A1: cryptographic identity ownership, external namespaces and actual retry families | Central generators; unchanged stored IDs; distinct request/invocation/submission/attempt/event/boot/stream IDs. UUID, MCP restart, invocation, title and media fixtures; full harness/client/native checks passed. |
| A2: versioned execution/delivery contract and honest coverage inventory | Version 1 contracts and the inventory above; distinct source/collector clocks and loss states. Real HTTP readers verify admitted scope and joins; client/native schemas and command policy have parity tests. Unsupported evidence remains explicit. |
| A3: passive bounded capture under user control | Disabled default; selected conversation content; capture epochs, stop/clear/export and persistent status. Provider/error/accessor and exact-result fixtures, native transport fixtures, retention and mutation proofs passed. No account, cloud upload or production telemetry backend added. |
| A4: critical success/failure paths, review, performance and complete gates | Successive/concurrent submissions, tool refusal, cancellation and title joins pass rebuilt integration tests. Failure/retry/reconnect/recovery/loss fixtures are covered by the full suites. Thirteen scoped review passes and restored mutation batches; measured recorder budget met. Harness: 2,448 passed / 28 skipped; client: 1,534 passed; native: 142 passed; Clippy warnings denied. Final source hashes unchanged. |

The original audit recorded focused pre-implementation checks, not a clean full
suite baseline. Earlier passing counts in this log are implementation checkpoints
and must not be presented as a before/after full-suite comparison. The full gates
exercise the combined working tree; the separately staged client also passed its
application/tooling typechecks and three observation UI tests. Unrelated UI edits
remain outside the instrumentation commit. No merge or commit on `main` is made.

This tracker stays at its requested path as the ongoing boundary inventory for
future features. The durable developer contract and AGENTS/CLAUDE instructions
define how new work inherits identity and capture. Stage B is a separate project;
its implementation and verification now live in
[Studio Inspector progress](studio-inspector-progress.md). The new opt-in desktop
sharing boundary is described in the durable observability contract. It is
diagnostic self-control, excludes itself from capture and preserves source policy.
