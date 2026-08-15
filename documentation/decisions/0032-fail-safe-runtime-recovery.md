# ADR 0032: Fail-Safe Runtime Recovery

Status: Accepted

## Context

Project Studio has two local runtime persistence domains. Flue owns the
canonical agent conversation, accepted direct submissions, turn journals,
leases, recovery, tool-call records, and runtime events in `flue.db`. Project
Studio owns application state in `studio.db`; credentials remain in the OS
keychain, snapshots remain in the snapshot filesystem, and process-local state
is disposable.

The client connection is not the owner of execution. A request may disconnect
after admission, and a Harness process may disappear while a submission is
running. Recovery must therefore be defined by durable ownership and
reconciliation rather than by the lifetime of an HTTP request or UI process.

## Decision

1. **Admission:** an accepted direct submission receives Flue's durable
   `submissionId`, stream URL, and resume offset. After that point, the
   submission belongs to Flue, not to the submitting connection.
2. **Normal execution:** Flue owns the ordered submission queue and one live
   owner for each agent instance. Durable canonical conversation records are
   the source of truth; Project Studio does not create a second transcript.
3. **Graceful shutdown:** the Host stops admitting new work, asks the Harness to
   drain, and closes Project Studio resources. Flue leaves unfinished accepted
   submissions reclaimable at a turn boundary.
4. **Unexpected termination:** a replacement Harness reopens the same Flue
   database. Flue's lease and attempt reconciliation resumes only work that is
   safe to resume. Completed output and completed tool results are reused. A
   tool call with no durable result is treated as unknown and is not replayed
   automatically.
5. **Streaming:** a client that already has an admission result reconnects with
   the same submission stream and durable offset. Reconnection may replay the
   transport boundary, but canonical materialization must not duplicate the
   conversation.
6. **Ambiguous initial admission:** the current Flue SDK does not expose an
   application idempotency key for the initial `send`. If the admission response
   is lost, the client must treat the submission as unknown and must not blindly
   resend it. A future Project Studio ingress may add an idempotency and
   reconciliation contract before enabling safe retries.
7. **Application state:** `studio.db` is opened, migrated, and closed by the
   Project Studio runtime. It is never merged with Flue's schema. A failure in
   one database must not silently recreate, wipe, or reinterpret the other.
8. **Child ownership:** the headless launcher, process substrate, and MCP stdio
   channel create detached POSIX process groups; forced teardown addresses the
   group. The Tauri Host uses the same group ownership rule and reaps a dead
   Harness before returning a stale endpoint.
9. **Side effects:** a capability's `idempotent` descriptor is the retry
   authority. Native writes and read-only operations may be retried only when
   their declared effect is safe; edits, shell, Git, and MCP calls with unknown
   completion are reported for state inspection and are never replayed blindly.
   Snapshot operations are serialized, failed queue links are released, and the
   shadow repository remains durable for inspection.
10. **Scope:** this ADR covers direct agent submissions and the Harness/Host
   lifecycle. Product task graphs, durable workflow orchestration, subagent
   ownership, artifact checkpoints, and deletion semantics remain later product
   scope unless Task 008 explicitly promotes a boundary.
11. **Identity:** Project Studio-generated UUIDv4 values use the central
   `src/identity/uuid.ts` policy. This covers owned sessions, approvals, grants,
   tasks, and future idempotency keys. Flue submission/conversation ids remain
   opaque Flue-owned values; stable provider, MCP, capability, and project keys
   are domain identifiers and are not replaced with random UUIDs.

## State Model

```text
client request
    -> admitted (submissionId + stream offset)
    -> queued -> running
                    |\
                    | +-> completed
                    | +-> failed
                    | +-> aborted
                    | +-> interrupted/unknown -> reconcile on replacement
                    |
                    +-> lease expires -> fenced recovery attempt
```

The client observes and commands this state through the admitted API. It does
not infer completion from an open connection, spinner, or process-local memory.

## Consequences

- File-backed SQLite is sufficient for same-host process replacement; it does
  not provide active-active ownership or host-loss durability.
- The Host/Supervisor owns process survival. Flue owns execution recovery.
  Project Studio owns policy, application state, and explicit cross-domain
  compensation.
- External side effects still require application-level idempotency or an
  explicit unknown outcome. Conversation durability does not make filesystem,
  shell, network, provider, or MCP effects automatically reversible.
- Workflow APIs must not be used as a substitute for resumable direct-agent
  submissions; interrupted Node workflows remain a separate limitation.

## Evidence

- `tests/integration/harness.test.ts` proves clean restart recovery, SIGKILL
  recovery, cold-start conversation persistence, and Flue/Studio database
  separation.
- `tests/unit/process.test.ts` proves forced termination removes a descendant
  from the POSIX process group rather than leaving an orphan.
- `tests/unit/storage.test.ts` proves empty/corrupt files are not initialized or
  rewritten, interrupted transactions remain valid, lock contention is bounded,
  and disk-full/read-only driver failures map to bounded storage errors.
- `src/app.ts` closes partially composed runtime resources on startup failure and
  exposes one idempotent shutdown path.
- `src/identity/uuid.ts` is the single TypeScript generator/validator for
  Project Studio-owned UUIDv4 identities.
- `src/db.ts` configures Flue's file-backed adapter at the Studio data path.
- `src/storage/database.ts` owns the separate application database and its
  migrations.
- Flue's pinned Node durable-execution contract defines lease reconciliation,
  fenced attempts, durable offsets, and conservative unknown tool outcomes.
