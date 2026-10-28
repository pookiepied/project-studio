# Interactive voice and computer use: execution plan (2026-10-28)

The plan for the brief "Implement Studio's interactive voice and computer-use
architecture". Every claim under "Verified state" was read from the code on
2026-10-28, not taken from earlier plans. Decisions are final unless a
validation checkpoint below disproves an assumption it names.

## Verified state (the starting point)

Voice
- Cascade: mic -> 500 ms silence after >=120 ms speech (`useVoiceMode.ts:266`)
  -> transcription -> voice model -> phrase TTS (`streamingSpeech.ts`, 6,000
  char cap) -> playback. Speech arrives as a `voice_input` signal on the
  canonical conversation (`turn-settings.ts:145`, client `conversation.ts:538`).
- The voice role is the Studio agent itself rendering in voice mode
  (`agents/studio.ts:186-227`), on `voiceModel()` with the quietest thinking
  level. Tools: `voice_work`, `task_activity` (status/inspect), and native
  `read` limited to conversation images (`studio-runtime.ts:2387,2415`,
  `voice-policy.ts`). Its sandbox `agentId` is `voice`, so its grants are its own.
- `VOICE_PROMPT` makes screen observation, browsing and workspace work
  delegation-only. The capability overview tells it "You cannot call any of these".
- Barge-in: `hold()` pauses audio, generation continues; silence/continuer
  releases; real speech `interrupt()`s. The Interrupt button calls `interrupt()`,
  which stops audio **and aborts generation** (`abortRun`). It never cancels workers.
- Worker completion reaches the voice agent as a signal through the JobPings
  hub (`app.ts:239`), so "completion -> spoken result" already exists.
- Permission prompts already render inside the voice overlay (`usePendingApprovals`).

Workers
- `voice-work`: `model: { inherit: true }`, `maxAttempts: 1`, 1 h timeout;
  renders the full Studio prompt via `renderStudio(parent, "voice-work")`. Task
  body = fallible context summary + verbatim utterance (`voiceTaskBody`).
- Steering: `steerTask` dispatches `deliveryMode: "steer"` with an admission key
  (dedup). Flue applies it at the next model/tool-batch boundary only.
- Queued tasks live in process memory (`#voiceQueue`), restart drops them.

Computer
- One MCP child process. `ComputerSession` per `_meta["studio/conversation"]`
  (workers resolve to their parent conversation, so **a worker, the voice
  agent and every delegate of one chat share one session and one driver**).
- `DesktopControl` (`control.ts`) keeps one owner **session** (= conversation),
  held while that driver runs or releases, i.e. until Stop or a 5-minute idle
  close. It serializes **every** tool of **every** conversation on one tail, so
  a screenshot in chat B waits behind chat A's 20-step batch.
- `ComputerSession.#interactionEpoch` fences queued calls on any error or stop.
  It is per conversation: one actor's failure cancels another actor's queued calls.
- `read_ui` is already in `INPUT_TOOLS` (it retargets the driver and resets refs).
- Stop (`close()`) fences input immediately, lets the active request settle
  within its deadline, releases held input in the driver's `finally`, and keeps
  the fence until real exit. This is correct and is kept as is.
- The driver is a single-threaded PowerShell loop. Native calls are serial per
  conversation; there is no concurrent native operation to promise.
- `activity.cs` already has a click-through, no-activate, topmost WinForms
  overlay (`Marker`, ExStyle `0x080800A0`, `WM_NCHITTEST -> HTTRANSPARENT`) that
  window discovery excludes (`IsOverlay`). It is a cursor badge, not annotation.
- Mismatch found: the harness MCP request deadline is 30 s
  (`connection.ts:82`) while the driver allows 60 s (`session.ts`). A long
  batch can time out on the harness side while the driver keeps acting.
- Every computer tool is `effects: ["execute","network"]`, author `studio`, so
  the kernel asks once per tool per agent scope (`policy.ts:176`).

Platform limits of this environment
- Linux container, Node 22.22 (repo pins 24.19; `engines` floor 22.19 passes).
  The driver is Windows-only and its native tests `skipIf(!win32)`. No
  microphone, display, overlay, focus or DPI behaviour can be exercised here.
  No provider API key is present, so model-backed routing evaluation cannot run here.
- Harness baseline, measured 2026-10-28 on the untouched tree (`CI=true pnpm -C
  "STUDIO HARNESS" check`, 18 min): typecheck and lint pass; tests 2,618
  passed, **10 failed**, 62 skipped (207 files). The 10 fail on this container's
  environment, not on code under change: `sandbox-bwrap` (no user namespaces),
  `browser-server` (no browser installed), `customization-connections` x5 (no
  npm in the installation), `conversation-export` x2, and one more in the same
  five files. They are the known-failure list below. The client baseline is
  recorded in Stage 1.

## Final architecture (decisions)

**D1 Actor identity.** An actor is the Flue agent instance making the call:
`currentExecutionContext().flueInstanceId` at MCP call time. Conversation agent
(text or voice) = the conversation id; a voice worker = `voice_<uuid>`; inline
delegates act under their parent instance (the "owner responsible"). The
harness adds `_meta["studio/actor"]` and `_meta["studio/role"]`
(`conversation|voice|worker`) for system servers only; models never supply them.
Fallback when the context lacks an instance: the conversation id (checked in Stage 1).

**D2 Desktop lease, in the existing `DesktopControl`, not beside it.** State:
`{ conversation, actor, generation, mode: active|paused|demonstrating|stopping }`
plus, per actor, the generation of its last observation. Rules:
- Input tools (current `INPUT_TOOLS`, plus `clipboard` and new `mark` stays
  observation) require: actor == owner, mode == active, and the actor has
  observed in the current generation. Otherwise a structured refusal
  `{ desktop: { refused: "not_owner"|"paused"|"demonstrating"|"stopping"|"observe_first", owner: { conversationSelf: bool, taskName?, taskId? } } }`.
  Another conversation's owner is named only as "another chat"; no ids, titles or content.
- Acquisition is implicit on the first input call when the desktop is free (keeps
  today's worker flow) and explicit through `studio_computer_control acquire`.
  Every ownership change, pause, resume, demonstration end and stop increments
  `generation`. A new generation means "observe first", so fresh observation
  after handoff/resume is enforced by code, not prompt.
- Each call captures `(actor, generation)` at admission. Each driver request
  inside it (every batch step) rechecks it. A late call, a stale continuation or a
  same-task reacquire with old queued calls is refused, never queued.
- Release: explicit `release`; the owner's submission settling (subscribe to
  the same `submission_settled` bus the task projector reads, then call the
  server's control RPC only if it is already `ready`); Stop; idle close; voice close
  for the conversation actor. Refusals never queue an action for later.
- The per-session `#interactionEpoch` becomes per-actor so one actor's error no
  longer fences a sibling's queued calls. Stop still fences all actors of the chat.
- Observation tools (displays, screenshot, zoom, cursor, status, windows, apps,
  wait_for_window, `control status/latest`) are admitted for any authorized
  actor. Across conversations they no longer wait on the global tail (separate
  drivers). Within one conversation they share the driver queue and wait for the
  owner's current call (documented; the shared glance below answers without waiting).
- Ownership is coordination only. The kernel still decides every call under the
  calling agent's own scope; nothing borrows another actor's grants.

**D3 Handoff protocol (implemented in `DesktopControl` + `ComputerSession`).**
`handoff(to)` = (1) set mode `paused` for the old owner and bump generation (fence);
(2) drop that actor's queued calls (they fail generation check); (3) await its
in-flight driver request within the existing deadline, or report `uncertain`;
(4) driver op `release_held` (calls existing `Release-HeldInput`);
(5) `status` read succeeds -> admit new owner; (6) new owner starts
`observe_first`; (7) the old owner must reacquire and observe. No replay anywhere.

**D4 User control operations (four, kept distinct).**
- Pause speech = existing `hold()` / Interrupt (unchanged mechanics; Interrupt
  relabelled "Stop talking", tooltip says work continues).
- Redirect = `voice_work steer` (unchanged identity/dedup) **plus a lease
  checkpoint**: if the target task owns the desktop, its generation is bumped,
  so its remaining batch steps are refused ("a correction arrived") and the steer
  lands at that boundary; the task must reobserve. Settled task -> explicit `continue`.
- Pause computer = `pause` (fence + release held input, task kept alive). A paused
  worker's computer calls return `paused`. It calls `control wait` (blocks up to
  20 s, under the 30 s MCP deadline, abortable), so a pause costs one cheap model
  step per 20 s, not a spin.
- Stop computer = existing Stop path (fence, driver close, cancel computer-driving
  tasks) with lease mode `stopping` until exit is confirmed. The UI shows
  "Stop requested", "Stopped" or "Stopped, cleanup not confirmed".
- Human demonstration ("let me show you") = `demonstrate`: pause whoever owns, mode
  `demonstrating`, the overlay shows "You have the desktop" with Done. Done = resume
  with a new generation.
- Control lane: new HTTP routes (below) used by buttons directly, with no model
  round trip. A client-side command matcher runs on **final** transcripts only,
  whole-utterance, normalized, strict grammar ("stop using my computer", "stop
  computer", "pause", "wait let me show you", "let me show you", "continue"/"resume"
  only when something is paused, "stop <Name>" only when exactly one task has that
  name). Anything else goes to the model. After executing, the utterance is still
  submitted, with signal attribute `control="<what the runtime did and its result>"`,
  so the agent acknowledges real state and does not repeat it.

**D5 Shared interaction context.**
- Driver `screenshot` also samples the cursor in the same op, so pointer and image
  are one observation with a measured skew.
- The server keeps one **latest observation per conversation**: observation id,
  capture time, actor, display index and frame, region, image size and scale,
  pointer, foreground window, generation, bytes (<=1 MB, the existing budget).
  A newer one replaces it; there is no queue. It is marked stale on a generation
  change, on non-injected input reported since, or after a 15 s age.
- `studio_computer_control latest` returns that picture with its labels to any
  actor of the same conversation, so the voice agent sees the worker's actual
  frame. Task status never carries bytes.
- Screen sharing: an explicit per-conversation toggle in the voice overlay
  (default off, process memory, cleared on voice close and harness restart).
  Off -> the voice role's observation tools are hidden and refused, and a
  result produced after sharing ended is delivered without its image
  ("sharing ended"). Workers keep today's permission-governed behaviour.
- Dynamic context: at each voice turn start, `useAgentStart` appends one bounded
  (<=1.5 KB) `interaction_context` signal: sharing on/off, latest observation meta
  and age, owner/mode, pending marks, worker lines. It is runtime-owned, built from
  the last state the server reported (every computer result carries
  `structuredContent.desktop`), and labelled as a snapshot that the tool boundary
  rechecks. Screen text inside it is marked untrusted. No prompt rewrite per mouse move.

**D6 Voice direct surface.** In voice mode the agent gets, in addition to its
current tools, these `studio-computer` tools only (and only while the server is
enabled for the conversation and sharing is on): displays, screenshot, zoom,
cursor, status, windows, apps, control, read_ui, act, set_value, click, type,
key, scroll, focus, open, mark, batch. The server caps batch at 6 steps for role
`voice`. Not offered: drag, mouse_button, hold_key, clipboard, wait,
wait_for_window, arrange, select_text, move, stop (Stop is a user control).
Browser, files and web stay delegated in this change (out of scope, stated in the prompt).

**D7 Annotation.**
- Agent marks: `studio_computer_mark { observationId, display, shape:
  pointer|rect|circle, x, y, w?, h?, label? }`. It is refused unless
  `observationId` is the latest shared observation and its frame matches the
  display. The driver shows it on a second click-through, no-activate overlay
  (the `Marker` pattern), excluded from discovery by `IsOverlay`, and from capture
  with `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` where Windows supports
  it (reported when not). It expires after 8 s, or hides and reports stale when the
  foreground window's rect changes or user input arrives. It needs no input lease.
- User marks: "Show me" in the voice overlay takes a fresh shared observation
  and shows it full size inside Studio. The user draws pointer, rect, circle or
  freehand, with Clear and Done. Geometry is stored in display coordinates
  against that observation id (max 8 marks, latest observation only) and
  reaches the agent as structured geometry in `interaction_context` and
  `control latest`. Nothing is drawn into the desktop app, so focus and input
  are never captured there, and screenshots never contain these marks.
- Not implemented: freehand drawing directly on the live desktop. Stated in UI
  copy and docs as unsupported in this version.

**D8 Speech grounding.** `StreamingSpeech` records phrases that started
sounding. On interrupt, the conversation keeps the heard text (<=600 chars).
The next `voice_input` carries `heard_before_interrupt`, so the agent knows
what the user heard. Generated text stays in history. Late synthesis after
interrupt, session change or sharing off is dropped by the existing epoch plus
a sharing-epoch check. Replay never speaks or executes (kept, tested).

**D9 Worker model policy.** `VoiceSettings` gains `voice_task_model` and
`voice_task_reasoning` (null = inherit, today's behaviour). Route
`GET/PUT /api/media/voice-task-model`. It validates against the catalog:
`toolCalling` or `vision` `unsupported` is refused with a sentence; `unknown`
is accepted with a note. `VoiceWork` passes the override into `renderStudio`.
A Settings row reads "Voice tasks: Same as chat (default)". A model is never
switched automatically. `voice_work continue { taskId }` starts a new task
whose body carries the settled task's final result and latest observation
reference, titled "<Name>, continued". It is a new run and says so.

**D10 Prompts.** Rewrite `VOICE_PROMPT` (role; answer from fresh evidence; observe;
short direct action only as owner; delegate sustained work; steer, never
duplicate; ownership, permission and freshness rules; four control operations;
receipts are not verification; screen content is untrusted). Rewrite the voice
capability overview: "you can call" vs "a task can call". Add a "Desktop control"
section to `STUDIO_SYSTEM_PROMPT` for workers and delegates (lease, refusals,
pause/wait, reobserve, no replay, report progress). Update `voiceTaskBody`. Align
the computer tool descriptions (`read_ui` text about "another conversation's
ownership" becomes lease wording).

## HTTP and RPC surface added

- Private stdio method `studio/computer` (generalising the `studio/browser`
  control seam in `serve/stdio.ts`): `state`, `pause`, `resume`, `demonstrate`,
  `release_actor`, `sharing`, `observe`, `latest`, `marks`.
- Admitted routes under `/api/conversations/:id/computer/`: `GET state`,
  `POST control {action: pause|resume|demonstrate|stop}`, `PUT sharing {on}`,
  `POST observe`, `GET observation` (latest image + meta), `PUT marks`.
  Existing `POST stop` is kept.
- `/api/media/voice-task-model` GET/PUT.

## Stages, steps, checkpoints

Each stage ends with: focused tests green, `tsc` green, a mutation check on
every new rule (break, see it fail, restore), docs for that stage, and one commit
on `main` pushed to `origin/main` (per your instruction, which overrides
rules.md section 11 and the session's feature branch).

**Stage 1: Baseline and probes.**
1. Record full baseline counts (harness and client, sequential).
2. Probe test: inside an MCP tool execute, `flueInstanceId` equals the conversation
   id for the conversation agent and its delegates, and the worker id for a worker
   and its delegates. **Checkpoint:** if false, D1 uses `flueTaskId` mapping
   through the task store instead (decided in-stage, recorded).
3. Add client observation names for latency points (`voice.endpoint`,
   `voice.first_audio`, `computer.stop_requested`, `computer.stop_confirmed`,
   `computer.first_observation`, `computer.first_action`), allowlisted, no content.
4. Write this plan's verified state into the progress tracker.

**Stage 2: Lease, fencing, handoff, pause/stop.** (`computer/control.ts`,
`session.ts`, `server.ts`, `tools.ts` control tool, `serve/stdio.ts`,
`extend/mcp/capabilities.ts` meta, runtime settlement release, routes)
Tests (`computer-lease.test.ts`, extended `computer-session-input.test.ts`, with
a fake driver child): voice vs worker owner; two workers in a chat; two chats;
handoff between batch steps; late call after handoff; same-task reacquire with
stale queued call; stop during typing, held modifier or drag (fake driver holds
then releases); native timeout with uncertain outcome; unconfirmed exit keeps the
fence; driver restart invalidates refs and generation; pending approval when pause
arrives (approval later succeeds, but the call is refused at admission recheck);
transport drop during handoff; no silent queueing; refusal leaks no other-chat
identity; observation admitted for a non-owner; cross-chat observation not blocked.
**Checkpoint:** the existing computer suites stay green except the tool-count
assertion 27 -> 28 (explained in the report).

**Stage 3: Direct screen awareness.** Cursor sampled with screenshot; latest
shared observation; staleness; sharing toggle; voice tool exposure (D6 list) and
call-time refusal; `interaction_context` signal; `control latest`.
Tests: exposure set exact; sharing off hides and refuses; result after sharing off
is stripped; pointer is never paired with an older image; staleness after input
or generation change; bounded context size; screen text is labelled untrusted;
capture epoch (late callback after capture cleared carries no content).

**Stage 4: Direct bounded action + prompts.** Voice batch cap; ownership
refusal flows; prompt rewrite (D10); overview rewrite; tool descriptions.
Tests: composition checks on the **assembled** voice and worker prompts (no
"require voice_work" for screen questions, no "You cannot call any of these" for
granted tools, lease and four-operations wording in both, workers told about
pause/wait/reobserve); unavailable tools absent from the overview.
**Checkpoint:** routing eval script `tests/eval/voice-routing.ts` (opt-in, needs
a key, not part of `check`) with the seven brief scenarios. It is runnable on your
machine, but **not run here** (no key).

**Stage 5: Demonstrate and annotation.** `demonstrate` flow + overlay UI; driver
mark overlay (C#), `mark` tool; client "Show me" snapshot canvas with four tools.
Tests: mark refused on a superseded observation or wrong display frame; mark
geometry maps across scale, negative origins and a second display; marks
bounded; demonstrate fences input and resume demands observation; client canvas
geometry round-trip; overlay excluded from discovery (pure policy test). The C#
compiles and runs only on Windows: **unverified here**.

**Stage 6: Worker policy, continuation, speech grounding, UI controls.** D9
settings, route and UI; `continue`; redirect checkpoint; `heard_before_interrupt`;
voice overlay buttons (Stop talking, Pause/Resume computer, Stop computer,
Show me, Share screen); control matcher; voice close policy (below).
Tests: inherit when unset; incompatible model refused; steer dedup unchanged;
correction on a queued task merges and on a settled task offers continue; ambiguous
"stop that" with two tasks goes to the model; "What does Stop mean here?" goes to the
model; "Yeah, keep going" cancels nothing; partial transcript never triggers; late
synthesis after interrupt dropped; replay silent; several completions while
speaking are queued, not spoken over the user.

Voice close policy (K): closing voice releases the conversation actor's lease,
turns sharing off and clears user marks. Workers keep running and keep their
lease. The desktop pill stays visible with Stop while any worker drives. Nothing
is cancelled implicitly.

**Stage 7: Full verification and docs.** Run `pnpm -C "STUDIO HARNESS" check`
then `pnpm -C STUDIO check`, sequentially. `cargo test` only if `src-tauri`
changes (the plan does not change it). Update `observability.md` (feature
checklist entries for lease, control, shared observation, marks, sharing, voice
commands), the progress tracker, `retry.md` (no new retry authority; the uncertain
timeout is explicitly not retried), `api-inventory.md`, the harness README map,
and ADR 0059 "The desktop has one hand" (lease, generation, the four operations).
Write `report/voice-computer-interaction.md` with the per-scenario table from
brief section 12 (admitted / maybe dispatched / owner / cleanup / valid evidence /
told / continuation).

## Risks

- R1 Instance id missing in some frames (Stage 1 probe, fallback named).
- R2 Implicit "observe first" changes worker behaviour: a worker's first input
  after any handoff is refused once. Mitigated by refusal text, the prompt, and
  existing tests updated with a reason.
- R3 30 s harness deadline vs 60 s driver: kept, but voice batch is capped, and
  a harness timeout is reported as `uncertain` with the lease fenced until the
  driver answers. I will not change the 30 s default (separate decision);
  recorded as a finding.
- R4 Windows-only native code (mark overlay, cursor-with-screenshot, `release_held`)
  cannot be compiled or run here; PowerShell changes are kept minimal and
  covered by contract tests that read the script as text where possible.
- R5 No physical mic/latency/overlay/DPI verification here; no model-backed eval.
- R6 Repo rules conflict: one commit per task and no commits to main. You
  overrode both; I will commit per stage on `main`.

## Completion criteria (the exact stopping point)

Done when **all** of these hold, and I stop there:
1. Stages 1-7 are committed and pushed to `origin/main`.
2. `pnpm -C "STUDIO HARNESS" check` and `pnpm -C STUDIO check`, run
   sequentially: typecheck and lint clean. Every test passes except exactly
   the known environment failures recorded at baseline: the same tests, no
   new ones. Passed counts are at or above the baseline plus the new tests. A
   fully green run is not reachable in this container, and the report says so.
3. Every new rule has a test that was seen failing under mutation (listed in the report).
4. The docs listed in Stage 7 are updated, ADR 0059 is written, and the report
   carries the section-12 scenario table.
5. The report lists, without hedging, what was **not** verified here: Windows
   driver and overlay execution, microphone, real latency distributions, DPI and
   multi-monitor behaviour, and model-backed routing. It also gives the exact
   commands and the hands-on checklist for you to run on Windows.

Stop and ask you before going on only if:
- a Stage 1 probe disproves D1 and the fallback is also impossible;
- a full check fails for a reason outside this change that I cannot fix in scope;
- a step would need a new dependency, a new permission concept, or a change
  under `src-tauri`.

Otherwise I do not ask; routine engineering choices are mine and are recorded
in the report.
