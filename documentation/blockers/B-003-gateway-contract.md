# B-003 — Gateway contract undecided

**Parent:** P-07 / A-001 (task 008, `008.13`)
**Status:** Blocked — decision required
**Opened:** 2026-08-13 · **Closed:** —

## What is blocked

Phase 7 cannot be called complete. The Harness has an operational
`studio-cloud` model source pointed at the legacy Gateway Worker, but that
Worker is **not a supported Harness backend** and no contract test proves
compatibility.

## Why it is blocked

The product decision has not been made. Open questions:

- Is the product Gateway Project Studio-owned, with a curated provider catalog?
- Do arbitrary/custom endpoints stay a local Harness BYOK path?
- Are third-party gateways replaceable headless backends only?
- Who owns the request/response/stream/tool-call/usage/error schemas?

## Standing direction

The legacy Gateway is **paused**. A simpler Project Studio-owned Gateway will be
built later. Specific functionality may be lifted from the old implementation,
but it moves into the correct Harness architecture — the old structure is not
preserved, and the Harness must not take a permanent dependency on it.

Retirement is tracked as `F-001`.

## What would unblock it

1. Answer the four questions above.
2. Record it as a Gateway ADR.
3. Contract tests: auth translation, catalog, enabled flags, text/reasoning
   stream, tool continuation, cancellation, provider failure, usage projection,
   and no credential in transcript/logs/errors.

Until then Phase 7 stays blocked and the Worker stays unsupported.

## Links

- `F-001`, task 008 `008.13`, old `008.17` (Deferred).
