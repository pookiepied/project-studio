# Studio Inspector

Studio Inspector is a separate project in `studio-inspector/`. It consumes
Studio's version 1 observation/export contracts. Studio owns execution and
capture consent; Inspector owns local evidence retention and read-only queries.
The external tool imports no runtime internals and opens no Studio databases.

## Desktop sharing boundary

The native `diagnostic_inspector_configure` command is an explicit user action
from local Diagnostics settings. Its status reader and sharing worker are
diagnostic self-control and excluded from event capture to avoid feedback.
Neither command changes capture or grants authority. Native UUIDs identify
feed, snapshot and admitted request separately from original execution IDs.

Sharing starts disabled on app launch. The native owner retains its credential
and reads only fixed GET `/api/diagnostics` and `/api/diagnostics/events` routes
from its owned harness endpoint. No redirects are followed. Boot/capture/policy
checks on each page and at completion prevent mixed-epoch snapshots. Page/byte
limits bound the independent worker, which waits three seconds between reads.
The credential never enters the exported frame.

The fixed app-data `inspector-feed.json` file is a local export surface. Atomic
replacement publishes a complete snapshot. Generation/revision fences reject
writes after disable or clear. Clear/exit/startup remove the owned snapshot.
Errors use fixed status values and cannot change Studio's execution result.
Crashes can leave a stale file; the collector refuses it after 15 seconds.
Consent synchronization is not an instantaneous distributed transaction. The
local filesystem/account is the access boundary; do not publish this directory.

## Independent evidence boundary

The collector reads an explicitly selected feed or imports supported diagnostic,
native, conversation-journal and Inspector archives. Redaction precedes SQLite
persistence; content also requires `--include-content`. Source capture determines
what was originally available. Heuristic redaction cannot guarantee arbitrary
free text contains no sensitive information.

Namespaces separate installation/source labels and harness/native/history
evidence. Existing opaque entity/event/boot IDs survive. Inspector sessions and
inspection calls use independent crypto UUIDs. A session groups an original
conversation within an installation label. Native events without a conversation
stay source-level evidence. Receipt cursors do not establish execution causality.

Policy-processed envelopes and content-addressed payloads remain separate.
Source health records loss, feed provenance, omissions and collector failures.
Durable live watermarks and event uniqueness prevent repeated snapshots,
including evicted events, from becoming new execution. Transactions roll back
rows and watermarks together. Evidence evicted before collection is unavailable.

Retention is 20,000 events / 32 MiB logical evidence / seven days of receipt age,
pruned on ingestion or collector failures. SQLite has a separate 128 MiB page
ceiling. Input, event, payload, health, query and wait bounds are independent.
Stopped collectors leave archives until resumed or erased. Clearing Studio or
stopping sharing does not erase independent Inspector archives or exports.

## Consumer boundary

The stdio MCP process opens only Inspector's configured store, read-only. It
provides status, sessions, overview, timeline, operation, source timeline, raw
event, payload and bounded live waits. Operator CLI owns import, source choice,
export and deletion. Captured material is untrusted evidence, never instructions.
There is no execution, replay, abort, capture-control, generic file/network/SQL
or automatic repair tool. Unknowns, omissions and independent clocks stay explicit.

Overview separates logical tools and failed boundary observations, and counts
deduplicated leaf runtime-turn usage. Missing settlement does not prove a stopped
submission. Hidden reasoning, unmeasured provider time, cost and causal blame are
not invented. A bounded watch is an active query, not a permanently running AI.

Operating instructions and supported local/tunnel connections live in
`studio-inspector/README.md`; verification lives in the implementation tracker.
