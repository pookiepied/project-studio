# ADR 0036 — A user decision is durable

**Status:** Accepted · 2026-08-15

## Decision

**Anything the user has answered, or is currently being asked, lives in SQL.**
Never in process memory. A Harness restart re-presents the pending question and
honours every answer already given; the run continues from there.

This covers permission approvals, grants, trust decisions, and any future
prompt that waits on a person. It is a standing rule, not a one-time fix.

## What it does not cover

In-process state that a restart *should* lose: caches, live MCP connections,
supervisor entries, registered tool descriptors, resolved binary paths. These
are reconstructions of current reality, not records of a decision. Persisting
them would restore stale facts, which is worse than rebuilding them.

The test is: **would a person be asked the same question twice?** If yes, it is
durable. If it merely costs work to rebuild, it is not.

## State today

Audited across `src/` on 2026-08-15. Grants (`permissions/grant-store.ts`) and
trust (`permissions/trust.ts`) are already SQL-backed and compliant.

One violator: `application/approval-broker.ts` holds pending approvals in a
`Map`. A restart loses every in-flight approval, and the run that was waiting on
one cannot continue. That is meta-task #16, and it is closed by adding migration
009 with a durable `pending_approval` table.

## Consequence

A new prompt-shaped feature must ship with its table. Reviewing one without
asking where its rows live is the failure this ADR exists to prevent.
