# Project Studio Inspector: audit and delivery plan

Status: historical baseline audit and Stage B proposal. Studio instrumentation
has since been implemented; its current coverage and verification live in
[the implementation tracker](studio-observability-progress.md) and
[the developer contract](../architecture/observability.md). The external inspector
service has not been implemented. The baseline tables below describe the state
at the initial audit, before that instrumentation work.
Prepared: 2026-10-16. Scope: the current working tree, including existing local
changes, Studio Harness, Studio desktop/web client, installed dependencies, and
the separate Backend telemetry worker. This is a source and focused-test audit,
not a recording of the user's last production conversation. Active environment
overrides and the packaged application's effective telemetry settings were not
inspected.

## 1. Recommendation

Delivery order clarified with the user: first complete Studio's identity and
observability contract, then build the external inspector. A production telemetry
backend, cloud account, analytics dashboard and automatic upload are deferred.
The product must be telemetry-ready without requiring users to enable collection.

Build an external, local-first **Studio Inspector** service with a small optional
capture bridge inside the harness and client. The service owns diagnostics
storage, timeline reconstruction, queries, live subscriptions, exports, and a
read-only MCP interface usable by Codex or Claude Code. Studio keeps owning its
agent loop, conversation journal, permissions, and business state.

The first useful external-inspector deliverable is: select one real conversation, obtain an
evidence-linked summary of its submissions and failures, drill into a particular
model/tool attempt, and watch the next submission live. A dashboard is optional;
reliable evidence and an agent-readable query interface come first.

An entirely external process cannot recover details that Studio never exports.
The capture bridge is necessary for live-only runtime observations, provider
callbacks, and UI transitions. Keep that bridge small; put analysis outside the
product. Do not put a proxy in front of every provider as the initial design.

## 2. What exists today

Paths in this document are relative to the repository root.

| Area | Implemented evidence | Missing for the requested workflow |
| --- | --- | --- |
| Dependency baseline | Harness pins Flue runtime/SDK/OTel/Vite 2.3.0 and Pi AI 1.2.0. `STUDIO HARNESS/pnpm-workspace.yaml` applies a local runtime patch and Pi overrides. | Capture exact resolved versions, patch identity, build/commit, and effective configuration with every recording. Upstream version alone is insufficient. |
| Runtime traces/metrics | `src/observability/flue.ts` registers `createOpenTelemetryInstrumentation()` through `instrument()`. SDK starts first; shutdown unregisters and drains. | Persistent query backend and whole-application coverage. |
| Export configuration | `observability/config.ts` supports `none`, `memory`, and OTLP HTTP. Without explicit exporter/endpoint, it chooses `none`. Content capture defaults to false in Studio, overriding Flue's content-on default. | A durable local recorder and an explicit capture profile for real diagnostic sessions. |
| Logs and errors | `observability/logger.ts` emits JSON with execution and active trace IDs. `error-reporter.ts` normalizes errors, marks active spans, and increments `project_studio.errors`. | Reliable retention, cross-source lookup, and a coverage audit of failures that bypass the reporter. |
| Correlation | `execution/context.ts` carries request, operation, parent, attempt, instance, submission, turn, task and tool-call IDs through AsyncLocalStorage. Admission middleware accepts `X-Project-Studio-Request-Id`. | Client generation/forwarding of a consistent interaction ID, persisted admission-to-submission mapping, and cross-process links. Existing IDs are useful but do not prove continuous end-to-end tracing. |
| Historical conversation evidence | Flue journal stores canonical conversation records and submissions. `storage/flue-journal.ts` reads it read-only. `conversations/export-walk.ts` preserves raw parsed records, unknown records, unparsed batches, materialized messages, usage, retries and settlements. `export-cli.ts` exports JSON and Markdown. | Searchable, paginated single-session inspection joined with runtime evidence. Journal history does not contain every live observation. |
| Context usage | `conversations/context-usage.ts` observes completed calls/compaction and persists the latest conversation measurement. | Per-call usage history, purpose-separated accounting, and prompt composition diffs. Latest context usage is not cumulative session spend. |
| Retry visibility | Local Flue patch records scheduled model retries, exposes retry chunks, and retains failed assistant attempts in history. Retry policy is owned under `src/reliability`. | Unified attempts/backoff timeline, including provider-side retries when observable. Do not count a retry as invisible by assumption. |
| Tool control | `tools/gate.ts` handles parsing, authorization, sandbox checks, snapshots and bounded execution; errors flow to its reporter. `tools/bounds.ts` knows queue versus started cancellation/timeout and exposes active/queued counts. | Timed stages and explicit outcomes for each boundary, plus failures before the gate and non-throwing error results. |
| Delegation | Runtime task events, execution links, task store/projector and acting delegate scope already exist. | A complete parent/child execution graph spanning runtime delegation and separately admitted product tasks. |
| Client streams | `STUDIO/src/platform/harness/conversation.ts` implements history then updates, offsets, classified seam failures and cancellation distinct from abort. `stream.ts` has keep-alives and a 45-second body read idle timeout; native Rust provides the desktop transport. | A persisted record of submit/acknowledge/attach/catch-up/disconnect/resume/render transitions. A healthy heartbeat does not prove the model is progressing. |
| Desktop lifecycle | Rust supervisor logs startup, crashes and automatic restart. Tauri log plugin is enabled in all builds. | Correlation to active submissions and a durable structured process lifecycle feed independent of the harness. |
| Cloud telemetry | `Backend/workers/telemetry/src/index.ts` ingests `/v1/events` and Cloudflare tails into Analytics Engine. | This is a separate bounded event-summary pipeline, not the local session inspector or an existing OTLP receiver. |

Source paths under `src/` above refer to `STUDIO HARNESS/src/` unless prefixed
otherwise. Architecture context: ADR 0004 and ADR 0037.

### Specific gaps worth fixing early

1. **Default `none` is not a durable diagnostic store.** It actually constructs
   in-memory span/metric exporters, while retaining neither in the public snapshot
   state. Despite the "discarded" comment, the in-memory implementations retain
   finished observations until reset/shutdown. Review this as a potential growing
   memory cost; choose real no-op exporters when disabled or a deliberately bounded
   recorder. The explicit memory mode is also unbounded.
2. **The memory JSON dump is a test aid.** `observability/sdk.ts` rewrites a growing
   JSON snapshot in place. It omits span start/end/duration and event timestamps;
   metrics are reduced to names and data-point counts. It cannot answer a detailed
   latency investigation. Its readers already tolerate partially written JSON.
3. **Harness log forwarding loses visibility by default.** The Rust supervisor
   forwards child stdout/stderr through `log::debug!`, whereas `lib.rs` builds the
   log plugin at `Info`. These forwarded records are filtered on that path. Do not
   assume the desktop log contains all harness JSON lines.
4. **No explicit HTTP/client spans were found.** The application exposes a tracer
   but the inspected application source does not create HTTP/UI boundary spans.
   The Node SDK specifies `instrumentations: []`; Flue spans alone do not measure
   click-to-visible-response latency.
5. **A tool failure has several representations.** Unknown tools and parsing
   failures can occur before execution. The runtime bridge can return `isError`
   and `details.isError` values for unavailable tools or delegate restrictions.
   Flue's documented `tool.isError` concerns execution failure; verify the patched
   runtime's handling of returned error flags with fixtures. Preserve raw return
   envelopes, gate reports, and runtime outcomes separately.

## 3. What this exact dependency stack can expose

The installed `@flue/runtime/docs/reference/events.md`, observability guide,
`@flue/opentelemetry/README.md`, and installed OTel implementation were inspected.

Flue's **runtime observation surface** is distinct from its conversation stream.
It supports model request/response boundaries, message/reasoning progress, tool
and task activity, compaction, operations, logs, submission recovery and settlement.
The useful capture points include:

- `turn_request`: model-visible system prompt, messages, tool definitions and
  settings. Live/in-process only; not available later through history.
- `turn`: normalized response, usage, finish reason, duration, model identity and
  classified failure; provider metadata exists only where supplied.
- `tool_start` / `tool`: normalized args, effective result and classified error
  information through live observation fields.
- `submission_settled`: authoritative completed/failed/aborted outcome.
- `submission_recovery`: failures/recovery activity that may explain why a
  submission has not reached settlement.

Runtime observers are live-only and synchronous on emission. Queue bounded work;
do not perform disk/network calls or analysis in their callbacks. Interceptors
run on the execution path and can fail the operation, so use them sparingly and
make recording passive and failure-contained.

Important fidelity details:

- Model tool terminal events are emitted when their batch durably commits,
  rather than necessarily when execution finishes. Record both execution-end
  and commit/publication time where available.
- OTel spans usually export when they end. They cannot alone explain an operation
  that is currently hanging or dies before ending. Persist start/progress records.
- OTel content has a default shared 56 KiB budget per span in this installed
  package. Raising the budget does not make trace attributes an unlimited archive.
- Flue events replace image bytes with an omission sentinel. Use attachment refs
  and hashes for media; never claim event capture includes those bytes.
- Flue supports direct-admission trace context, but its installed OTel documentation
  says `dispatch()` does not propagate it. Persist explicit causal IDs/links.
- Per-context `eventIndex` is not a global ordering or globally unique event ID.

### Pi 1.2.0 gives us a deeper optional provider seam

Flue's installed OTel README says raw provider chunk timing is not emitted. That
is true of the current Flue projection, but the installed Pi 1.2.0 types and adapter
implementations expose `onPayload`, `onResponse`, and `onProviderStreamEvent`.
The latter observes parsed provider stream items before Pi normalization and is
implemented across multiple installed adapters, including Anthropic, Google,
OpenAI completions/responses and Codex paths. `simple-options.js` forwards it.

Studio's local adapter currently delegates `streamSimple()` without attaching
these diagnostics. Add callbacks at this seam, composing any existing callbacks.
Capture effective target model/protocol as well as Flue's alias identity. Verify
each selected provider and transport, including error and retry paths; a type
declaration is not universal coverage. These callbacks can be awaited: keep the
recording callback constant-cost and non-throwing.

`telemetryContext` is also declared by Pi, and pi-telemetry 1.2.0 is installed, but
that alone does not establish provider instrumentation. Do not promise automatic
provider spans from adding a context; verify implementation before relying on it.

Parsed provider-item arrival is not network first-byte time or server-side compute
time. Label each measurement precisely. Provider SDK/internal retries require
separate coverage; Flue turn counts need not equal HTTP attempt counts.

## 4. Proposed architecture

```text
Studio webview/browser -- UI/transport events -------+
Studio Rust host ------ lifecycle/transport events --+
Harness capture bridge - Flue observations ----------+--> Studio Inspector
                       - gate stage events ----------+    local collector
                       - provider callbacks ---------+    independent storage
Existing Flue OTel ---- OTLP, optional ---------------+    indexed projections
Journal export/reader - historical evidence ---------+         |
                                                         query API / live cursor
                                                         read-only MCP / CLI
                                                              |
                                                         Codex / Claude Code
```

Use a sibling project such as `Studio Inspector` for the service, schema, analysis
and MCP server. This document does not create that project. A private integration
package may be imported by Studio, with an enable/disable switch and a versioned
protocol. Capture failures must not change tool/provider results or cause retries.

Start with SQLite in the external service for indexed metadata and append-only
events, plus content-addressed blobs for selected large payloads. Keep it separate
from Studio and Flue databases. Store normalized projections alongside original
captured envelopes, not instead of them. Diagnostic data may reference canonical
conversation content; it must not become an alternate authoritative transcript.

Use loopback with a per-install diagnostic credential, or a supported local IPC
channel. Do not expose diagnostic reads through the remote browser listener by
default. The external MCP uses its own access scope; it should not require Studio's
private provider credentials or the desktop admission bearer.

### Recording reliability and schema

Every envelope needs a protocol version, globally unique record ID, source and
source sequence, process boot ID, wall time, monotonic time within that process,
event kind, available causal IDs, capture profile and payload references. Keep
Studio operation/attempt IDs distinct from Flue's identically named IDs. Record
which identifiers are absent rather than inventing joins.

At minimum join product conversation, submission, runtime stream, turn, tool call,
task, logical operation, execution attempt, HTTP request, trace and span. Add an
interaction ID at submit and persist its submission acknowledgement mapping.
Link background titling, text improvement, Library description, compaction and
delegation by purpose so their tokens and delays do not impersonate the main chat.

The service acknowledges persisted batches; sources retry delivery with record-ID
deduplication. Maintain a bounded local spool if the collector is unavailable.
Sequence gaps, dropped counts, capture start/stop, queue saturation and unsupported
fields are first-class evidence. A bounded async recorder can lose its last
unflushed observations on a hard crash: report that uncertainty. If stronger
durability is needed, introduce an explicit diagnostic profile with a documented
flush/latency tradeoff. Do not claim exactly-once or crash-proof capture.

The collector's receipt time cannot substitute for execution time. Compare
monotonic durations only within a process; estimate cross-process clock offsets
and preserve uncertainty. On restart reconcile open operations against canonical
settlements and host exit facts. An unclosed operation is interrupted/unknown
until evidence establishes more.

### Capture profiles

- **Operational:** IDs, phases, timestamps, sizes, outcomes, usage, error codes,
  source health. No conversation bodies by default.
- **Diagnostic session:** explicitly selected conversations capture redacted
  effective requests, tool args/results, emitted reasoning, errors/stacks and
  provider payloads where supported. Short bounded retention; visible status.
- **Export:** a selected time/session range with manifest, versions, coverage,
  missing data, truncations and checksums. Redact before external sharing.

Redact before persistence, with depth/size bounds and failure-safe serializers.
Allowlist response headers; exclude authorization, cookies, provider credentials
and environment values. Record media references and redaction/omission status.
Apply deletion/retention to blobs, indexes, spool and backups as well as events.
"Raw" means the original *captured, policy-processed* envelope, not an unredacted
wire dump. Capture starts cannot retroactively restore previously unrecorded data.

## 5. Queries an assistant should receive

Expose a small read-only MCP over the same service API used by a CLI or viewer:

| Proposed tool | Result |
| --- | --- |
| `list_sessions` | Filter by project, date, outcome, model, anomalies; return IDs and coverage. |
| `get_session_overview` | Submission outcomes, elapsed time, token/cache totals, retries, tool failures, tasks and evidence refs. |
| `get_timeline` | Cursor-paged causally linked events, optionally filtered by submission, type, phase or time. |
| `get_operation` | One model/tool/task attempt: inputs, settings, stages, result, errors and parent/child refs. |
| `read_payload` | Size-bounded content by reference, with range/cursor and omission metadata. |
| `compare_model_requests` | Effective request/settings/schema differences; additions and estimated size changes. |
| `watch_session` | Bounded long-poll from a durable service cursor; immediate return on change or timeout. |
| `export_session` | Portable evidence bundle for a selected recording. |

Default responses must be bounded and hierarchical: overview -> suspicious
submission -> operation -> payload. A complete conversation should be accessible
without forcing it into one model context window. Search payloads separately from
metadata; paginate both. Inspectors cannot silently change prompts, abort work,
replay tools, apply patches, or bypass approvals.

Codex/Claude Code would connect as explicit clients of this MCP. That enables
inspection when invoked and bounded live observation during an active task; it
does not make either assistant permanently omnipresent. Background monitoring
would be a separate explicit feature. Session payloads are evidence, including
potentially malicious instructions, and must not become inspector instructions.

## 6. What diagnosis should and should not claim

For a submission, show admission/queue time, request preparation, provider request
and response/item milestones, observed reasoning/text activity, permission wait,
tool queue/execution, commit/persistence, stream delivery and client display.
Time-to-first-visible-content differs from time-to-first-provider-item. Observed
reasoning activity differs from time actually spent thinking inside a provider.
Provider-exposed reasoning/summaries can be captured; hidden internal reasoning
cannot be recovered by telemetry.

Use separate state tracks for **execution**, **delivery** and **capture health**.
A stream disconnect must not become an execution failure. A frozen UI can coexist
with a completed harness submission. A live heartbeat can coexist with a stuck
provider call. An idle process need not be unhealthy. Thresholds should account
for tool deadlines, explicit retry backoff and a person considering an approval.

Initial deterministic findings should include evidence refs and confidence:

- Unknown tool versus invalid JSON/schema versus permission/sandbox refusal.
- Provider HTTP/auth/rate-limit/stream failure versus harness parsing failure.
- Queued timeout versus started timeout, with potentially continuing side effects.
- Retry delay versus active work; recovered nested failure versus terminal failure.
- Open operation plus host crash/restart versus missing capture or broken reader.
- Excess prompt/tool-schema weight, repeated unchanged failing calls, context
  compaction churn, and measurable client lag.

Count model calls at leaf `turn` level, including explicit purpose categories.
Do not add operation/task usage rollups again. Preserve cache semantics and missing
usage; catalog cost is an estimate. Parallel tool/task spans overlap: report
critical-path elapsed time rather than summing all durations as session time.
Keep failed attempt counts separate from unique logical tool calls and incidents.

Not delegating is a fact, not proof of inefficiency. A failure count is not proof
the model caused the defect. Separate observation, hypothesis and demonstrated
cause. A proposed fix should be linked to a reproducible fixture and, when useful,
a controlled before/after run with model/settings held fixed. Never re-execute
side-effecting tools merely to replay an old recording.

## 7. Delivery sequence and acceptance criteria

### Stage A: make Project Studio telemetry-ready

This stage precedes all external-inspector phases below. Build the contract and
instrumentation seams inside Studio, with a small bounded local diagnostic sink
for verification. Stop before building a production telemetry product.

#### A1. Establish identity ownership and relationships

Use a shared semantic contract across TypeScript and Rust. Existing
`contracts/uuid.ts` already generates cryptographic UUIDv4 for harness-owned
identities; extend that mechanism without changing the ID format gratuitously.
The client currently uses prefixed short `Math.random()` IDs in `STUDIO/src/lib/id.ts`.
Inventory its callers and replace generation for durable/cross-process identities
with cryptographic IDs, preserving existing records and opaque wire formats.
Do not bulk-rewrite all historical IDs or change every ephemeral UI key.

| Identity | Lifetime and rule |
| --- | --- |
| Conversation/entity | Stable for that entity; preserve existing product IDs. |
| Interaction | Mint at a submit/action boundary; survive transport uncertainty and link to acknowledgement. |
| Submission | Preserve Flue's admitted-work ID; explicitly map from interaction. |
| Logical operation | Stable for the logical work across retries; one parent or explicit causal links. |
| Execution attempt | Fresh for each actual retry/execution of that logical operation. |
| Event | Unique immutable envelope ID; source sequence establishes local order. |
| Process boot / stream connection | Fresh on restart or reconnect; never reuse as conversation identity. |
| Payload/artifact | Immutable reference; content hashes may deduplicate captured bytes. |

Every meaningful operation and observation must be addressable. A token, byte,
React render or heartbeat need not each acquire a new logical-operation UUID:
chunks can use their owning stream/attempt ID and sequence; recorded observations
still have event identities. UUIDs identify things, while parents, links, stages,
timestamps and outcomes explain what happened.

Keep identifier namespaces distinct. Flue/provider/MCP IDs stay opaque; store
them as external references instead of replacing them with Studio UUIDs. OTel
trace/span IDs have their own formats and should be mapped, not forced into UUID
fields. No account or persistent person-tracking identifier is required.

The current execution context creates a fresh operation ID and attempt ID for
each child frame. That is not evidence of a stable logical operation across
retries. Audit real retry paths and explicitly separate logical work, attempts,
and context frames before promising retry-family reconstruction.

#### A2. Define a versioned observation contract and coverage inventory

Specify start/progress/end, outcome, parent/causal refs, source, boot ID,
monotonic/wall timestamps, error classification, payload refs and capture health.
Define both execution and delivery tracks. Inventory all meaningful boundaries:
UI interaction, native bridge, admission, queue, provider preparation/response,
tool validation/authorization/execution, MCP exchange, delegated task, compaction,
background work, durable commit, streaming/reconnect, abort and process lifecycle.
Mark each as instrumented, unsupported or intentionally excluded, with fixtures
for critical paths. A coverage matrix is the definition of "ready"; attaching IDs
to a few happy paths is insufficient.

Identifiers are correlation only. They do not grant authorization, make a request
idempotent, guarantee delivery or prove causation. In particular, do not introduce
automatic retries of uncertain admissions by adding an interaction ID: preserve
the current no-deduplication behavior unless a separate idempotency contract is
implemented and tested.

#### A3. Add passive observation ports and user-controlled capture

Instrument the inventoried boundaries, reusing Flue observations and Pi hooks
where possible. Provide a disabled sink, bounded local diagnostic sink and
optional exporter interface. Separate emitting an observation from persisting
content or sending it off-device. Operational collection, diagnostic content and
external export are independent explicit policies. No silent account creation,
cloud dependency or automatic conversation upload.

Users can inspect capture status, choose scope/content/retention, stop recording,
export selected evidence and delete retained diagnostics. Treat debug builds as
policy-controlled too; a development flag alone is not consent to capture all
content. Run redaction and bounded serialization before persistence/export.

Keep the interface exporter-neutral. Existing OTel remains available for traces
and metrics; the richer event contract preserves evidence that span attributes
cannot carry. Avoid building a general replacement for OpenTelemetry.

#### A4. Prove readiness and stop Stage A

Acceptance: one interaction can be followed through submit/admission, all model
and tool attempts, optional tasks, settlement, delivery and display, with stable
joins. Failure fixtures cover invalid calls, refusals, retries, cancellation,
reconnect, process restart and missing/dropped observations. Existing IDs remain
readable; replay does not create new execution counts; observer failures do not
change business outcomes. Measure enabled/disabled recording overhead and bounded
memory/disk behavior, then set and verify an explicit performance budget.

Use an external test reader or diagnostic export to validate this contract.
Production dashboards, billing analytics and cloud telemetry are outside Stage A.
Its completion yields a documented, versioned adapter surface that the external
tool can consume without another instrumentation redesign.

### Stage B: build the independent inspector

Stage B uses the completed Stage A contract. It can later support other harnesses
through source-specific adapters and a capability matrix; do not assume Claude
Code, Codex or any other harness exposes Studio's raw internal observations.
Record each adapter's actual access, supported event families, timing fidelity
and missing content. An AI harness acting as an MCP client and that harness
being an inspected execution source are separate integrations.

### Phase B1: historical inspector

Create the external service/schema/CLI, import existing JSON exports, index
conversations/submissions/tools/retries, and expose overview/timeline/payload MCP
queries. Reuse the existing export format before coupling directly to Flue SQL.
If live journal reads are added, use short read-only snapshot transactions and
version checks; never migrate or checkpoint Flue's store from Inspector.

Acceptance: a chosen past conversation can be located and its messages, tool
calls/results, failures and settlements inspected where retained. Every answer
states missing capture and provenance. Unknown records survive import. No claims
of historical provider timings, full requests or throw-site stacks when absent.

### Phase B2: live recorder integration

Connect Stage A's early runtime observation capture; correlate OTel IDs, preserve
start/progress/settlement, include retry/recovery and background purposes, and add
bounded delivery/spooling and recorder health. Fix default exporter memory behavior
and the lossy log retention path as focused separate changes.

Acceptance: a live hello/tool task can be watched by cursor; terminate/restart a
test harness and identify the last observed work with explicit uncertainty.
Collector failure, full spool, malformed payload and disk failure never alter the
agent's result. Duplicate transport delivery does not inflate counts.

### Phase B3: tool and provider investigation

Consume and verify Stage A's gate validation, permission wait, snapshots, queue,
execution and result mapping evidence, plus provider callback captures of actual
target/protocol, supported HTTP metadata and parsed-item timing. Preserve
validation failures before the gate and returned error envelopes. Verify retry
behavior across both runtime and provider layers.

Acceptance fixtures: invalid arguments, unknown tool, returned error, denied
permission, queued/started timeout, provider 429/backoff, auth failure, malformed
provider stream, interrupted tool batch and compaction failure. Each resolves to
the correct boundary; unsupported provider details remain explicitly unavailable.

### Phase B4: desktop and browser end-to-end investigation

Consume Stage A's interaction correlation and UI/Rust lifecycle/transport events:
submit intent, acknowledgement, history load, stream connect/catch-up, delivery,
disconnect, resume, explicit abort and first displayed output. Cover remote browser
and Tauri separately. Do not record every React render or every keystroke.

Acceptance: distinguish a run still executing after disconnect, a crashed harness,
a lost admission acknowledgement, and a client that failed to display completed
output. Replayed history never masquerades as fresh generation timing or new
provider usage.

### Phase B5: diagnosis and engineering loop

Add evidence-linked anomaly summaries, request comparisons and fixture generation.
Review one real failing recording, fix one demonstrated cause, reproduce with a
mock provider/tool fixture, and compare subsequent real usage. Add a timeline
viewer if it materially improves this workflow. Leave cloud fleet dashboards,
autonomous patching and broad benchmarks until this loop works.

Acceptance: an assistant can answer "why did the last conversation stop?" with
the observed boundary, exact supporting records, any uncertainty, and a targeted
validation plan; then use the next recording to check the fix.

## 8. Validation performed for this audit

- `pnpm build` in Studio Harness: passed.
- `pnpm exec vitest run tests/unit/observability.test.ts tests/unit/prompt-trace.test.ts`:
  2 files, 30 tests passed.
- `pnpm exec vitest run tests/integration/observability.test.ts`: 1 file, 3 tests
  passed against the rebuilt harness. These cover the existing observability
  vertical slice, including content policy; they do not establish future recorder
  reliability or diagnose the user's actual recent incidents.

No runtime code, diagnostic configuration, live conversation data or existing
local edits were changed for this proposal. The harness build regenerated ignored
build outputs. Implementation should begin with Stage A's identity/coverage
inventory and contract. Complete its readiness gate before building Stage B.
