# ADR 0001: Harness Boundaries

Status: Accepted

## Context

Project Studio needs a local-first agent harness with durable conversations, resumable accepted
work, model streaming, tool calls, and a future choice between a local credential gateway and the
Studio cloud gateway.

## Decision

- Flue is the harness runtime and owns the canonical conversation stream, accepted submissions,
  recovery coordination, tool-call records, and runtime events.
- Pi is consumed through Flue. Project Studio does not run a second agent loop.
- Flue's file-backed Node SQLite adapter owns Flue runtime persistence.
- Project Studio defines gateway-neutral model selection contracts. Concrete local and cloud
  gateway registrations are deferred.
- No `app.ts`, custom HTTP routes, or direct model gateway calls are part of phases 1-4. The
  agent opts into Flue's generated standard route so its SDK can exercise durable behavior.
- Project Studio event projections may index Flue events, but they never become a second
  authoritative conversation transcript.

## Consequences

- Restart recovery follows Flue's conservative at-least-once model-call policy and does not
  blindly repeat tools with unknown outcomes.
- A single Node process owns an agent instance at a time.
- Local durability survives process restart on the same machine, not loss of the machine.
- The future UI consumes a Project Studio protocol projected from stable Flue event envelopes.
