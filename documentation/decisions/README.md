# Decisions

Choices with alternatives, and why one was taken.

## Two registers, on purpose

**Harness-internal rules stay as ADRs** in `STUDIO HARNESS/docs/decisions/` —
numbered `0001`–`0034`, each stating what it amends. That is where they were
written, that is where the code references them, and moving them would break
every citation in the source for no gain.

**`D-NNN` nodes here** are for decisions that span products, or that concern the
project rather than the runtime: what the Gateway contract is, how the tree
system works, what ships in 1.0.

If a decision only changes how the Harness behaves internally, it is an ADR.

## Harness ADRs worth knowing

Not an index — the full list is in that folder. These are the ones current work
keeps running into:

| ADR | Subject |
|---|---|
| 0007 | Secure credential storage — secrets in the OS keychain, never in a database |
| 0010 | Application-owned database — why `studio.db` is separate from `flue.db` |
| 0012 | Permission and containment — the kernel decides, never executes, never prompts |
| 0019 | `execute` admitted for native capabilities as uncontained by consent |
| 0029 | MCP permission ordering — amended by `008.16` |
| 0030 | Local execution identity; multi-user deferred |
| 0032 | Fail-safe runtime recovery |
| 0033 | Execution identity and operation correlation |
| 0034 | Modular-monolith exception — **disputed**, see `../audits/A-002-...md` |

## ADR 0034

It records a narrowly scoped exception permitting `StudioRuntime` to keep its
public repository bags and the SQLite handle to stay public, so that `008.3`
could be closed.

`A-002` disputes the framing: the exception was taken instead of the fix, and
the tests written alongside it assert the violations rather than their absence.
`T-004` closes the gate properly. When it lands, 0034 should be superseded by an
ADR that says what actually holds — not amended to look as though it always did.
