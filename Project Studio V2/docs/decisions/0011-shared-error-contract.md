# ADR 0011: The Shared Error Contract

Status: Accepted

## Context

Four subsystems had each grown their own error class with its own `kind` union:
`StudioAuthError`, `CredentialStoreError`, `ProviderConfigurationError`,
`ModelResolutionError`. Each was reasonable alone. Together they had no common
identity, so a caller outside a subsystem could not branch on a failure without
importing that subsystem's class, and telemetry had nothing to group by.

Handling was improvised per call site: some paths logged, some annotated the
span, some did neither. Nothing aggregated.

Phases 9-18 add permissions, native tools, MCP, skills, subagents, projects,
memory, and schedules. Eight more private taxonomies is not a plan.

## Decision

### One base class, per-subsystem vocabulary

`StudioError` carries `domain`, `kind`, `retryable`, and a derived
`code` of `${domain}.${kind}`. Subsystems keep their own `kind` unions — sign-in
does not fail the way a database does, and flattening them into one enum would
lose the precision that makes the errors useful.

`StudioErrorDomain` is a closed union. Adding a subsystem is meant to be a
typecheck failure until it registers, which is what keeps the taxonomy honest as
phases are added.

### `retryable` is declared, never inferred

Each subsystem decides. Only conditions that can clear on their own are
retryable: a locked keychain, a busy database, an unreachable auth service. A
rejected key, an expired session, and a constraint violation are not.

### The reported shape has no stack and no cause

`toReport()` is the only representation that may leave the process. A stack
leaks filesystem layout, and a cause is frequently a third-party error whose
message echoes the value that failed — the credential store has been observed
doing exactly that with the secret being written. `cause` is retained on the
error for local debugging and never serialized.

### `unclassified` is a measurement, not a category

Anything that reaches the reporter without having been classified — a raw
`Error`, a thrown string, a third-party rejection — is reported under the
`unclassified` domain. That makes the gap visible: `unclassified` in a dashboard
names the code that has not been onboarded yet, instead of the taxonomy quietly
appearing complete.

### One reporting path

`ErrorReporter.report()` records to the logger, annotates the active span, and
increments a counter keyed by the same stable code, then returns the safe
projection the caller hands to a user or an API response.

Reporting is not throwing. A subsystem reports what it is about to raise or has
decided to swallow; control flow stays with the caller.

The logger is optional, because the CLIs run before OpenTelemetry is
initialized. Reporting must never become the thing that crashes a command.

## Consequences

- Every existing error class was rebased onto `StudioError` with no change to
  its constructor signature, so no call site moved.
- A UI or API can render any harness failure from `code`, `message`, and
  `retryable` without knowing which subsystem produced it.
- Failure rate becomes a single metric partitioned by `error.code` and
  `error.domain`.
- New subsystems must register a domain and throw `StudioError`. The
  `unclassified` count is the check on whether that is actually happening.
- Not addressed here: user-facing localization, and whether `message` is the
  right thing to show a user in every case. Both need a real UI consumer, which
  is Phase 18.
