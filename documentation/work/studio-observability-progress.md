# Studio observability implementation tracker

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
| Language provider | Target/hook/response/parsed item observers compose original callbacks. Actual HTTP attempts on supported Pi fetch adapters have separate IDs and already-serialized request bodies; Request/Response objects and fetch receivers are preserved. Unsupported adapters retain their original fetch path. Response byte archives and unsupported adapter wire payloads are unavailable; parsed items are not network bytes. |
| MCP | Connection/RPC IDs, request/notification/connection facts and registry server links. Supervision keeps one logical operation with new attempt IDs on actual restarts; incoming shared notifications deliberately have no conversation/content owner. Connection, wire-frame, duplicate-reply and supervisor fixtures pass. Captured JSON-RPC frames are not transport byte archives; unsupported wire evidence stays explicit. |
| Client delivery/UI | Submission/stream/delivery/projection and first/final paced DOM commits join request/conversation/submission/stream/message/block IDs. Bounded uploads, epoch policy, registry parity and persistent outage-aware badge. Real paced-text and badge fixtures pass. DOM commit is not screen paint; historical remounts are display observations, not new executions. |
| Native host | Separate bounded 2,000-event ring, host-only ingestion, verified device provenance, request/stream/byte/lifecycle IDs and command-arrival IDs. Real loopback receipt fixture and source-ingest tests pass. Diagnostic/service arrivals avoid recursive recording. Detached-browser creation/focus has separate start/end outcomes. Other window/clipboard/remote-management completion and generic IPC-to-transport parent joins are unsupported; plugin-managed OS UI calls are outside custom IPC capture. |
| Background commands/media/retrieval/hooks/skills/snapshots | Detached process/media lifetimes; invocation/submission/request links for title/improve/describe; title retry scope distinct from authorization; resolved media targets and retrieval fallback attempts; snapshot, command expansion and skill packaging boundaries. New tools/MCP/agents through these registries inherit their boundaries. Per-storage-row and arbitrary internal function tracing are intentionally excluded. |
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
