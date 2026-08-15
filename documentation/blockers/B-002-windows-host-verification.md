# B-002 — Windows Host runtime verification

**Parent:** P-01..P-04 / A-001 (task 008, `008.1`)
**Status:** Blocked — Accepted for 1.0
**Opened:** 2026-08-13 · **Closed:** —

## What is blocked

Runtime proof of Tauri Host process-group ownership, descendant cleanup, and
`taskkill` behaviour on Windows.

## Why it is blocked

Needs a Windows runner (GitHub Actions `windows-latest`, or a Windows machine
running the Rust toolchain and the Host lifecycle suite). The code exists; the
environment to prove it does not.

## Current state

- **Linux: Done.** `cargo check` passes; process groups, forced descendant
  cleanup, and dead-child reaping are implemented and verified.
- **Windows: Accepted for 1.0.** Implemented, not runtime-verified.
- **macOS: Deferred.** Outside 1.0 scope; no Mac hardware.

Explicitly **not** a blocker for closing `008.1`/`008.2`.

## What would unblock it

1. `cargo check --manifest-path STUDIO/src-tauri/Cargo.toml` on Windows.
2. Host lifecycle suite: readiness, SIGKILL, descendant cleanup, restart, stale
   endpoint rejection.
3. Packaged sidecar/resource resolution check.

Must not be closed from TypeScript or source review alone.

## Note

This project is developed on Windows 11. The runner gap is CI, not access —
step 1 is available locally today and is the cheapest way to shrink this.

## Links

- `T-004`, task 008 `008.20`/`008.21`, ADR 0032.
