# ADR 0003: Context Optimization

Status: Accepted

## Decision

Project Studio exposes a `ContextOptimizer` port and starts with a passthrough implementation.
Headroom is a future optional sidecar behind that port, not a core runtime dependency.

The canonical Flue conversation is never overwritten by optimized context. An optimizer must
preserve original content, fail open, and avoid compressing system instructions, recent turns,
or incomplete tool-call pairs. Headroom's reversible compression should be enabled if that
adapter is introduced.

## Consequences

- The TypeScript harness remains runnable without Python or Rust.
- Context compression can evolve independently from durable conversation storage.
- A failed or unavailable optimizer cannot prevent an agent submission from running.
