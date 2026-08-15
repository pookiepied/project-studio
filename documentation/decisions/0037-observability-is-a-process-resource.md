# ADR 0037: Observability Is A Process Resource

Status: Accepted

## Context

ADR 0035 removed the storage singletons. `getDatabase()`/`closeDatabase()` were
module-level state that any module could reach for, which meant a test setting
`PROJECT_STUDIO_STORE_PATH` silently got whichever connection was opened first
and could not tell. `app.ts` is now the sole composition root for the database
and the sole owner of closing it.

That left one module-level singleton: `handle` in `observability/index.ts`,
recorded as issue #24b. The question is whether it is the same defect, and the
honest answer is no.

The difference is not that observability is more important. It is that
`initializeObservability` does not create a private resource — it starts an
OpenTelemetry SDK that registers **global** providers with the OpenTelemetry
API. The process has exactly one tracer provider whether or not we hold a
reference to it. Threading a handle through constructors would give that one
thing a second name, and the two could then disagree.

## Decision

**The observability handle stays process-wide, and is not injected.**

It is accepted on the strength of the properties #24 was missing, all of which
this already has:

- **Guarded initialization.** A second `initializeObservability` throws
  `TelemetryError("already_initialized")`. The storage globals silently shared.
- **An explicit end.** `shutdownObservability()` unregisters Flue
  instrumentation, shuts the SDK down, and clears the handle.
- **State is returned, not just set.** `resetRedaction()` restores the shipped
  defaults, so a later start does not inherit the last one's overrides.
- **Reading before initializing is an error, not a default.**
  `getObservability()` throws rather than lazily constructing one.

A global that can only be entered once, must be left explicitly, and refuses to
be read before it exists is a resource with a lifecycle. That is a different
thing from an ambient default, and only the second kind was the defect.

`app.ts` still owns the lifecycle: it initializes during composition and calls
`shutdown()` on the way out, in the same `finally` that closes the database.
What it does not do is pass the handle to constructors that would otherwise
reach for the global — because for this resource there is nothing else to
reach for.

## Consequences

**Good.** No second name for the OpenTelemetry global. Startup order stays
explicit: providers are validated, the SDK starts, then Flue instrumentation
registers against it. Tests get determinism from `shutdownObservability()`
rather than from module reloading.

**Costs.** An argument for keeping a global is worth nothing unless the
properties it rests on are checked, so the three claims above are now tests in
`observability.test.ts` — read-before-init throws, shutdown clears the handle
so a later start succeeds, and shutdown returns redaction to the shipped
defaults. Two were mutation-verified: removing `resetRedaction()` or
`handle = undefined` from `shutdownObservability` each fails the suite.

There is deliberately **no** architecture-test whitelist entry. The guard in
`architecture.test.ts` is specific to `storage/database.ts` — it forbids a
module-level `StudioDatabase` binding and the ambient accessors, which is the
shape #24 was about. This ADR does not widen it into a general "no module
state" rule with an exception carved out, because that rule would then be
enforced by whoever remembered to add themselves to a list. Behaviour is
checked here instead of shape.

**Not decided here.** Whether a component that wants a logger should take one
as an option rather than call `getLogger()`. Injection is still preferable at
the *call* level for testability; this ADR is about where the handle lives, not
about how every consumer reaches a logger. `StudioRuntime` already takes
`logger` as an option, and that pattern stands.

## Related

- ADR 0035 — runtime composition and ports; the storage singletons removed.
- ADR 0004 — observability; what is collected and why.
- Issue #24b in `work/phases-1-11-remediation.md` — the item this closes.
