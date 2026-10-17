# Project Studio development rules

Studio is the combined `STUDIO HARNESS` runtime and `STUDIO` desktop/browser
client. Preserve unrelated working-tree edits. The external AI inspection tool
is a separate project and is not part of implementing Studio's instrumentation.
Read `README.md`, `documentation/rules.md` and the documentation structure before
working. Run full harness/client suites sequentially; they share sandbox resources.

## Identity and observability are part of every feature

Read [the developer contract](documentation/architecture/observability.md) before
adding an effectful entry point, tool, MCP integration, agent, provider, background
job, HTTP route, native command, or client transport. Apply it to the new feature
in the same change; do not leave instrumentation as a follow-up by default.

- Reuse existing entity IDs. Generate new harness IDs through
  `STUDIO HARNESS/src/contracts/uuid.ts`, client IDs through `STUDIO/src/lib/id.ts`.
  Native host IDs use `STUDIO/src-tauri/src/identity.rs`.
  Preserve opaque external IDs and map them; never migrate old IDs gratuitously.
- Keep request, logical operation, attempt, event, process boot, connection,
  trace/span and external runtime IDs distinct. Correlation does not authorize,
  guarantee idempotency or permit an automatic resend.
- Propagate the existing execution parent. For harness-owned asynchronous work,
  use `observeOperation` or the applicable already-instrumented boundary. Emit
  operational facts through `recordObservation`; use stable stage names.
  Bind asynchronous callbacks with `createObservationWriter` so cleared/replaced
  capture epochs cannot receive old operation content. Detached jobs use
  `OperationObservation` and keep cancellation requests separate from confirmed exit.
- Put bodies, prompts, reasoning, tool arguments/results and stacks only in gated
  `content`, never in attributes, IDs or event names. Credentials and environment
  values must never be recorded. Preserve exact product results/exceptions even
  if recording fails. Keep capture bounded and passive.
  Object content must use a bounded source-frame, snapshot index, or declared-field
  factory; the recorder type rejects bare objects. Reuse source serialization and
  indexes rather than enumerating foreign objects. Label projections and omissions.
- Report unsupported/missing/dropped evidence honestly. A stream ending is not a
  submission completing; replay is not a new execution. Preserve user capture
  policy and do not enable collection/upload merely because a build is debug.
- Update the coverage inventory and contract when adding a new boundary. Add
  meaningful failure/identity/privacy tests for changed behavior and run the
  relevant checks. Review the diff for uninstrumented paths and scope leakage.

## Checks

Harness: `pnpm -C "STUDIO HARNESS" check`.
Client: `pnpm -C STUDIO check`.
Native host changes also require appropriate `cargo test` checks under
`STUDIO/src-tauri`. Tests must use isolated state rather than the user's Studio
home. Keep provider code under the gateway and database access under storage.

The active implementation and remaining coverage are tracked in
`documentation/work/studio-observability-progress.md`. A green focused test suite
does not prove the full Studio readiness gate is complete.
