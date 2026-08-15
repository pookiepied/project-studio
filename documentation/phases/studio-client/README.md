# Studio Client — phases

The Tauri desktop application. **No phase plan of its own yet.**

The eighteen-phase plan was written for the Harness. The client has been built
alongside it as the Harness needed a host — process supervision, FD3/FD4
bootstrap, endpoint delivery, and a chat surface over `@flue/sdk` — rather than
against a plan of its own.

## What exists

| Area | Where |
|---|---|
| Tauri host and Harness supervisor | `STUDIO/src-tauri/src/harness/` |
| Harness client and endpoint handling | `STUDIO/src/platform/harness/` |
| Chat session over `@flue/sdk` | `STUDIO/src/features/chat/` |

## Why there are no nodes yet

Task 008 draws a deliberate UI boundary: API routes, schemas, typed client
interfaces, Tauri host lifecycle, and contract tests are in scope for closing
phases 1–11; screens, settings pages, and product flows are not.

So the client work that matters right now belongs to Harness nodes — the Host
lifecycle and client contract items in `008.19`, and `B-002`.

## When this gets its own phases

Once the Harness 1–11 gate closes and product UI starts, the client needs its
own plan and its own `P-NN` nodes under this folder. Until then, tracking it
separately would create nodes with nothing in them.

## Links

- `B-002` — Windows Host runtime verification.
- Task 008 `008.19` — Host/client API boundary.
