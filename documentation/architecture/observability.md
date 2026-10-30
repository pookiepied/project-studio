# Identity and observations: developer contract

Voice conversations reuse the Studio conversation and canonical submission
stream. `voice_input` is a user transcription carried as a typed signal, not a
second chat store. Voice settings changes use `voice.settings`; worker admission
uses `voice.work` and the existing observed background dispatcher; a task
queued behind the shared agent limit starts later under `voice.work.dequeue`
with the id it was admitted under. The queue is process memory: a restart
drops queued tasks, which never started and are not resent. Worker IDs are
minted through the central UUID generator in a durable step, then reused on
recovery without an automatic resend. `task.steer` retains the initiating
execution parent, consent epoch and admission receipt through the existing
invocation index. Durable coordination retains a separate admission key for
steering deduplication; correlation IDs alone do not provide this guarantee.
Steering admission and cancellation requests are not proof of
application or confirmed termination. The original host submission's settlement,
not a steering receipt's settlement, ends an indexed worker.

`task_activity` and `/api/tasks/activity` expose a bounded, process-local product
projection for inline delegates and independently addressable workers. Only task
identity, registered agent identity, parent conversation, timestamps, fixed
lifecycle stages and whether the task has driven the computer are retained. No
prompts, arguments, results or reasoning enter this projection. The separate
`inspect` action (operation `task.inspect`, counts-only attributes) returns one
task's recent steps to its owning conversation's agents only, never over HTTP:
assistant text, tool names and redacted, bounded arguments and results, with
reasoning, image bytes and typed text or keys excluded. It is model-facing tool
content under existing gated capture. It is not diagnostic capture, a durable task journal, an
execution authority or proof of completion when evidence is absent. Restart,
eviction and missing events can make progress unavailable. Existing HTTP,
framework-tool, runtime lifecycle and media gateway boundaries observe these
paths; audio frames and microphone levels do not enter diagnostic attributes.

This contract applies to all current and new Project Studio features. The harness
owns execution. Observations explain execution without changing it. The external
inspector will consume this contract later; it is not implemented here.

## Identity ownership

Use cryptographic UUIDv4 for Studio-created identities, preserving entity prefixes
where the domain uses them. Use the central generators in each runtime. A paired
HTTP browser may lack `crypto.randomUUID`; the client uses cryptographic
`getRandomValues` to produce UUIDv4 in that environment. There is no Math.random
fallback. Existing stored IDs remain valid opaque strings.

| ID | Meaning |
| --- | --- |
| Entity/conversation | Stable domain record identity; reuse it across interactions. |
| Request/interaction | One client action; propagate across transport and acknowledgement. |
| Logical operation | One unit of work, linked to its parent. |
| Attempt | One execution of that work. A retry changes attempt ID, not operation ID. |
| Event | Unique immutable observation, with process-local sequence. |
| Boot/connection | One process lifetime or transport connection, not the user or conversation. |
| Job | A background process or media generation; new IDs encode UUIDv4 as compact hex after the existing prefix. |
| Flue/provider/MCP identity | External opaque reference; keep its owner namespace. |
| OTel trace/span | Trace correlation, never durable identity or an idempotency key. |

`createRetryExecutionContext(previous)` is available for application-owned retries.
It must wrap an actual retry owner. Do not apply it to unrelated work. Flue owns
its own model turn/recovery identities; these remain explicit links. IDs are not
authorization, idempotency or proof that a side effect completed.

## Standard harness extension path

```ts
import { observeOperation } from "../observability/operation.js";
import { recordObservation } from "../observability/recorder.js";

return observeOperation("provider", "feature.fetch", async () => {
  recordObservation({
    name: "feature.fetch.waiting",
    phase: "progress",
    attributes: { queued: 1 }, // operational facts only
  });
  return service.fetch();
});
```

The operation helper inherits AsyncLocalStorage context, creates a child operation
and attempt, records start and terminal outcome/duration, and preserves the
original resolved object or thrown rejection. Parallel work inherits its own
context. Child domain stages should be separately named so validation, permission
wait, queue time and actual execution remain distinguishable.

Asynchronous provider/transport/interceptor callbacks must retain a writer from
`createObservationWriter()` at operation start. Both successful and failed late
callbacks are rejected after capture deletion or a consent epoch change; product
values and rejections still pass through unchanged. Do not create a fresh writer
inside a terminal callback from an old operation.

Use `OperationObservation` for jobs that return before they finish. Keep it with
the job, use its execution context while driving asynchronous work, and finish it
at the real terminal transition. It preserves the starting parent, emits at most
one end and rejects late evidence from a deleted/replaced capture epoch. A stop
request is recorded as cancellation requested, not proof that a process died.

Background command state follows that distinction in product results too:
`stopping` means cancellation was requested; `stopped` and `endedAt` require
the child's `close` event. The jobs tool and shutdown await a bounded confirmation
window and must not turn a timeout into a confirmed exit. The existing job
operation keeps its identity through `stop_requested` and `process_closed`.
Changing job/delegate status is delivered through the admitted `background_work`
signal and tool results, rather than changing the agent's digested instructions.

Use the existing tool gate for new tools: it covers validation, authorization,
containment, snapshots, queue and execution. Register capabilities through its
registry so tools retain stable capability keys. MCP requests also carry a
connection identity and connection-local RPC ID. Flue observations cover its
agent/task/model/tool/compaction lifecycle; Studio execution observations cover
interceptor boundaries even when a tool batch never commits its terminal event.
Flue also intercepts model stream creation, iterator reads and result access.
`execution.model` therefore labels `stage: interceptor_step`; its completion is
one boundary returning, not a new model request or a completed model turn. Use
`runtime.turn` and `provider.stream` for turn/provider lifetimes and
`provider.http` for actual supported SDK HTTP attempts. Durable submission entries
have `stage: submission`; nested session prompt operations retain their parent's
submission and consent rather than opening another invocation.
Providers use the gateway's `observeProviderStream` rather than importing Pi from
other layers. Media and other non-language providers need their own typed
boundaries; a language observer does not automatically cover them.

Background agents use `dispatchBackgroundAgent`: its invocation operation joins
the admission receipt and detached runtime submission to the initiating request.
A bounded 10,000-invocation process index retains the original execution parent
and consent epoch, including when the same instance is reused. Missing/evicted
links remain unavailable. `agentInstanceId` names the real runtime instance;
`invocationId` names the dispatch operation. Diagnostic product conversation scope
is separate from task notification ownership and the instance used for tool
authorization. Titling keeps its first-admission context through settlement and
retry; ephemeral improve/describe takes do not become product conversations.
Media dispatch events name the resolved model, protocol and capability slot;
`media.binding` also names the selected connection ID. Media job events retain
model/slot/shape across their detached lifetime, with the provider's opaque
`externalJobId` separate from Studio's `jobId` for polled generations.
OpenRouter speech without an explicit voice resolves the selected model's
advertised voice IDs through the existing public catalog cache. The
`media.voice.resolve` operation retains the execution parent and records only
protocol/model identity and outcome; speech text, voice IDs and credentials are
excluded. Catalog HTTP reads retain their existing transport observations.
The direct HTTP client (`net/http.ts`) connects only to addresses the
destination policy judged; when one refuses at connect time (nothing was
sent), it tries the next judged address and records
`net.http.address_fallback` with families, index and socket code only, never
the address, host, URL or error text. A provider-settings write that can change
routable language models runs `provider.language.reload` under the request
that made it; a failed reload is recorded and leaves both the durable write
and the previous runtime in place.
Browser dictation decodes locally to mono PCM WAV before the existing media
transport. This adds no upload boundary or capture setting; provider errors
remain product results, with bounded UI details outside the control row.
HTTP admission also indexes direct invocations for every agent route, including
new agents. Only the Studio agent's instance names a product conversation;
other direct agents retain separate instance identity without gaining content
scope. The optional Flue source bridge binds the actual admitted submission and
deduplication flag in the producer's execution context before workers run. It
passes only agent/instance/submission IDs and a boolean, never a request body.
Pending indexes are bounded with invocation retention, removed on refusal, and
ambiguous producer families are not guessed. An unknown submission never adopts
the most recently observed instance parent. At a durable top-level invocation,
the indexed parent outranks a persistent worker's inherited request context;
genuine descendants retain their immediate execution parent. Repeated admission
receipts do not replace the original execution identity or consent, even after
the old link has been evicted. Abort/stream/history requests retain instance and
conversation identity but do not register new invocations.

## Event and capture contract

Queue promotion reuses the runtime's existing submission ID and queue-control
HTTP request. After success, `client.projection` records the
`queued_message_promoted` stage with conversation/submission identity and no
message content. The transcript shows the admitted message while its reader
resumes from the retained offset; this is delivery recovery, not another
submission or an execution retry. Refused promotions keep the queued message
and surface the error.

During an active model request, a metadata-only check for explicit steering is
scoped to the running host submission, attempt and session. It requests provider
cancellation, joins the correction through the existing durable input path, then
rebuilds context and continues the same host submission. It never aborts or
replays a running tool; steering during a tool waits for the tool batch boundary.
Ordinary queued follow-ups do not interrupt. Stop and the original deadline take
priority over continuation. Providers must acknowledge their cancellation signal;
a cancellation request alone does not prove the provider stopped.

Existing `runtime.log` observations expose only the allowlisted stages
`steering_requested` and `steering_context_ready`, retaining host submission and
conversation identity. Context readiness does not prove model consumption: the
next `runtime.turn_request` records the new request, and settlement records its
outcome. The interrupted model turn can be cancelled while the host submission
later completes. No prompt, queue payload, image data or key contents enter these
operational attributes. Polling lasts only for the active request and does not
claim queue rows or hydrate attachments. Existing capture policy remains in force.

The owner is `STUDIO HARNESS/src/contracts/diagnostics.ts`, format version 1.
`StudioObservation` has event/boot IDs, local sequence, wall and monotonic time,
stable name, phase/outcome, causal identity, operational attributes, and optional
content with capture/omission status. Monotonic clocks compare within a process.
Never add nested duration totals as if parallel operations ran serially.

`DiagnosticRecorder` is disabled by default. It retains a bounded local window,
with count/byte/event-size caps. Reads are detached, paginated snapshots.
`nextSequence` plus `bootId` resumes reads; `gap` reports a different boot,
evicted/deleted history or dropped sequence. This recorder has no persistent
storage: abrupt termination can lose the entire window. Export before shutdown
when that evidence is needed. Do not claim crash-proof durability.

The default harness window is 2,000 events and 4MiB, with 32KiB per event;
configured maxima are 10,000 events, 32MiB and 128KiB per event. No diagnostic
disk retention is implemented. The local performance acceptance budget is an
added batch-average recorder cost below 1ms/event for the measured small and 5KB
serialized fixtures, with retained bytes within the configured cap. Enabled
medians were 0.052ms and 0.148ms/event; disabled medians were 0.00027ms and
0.00060ms/event. These are local measurements, not worst-case latency promises.
Repeat the measurements when changing capture sources, limits or serialization;
the implementation tracker retains the measurement and mutation evidence.

Content needs both explicit capture opt-in and a selected product conversation
scope. Changing content consent/scope clears retained evidence; stopping recording
preserves it for export. Deleting events clears the local window. Redaction runs
before storage. Recorder content accepts scalars or opaque bounded-source handles;
passing a bare object is a TypeScript error. This prevents a new callback from
accidentally enumerating an arbitrary provider/tool object on the execution path.
The standalone generic serializer remains appropriate only for owned bounded
metadata and bounded parsed JSON, not foreign capture bodies.

The installed Flue patch optionally reuses key lists from its existing detached
snapshot freeze. Under scoped content consent the host retains prefixes of 101
keys for at most 128 objects, using weak references. The recorder can then retain
original envelope fields without another key enumeration. Missing source indexes,
depth/width/string/work limits and event byte limits explicitly label truncation.
No new event fields or execution/persistence behavior enter Flue. Without the
bridge, runtime content is a declared-field projection labeled `projected`.
Framework snapshot creation still has its original input-dependent cost; these
bounds describe additional capture work, not an overall runtime execution budget.

Provider callback projections use a fixed vocabulary and bounded descriptor
probes. Actual SDK HTTP request bodies are captured from already-serialized strings
on explicitly supported fetch adapters. Request/response streams are not cloned
or consumed. Google adapters reject custom fetch injection and remain unchanged;
their normalized Flue observations and supported parsed callbacks remain available.
`provider.payload` records the hook result before SDK selection, with a stage and
hook-result label; `provider.http` is the actual serialized request source when
available. `provider.request.images` (stage `older_images_omitted`) records only
the kept and omitted picture counts when a request's older pictures are replaced
by text to stay inside provider image limits; the transcript is unchanged.
Parsed provider items are not network bytes or provider compute time.
Argument fragments are explicitly omitted, including Responses/Pi typed deltas,
Anthropic partial JSON and Completions arguments nested inside a delta. A fragment
can be valid JSON containing only a secret value, so valid syntax alone cannot
make it safe to retain. Standalone serialized argument strings retain only
redacted complete JSON objects; scalar, invalid and incomplete values are marked
omitted. Final tool/runtime arguments remain separate evidence where available.
Ordinary provider text deltas are unaffected by this argument-fragment rule.
Fetch observers inspect only data descriptors for serialized request bodies and
return the original response even when response metadata cannot be inspected.
For an already-serialized source frame, use `diagnosticJsonContent(frame)`.
It defers inspection until scoped consent is checked and refuses frames over the
input budget before parsing. It captures a complete redacted JSON value when it
fits; oversize/invalid input is explicitly omitted and marked truncated. MCP uses
the actual outgoing/incoming JSON-RPC frame, rather than reconstructing it from
arbitrary argument/result objects. This includes the protocol envelope. Generic
provider-specific fields excluded by a projection remain explicitly unsupported;
do not present a projection as an original wire archive. Native tool argument
field names derive automatically from their existing JSON schemas at registration.
Returned `isError` tool values are classified separately from thrown failures,
without changing the product result or invoking accessors. Agent-end activity is
not proof that a submission completed; explicit aborted model turns are cancelled.
Keep secrets out at the call site too. In particular, never put content in
operational attributes to bypass the content policy.

Content states distinguish `captured`, `projected`, `truncated`, `absent`,
`unavailable`, `disabled` and `out_of_scope`. Unavailable content carries an
omission reason, including an old capture epoch or an unobserved start. Execution
contexts retain their starting consent across child boundaries; actual admission
boundaries establish consent for new invocations. Unindexed recovered entries and
their children carry `observationStartUnobserved` internally and withhold content.
Seeing a running/settled envelope alone does not recreate proof of admission.
Runtime aggregates check
both execution-context and submission epochs, so a newer child cannot restore
an older submission's content after deletion. Operational facts can still report
that a late settlement occurred while its old content remains withheld.

The admission-protected `/api/diagnostics` API requires `diagnostic` scope:

- `GET /api/diagnostics`: effective policy, boot ID, retained counts and losses.
- `PUT /api/diagnostics/policy`: explicit enabled/content/scope/bounds controls.
- `GET /api/diagnostics/events?after=0&limit=100&bootId=...`: cursor-based read.
- `DELETE /api/diagnostics/events`: clear retained evidence.

Responses are `no-store`. The paired remote-device proxy refuses this namespace,
including canonicalized encoded/dot-segment variants. Device pairing does not
grant permission to inspect other conversations. Diagnostic APIs do not record
themselves. No account, upload endpoint or external MCP is needed for local use.

## Client and native sources

Client operational events enter through admitted `/api/observations` batches of
at most 50 events. The policy endpoint exposes only enabled/capture epoch, not
private conversation scopes. The client buffers at most 200 events. Names and
metadata fields have a fixed allowlist, source event/boot/sequence/clock remain
separate from collector receipt identity and time, and old capture epochs are
rejected. The pairing proxy replaces any supplied device header with the verified
paired-record ID; admission identity remains the desktop host. A browser boot ID
is not a device ID. These fields convey provenance, never authorization.

Submission acknowledgement, stream attachment/delivery, transcript projection and
first/final paced text DOM commits have distinct names. Replay is labeled. DOM
commit is not screen paint; provider silence does not prove model thinking. Only
provider-exposed reasoning/content can be captured, never hidden model internals.
The shell badge remains visible with the last known recording state during an
outage. Client/native capture synchronization polls every three seconds; it is
not an instantaneous distributed consent transaction.

Native host observations use a separate 2,000-event process ring. Requests,
attachment byte reads, stream reader outcomes and supervisor lifecycle facts
carry their own UUIDs and propagated request IDs. No paths, bodies or credential
headers enter that recorder. Consent synchronization reads the actual harness
owner and is serialized across windows; deletion invalidates old spans and
in-flight policy responses. Native snapshots remain exportable when the harness
is unavailable. Each native synchronization also forwards up to 50 pending events
to the host-only, diagnostic-scope `/api/observations/native` writer. An acknowledged
cursor advances only within the same capture epoch; upload failures keep the
native ring available for retry/export. The paired proxy refuses this writer,
including encoded and normalized path variants. Native source clocks and loss
counts stay explicit after ingestion. Neither ring survives its own process exit.
The native IPC handler records command arrival with an independent operation ID
and a fixed command-name allowlist; unknown names become `unrecognized`.
Diagnostic control commands exclude themselves. Service fetch/bytes/stream calls
use their detailed boundaries, which exclude diagnostic routes, preventing
polling or uploads from recording themselves. No arguments, clipboard data,
URLs or pairing values enter these events. Arrival does not confirm completion
or provide a parent join to an asynchronous command's transport operation.
Service, stream and supervisor facts provide their separate actual lifecycles;
detached-browser creation/focus outcomes are covered. Other window, clipboard,
external-browser-opening and remote-management command outcomes remain unsupported.

## Feature checklist

Computer actions keep their existing `studio-computer` capability, conversation,
MCP connection/RPC and tool execution identities. The driver receives a separate
Studio UUID for each request's product observation; this is neither an execution
operation nor authority to send input. Accessibility refs include the read's
observation UUID and expire at input/refusal, another read or driver replacement.
Target stamps retain native handles plus PID/process-start metadata. Coordinate
centres from accessibility are display-relative, matching the input contract.

Input replies carry bounded post-action product evidence: eight read-only samples
over 800ms, current target/foreground, at most 20 opened/closed windows and 20
same-app recovery candidates, with explicit truncation/unavailability. Candidates
never select a replacement implicitly. They and window titles remain result
content under existing gated MCP frame capture, never operational attributes.
Dispatch is distinct from application success and screenshot availability.
Held mouse-button release is cleanup: it bypasses pre-action window observation
so stop can still release input during an observation failure, invalidates refs,
and reports unavailable evidence rather than claiming a current window snapshot.
No new diagnostic collection, upload, route, permission or tool is introduced.
The per-conversation tool queue keeps an input and its observations together;
failure/stop invalidates queued input and stale continuations cannot restart it.
Existing gate/MCP operations cover queue lifetime; dedicated driver queue timing,
native input delivery and application-effect verification remain unsupported.
Sampling cannot prove a window remains unchanged afterwards or detect every
unobserved same-process native handle reuse. Screen control across simultaneous
conversations still has no desktop-wide arbitration in this driver.
`computer-driver-contract.test.ts` executes production policy functions and the
click dispatch with native input replaced by doubles; `computer-observation.test.ts`
covers delivery failures, identity propagation, serialization and cancellation.

Desktop control, screen sharing and pointing (ADR 0059) add no new identity
kind. The lease keys an actor by conversation and Flue instance id, both
existing; the shared picture keeps the driver's product observation UUID; a
mark set and a glance's picture take new Studio UUIDs from `contracts/uuid.ts`
and are product ids, not execution ids. Every person control is its own
observed operation under the HTTP execution parent (listed in the standard
path above) with fixed stage names; none is retried. What is on the screen -
pictures, titles, pointer positions, drawn shapes, mark labels - is tool-result
or signal content under existing gated capture, never an attribute. Settlement
releases are observed and never fail the settlement. Unsupported and stated:
the overlay's paint, the driver pulse's timing, sampled-input completeness
between pulses, and whether a mark was seen. `computer-lease.test.ts`,
`computer-control-wiring.test.ts`, `screen-watch.test.ts`, `computer-marks.test.ts`
and the client `screen`/`voice` suites cover refusal, fencing, privacy and the
person-visible outcomes.

The conversation workspace derives primary tasks from canonical submission and
tool-call identities; history replay is presentation, never a new execution.
Worker inspection is a read-only subscriber to the existing agent-instance
stream. Its URL retains the worker instance ID; client observation scope uses
the indexed parent conversation ID. Closing inspection cancels only that read.
Cancellation acceptance remains intent until the task index or job response
confirms settlement. No new capture policy, content field, or transport route
is introduced. Inline delegates without an addressable stream and worker
attachment previews remain unsupported; no parent-conversation attachment URL
is fabricated for a worker. `worker-inspection.test.ts` verifies the scope and
read-only transport, while workspace lifecycle/polling fixtures fence stale
responses and foreign task rows.

Reply images use admitted `GET /api/media/workspace/:conversationId` and
`GET /api/web/image` reads under the existing HTTP request observation.
Local reads resolve the conversation workspace, scratch, artifacts, attachments
and assigned project roots before serving a picture. Web reads reuse the
destination-checked binary HTTP transport and its request observations; they
do not add execution authority or retry ownership. Paths, remote URLs, image
bytes and visual data remain product content, never observation attributes.
Primary workspace inspection retains its conversation scope for images; worker
inspection does not borrow the parent's file scope. Painting, provider use of
visual formats and local file changes during a read remain unverified by these
boundaries. Coverage: `reply-images.test.ts`, `ReplyImage.test.tsx`,
`WorkspaceOverview.test.tsx` and `visuals.test.tsx`.

Image read disclosures reuse native `read` results and their existing tool-call
and conversation identities. Only returned PNG/JPEG/GIF/WebP image blocks earn
a viewed-image row; text reads and refused/pending reads retain their existing
presentation. Expanding resolves persisted attachment references through the
existing attachment byte transport; inline bytes and the larger media viewer
need no new transport or tool execution. Attachment delivery retains existing
request/native service observations and resolver cache/retry ownership. Opening
and closing previews are local presentation state, with no new diagnostic
content capture or image/path attributes. Missing bytes are shown as unavailable;
image paint and preview interaction timing remain unsupported observations.
`ImageReads.test.tsx` covers grouping/order, persisted conversation-scoped
delivery, missing bytes and exclusion of non-image/error results.

The detached browser viewer uses admitted
`POST /api/conversations/:id/browser/interact`, then the private system-server
`studio/browser` RPC. `browser.interaction` inherits the HTTP execution parent
and adds the existing conversation identity; action names are fixed operational
metadata. The client and MCP connection retain separate request, operation,
connection and RPC identities. Viewer leases use client UUIDs and convey control
ownership, never admission authority. Native window labels encode the complete
opaque conversation ID without lossy sanitizing; opening a viewer never creates
a second conversation identity. Inputs are not retried. The viewer reads one
latest bounded screencast frame, dropping superseded frames by design;
these frames are product delivery, not diagnostic recordings. Manual text,
keys, addresses, raw page cursor telemetry and live frames are excluded from MCP
diagnostic content even with scoped capture enabled. The browser child does
not claim per-frame diagnostic capture. Native `open_browser_window` records
arrival plus a separate start/end operation for creation or focusing, preserving
the original result and omitting IDs, titles and error prose. Paint and the
IPC-arrival-to-command-operation parent join remain unsupported.
Lease expiry releases held input before automation resumes; a refused automated
tool remains a returned MCP tool error, never a successful browser action.
The viewer resolves its own client rather than depending on workspace catalog
initialization. Only unavailable address/frame reads have bounded recovery;
manual commands retain one dispatch. Refused input is distinct from lost
transport. Frame dimensions come from the captured frame metadata, while title
refresh is bounded to one pending evaluation per listed page and never delays
frame delivery.

Computer presence reuses the existing admitted `studio-computer` tool/MCP
boundary. The child driver owns a bounded non-injected input counter and a
nonactivating, click-through cursor marker on one background message-loop thread.
The helper is bundled from source with the driver, starts observing on the first
acting request, never reads key values, never suppresses input and releases hooks
and its marker on exit. Ordinary driver shutdown/refusal also releases only
Studio-tracked held keys/buttons. The shared server serializes desktop tools and
refuses competing input while another conversation's driver owns the desktop,
including its release interval. Stop bypasses these queues; queue epochs still
fence stale continuations. Ownership is coordination, not a permission grant.
Chat Stop and the desktop pill both request driver cleanup and model cancellation.
Closing the driver refuses new input immediately. An active native request may
finish within its original deadline, followed by a two-second shutdown margin;
stdin closure then reaches the driver's held-input cleanup. This does not grant
a fresh request budget. A forced or nonzero exit reports unconfirmed cleanup,
and an unconfirmed kill retains the ownership fence until actual process exit.
Steering does not run this Stop path or replay an active computer tool.
It is local to one computer MCP server, not OS-wide arbitration between independent
harness processes. A wedged or force-killed driver cannot guarantee held-input
cleanup; an already-running native call can delay the driver's cleanup requests.

Non-injected events invalidate native UI refs. Bounded aggregate counts and current
pointer/target/foreground state travel in tool results, including action refusal;
they do not cancel an agent or resend an action. The existing request observation
UUID remains the product observation identity; activity counts are not
execution/event IDs. Session-local accumulation keeps reports from internal
cursor/screenshot requests with their originating tool and preserves the actual
result or refusal. Unsupported monitoring/state is explicit.

Since ADR 0059 the lease is per actor, not per conversation: the actor is the
Flue instance id the harness puts in a system server's `_meta`, never a model
argument, and it is coordination, not a permission grant. The person's controls
reach the server through admitted conversation routes and the private
`studio/computer` RPC with no model between: `computer.control` (pause, resume,
show-me, state; result and held-input outcome as attributes), `computer.stop`
(stage `cleanup_confirmed`/`cleanup_unconfirmed`/`not_running`/`unavailable`,
never rounded up), `computer.sharing` (`on`/`off`), `computer.glance`
(`glanced`/`current`/`sharing_off`/`failed`/`not_running`), `computer.drew`
(shape counts only), `computer.checkpoint` (`fenced`/`not_owner`/`not_running`)
and `computer.release`; settlement releases an actor under `computer.release`.
Only sharing on starts the server; every other control answers `not_running`
rather than starting one. Screen pictures, window titles, drawn shapes and
pointer positions stay in tool results and the turn's `interaction_context`
signal, under the existing gated MCP capture, never in attributes. The screen
pulse (twice a second, sharing only) is product sampling, not a diagnostic
recording, and is not observed per sample. The native `screen_overlay_*`
commands record arrival under the fixed allowlist; the overlay's own state and
idle reads are excluded as housekeeping. The voice signal's
`heard_before_interrupt` and `control` attributes are conversation content.

The browser's existing private admitted interaction route also accepts bounded
viewer-presence samples without claiming control or injecting page input. Browser
tool results distinguish these coalesced samples from submitted manual page
commands, carrying no entered text or key values in the activity summary. The
explicit human-control lease is unchanged. Returned aggregate summaries are
intentional model context and use the existing scoped, gated MCP result capture;
the raw private RPC, page binding and live frame remain excluded. Page-owned
cursor shape/press telemetry is visual evidence only and never input authority.
Its listeners, pending timers and bindings are removed when the viewer detaches.

No new diagnostic route, collection policy, upload or separate per-event activity
history is added. Aggregate tool results use the existing conversation history.
Activity is delivered in the next tool result, not an unsolicited model
turn or stream interruption. Hook installation does not prove lossless delivery,
physical human attribution or secure-desktop/elevated-window coverage. Cursor
styles within child frames remain best effort; no native marker/focus, physical
input or multi-monitor hands-on verification is claimed. Tests compile the helper
without starting hooks and exercise controlled browser sessions.
The desktop marker paints the browser's arrow geometry and a rounded custom
Studio badge. Screen-edge placement keeps the badge visible and arrow hotspot
aligned. It does not replace the OS-wide cursor. Offscreen drawing tests exercise
the shipped renderer; these are not evidence of live desktop focus or hook delivery.
The compact white pointer face and thin charcoal edge use Studio's neutral palette.
Its five-second visual pulse renews after successful input dispatch and exact
pointer correction; manual non-injected input, refusal and held-input release
dismiss it. These paint-only pulses add no input, retry, collected field or new
execution identity. Existing action results and exceptions are unchanged.
The opt-in `computer-marker-live.ps1` fixture composes the shipped layered window
over an owned test backdrop without hooks or injected input, checking its pixels
and foreground preservation. This verifies that component's live composition,
not physical-input attribution or the running agent's end-to-end delivery.
Successful native mouse-button dispatch updates only a bounded visual button mask
and release timestamp. The cursor compresses on press, retains held-button feedback
until the last button is released, then draws a 260 ms expanding, fading neutral
ring. Wheels and refused input never start click feedback. No button identities or
timestamps are added to results or diagnostic attributes.

Browser cursor snapshots retain a bounded `pressSequence` counter so a complete
page press/release between viewer polls can still produce feedback. This is visual
page telemetry, not an execution/event ID, input authority or proof of application
success. It travels only through the existing private viewer projection; raw cursor
bindings and viewer RPC frames remain excluded from diagnostic content capture.
Initial/repeated snapshots do not replay animation, and another human controller
or an ended session does not show Studio's cursor. The pill's fixed Stop slot and
shared text line box are presentation only. `computer-indicator-layout.test.ts`
checks the actual fonts, geometry and clipping in isolated headless browsers across
supported font sizes, light/dark themes and 100/125/150 percent display scales.

Desktop presence uses admitted `GET /api/computer/activity`, the child operation
`computer.activity`, and the existing private `studio/computer` RPC. The desktop
lease owns the returned existing conversation ID and mode; no new entity ID,
screen sampling, content attribute, permission or automatic resend is introduced.
An unavailable server has no owner; a failed read remains unavailable rather than
proving exit. The shared client poll drives the main window's native indicator
and rail controls independently of transcript replay and navigation. Native sign
renewal expires after four seconds without the UI, and pointer-monitor placement
uses physical work-area coordinates. Renewal, placement and paint remain
housekeeping rather than diagnostic events; existing native commands retain
their arrival observations. Driver release, submission settlement and confirmed
exit remain the authority for lease loss. Physical monitor switching, overlay
alpha composition and focus behaviour still require hands-on validation.
The pill's Stop carries a client request UUID through its existing native event;
the main window returns delivery failure under that same UUID. Late replies from
an older press or owner are ignored. A successful dispatch or unconfirmed cleanup
does not claim exit; the live lease still controls visibility. This event join is
product coordination, not an execution-parent join or authority to resend input.

All window kinds share appearance updates through the existing preference-store
subscription (browser windows use storage events). Receiving an update emits
only `client.window` / `appearance_received`, under the existing capture policy;
no preference value, window title or content is recorded. Received preferences
are applied without another persistence write. Subscription disposal suppresses
late UI updates; a catch-up read closes the initial load/subscription gap.

The separate [Studio Inspector](studio-inspector.md) consumes this contract.
The native `diagnostic_inspector_status` / `diagnostic_inspector_configure`
commands are excluded diagnostic self-control. Its explicit, default-off local
feed uses native-generated request/feed/snapshot UUIDs, fixed admitted diagnostic
GETs, epoch guards, bounded atomic snapshots and clear/disable writer fences.
It never enables recording or exports the owner bearer. The Inspector archive
has independent consent/retention; clearing the source does not erase copies.
Sharing and source policy synchronization are not instantaneous. New bridge
coverage is tracked with the external Inspector implementation.

For each change, document the stable capability/entity name, entry point and
identity owner, parent propagation, actual retry ownership, outcome vocabulary,
content policy, unsupported observations and relevant coverage tests. Check direct,
queued, cancelled, refused and failed paths as applicable. Keep execution,
delivery and capture health separate. Returned `isError` values and thrown errors
must not be silently collapsed into one outcome.

MCP discovery keeps the existing `native/discover` capability and tool gate.
Its `discover.list`, `discover.inspect` and `discover.load` child operations
inherit that gate's execution parent. Page observations contain counts and a
continuation flag; successful loads contain selection count and serialized schema
bytes. Search text, cursors, names, descriptions and schemas remain tool content
under the existing scoped capture policy. There is no new collection switch,
retry, permission grant or external call. Loading publishes schemas for the next
model step; it does not execute MCP tools. Enablement, name validation and byte
checks precede adoption. An unexpected registration exception is preserved; this
in-memory registration loop is not a transactional rollback boundary.
The schema byte budget applies at explicit-load preflight. Catalog refreshes
still follow the existing replacement policy; this is not a permanent context
size bound or a provider token estimate.

Existing coverage and unfinished work live in the implementation tracker. Update
it when a feature adds or closes a boundary. Do not call the system complete
until the coverage inventory, user controls, end-to-end fixtures, performance
budget, review findings and full checks have all been verified.
