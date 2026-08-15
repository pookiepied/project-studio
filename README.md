# Project Studio

A local-first environment for coding work driven by agents, built as separate
products designed to work together.

| Product | What it is | Where |
|---|---|---|
| **Studio Harness** | The runtime — agents, permissions, sandboxing, policy, execution, storage, MCP. | `STUDIO HARNESS/` |
| **Studio Client** | The Tauri desktop application over the Harness. | `STUDIO/` |
| **Studio Gateway** | A Cloudflare Worker, **retired**. Not built, not tested, not shipped, and not imported by the Harness. Kept only as a design reference for the local gateway that replaces it. | `STUDIO Gateway/` |

The Harness is the primary codebase.

## Where to start

**[`documentation/`](documentation/README.md)** — how the project is managed.

1. [`documentation/README.md`](documentation/README.md) — how documentation works here.
2. [`documentation/work/phases-1-11-remediation.md`](documentation/work/phases-1-11-remediation.md) — every open issue, numbered.
3. [`documentation/project-map.md`](documentation/project-map.md) — where everything lives.

## State

Phases 1–11 of the Harness are implemented and under remediation. No phase has
been verified as complete; the remediation register above is the only authority
on what is settled and what is still open, and this file deliberately carries no
counts of its own so it cannot drift out of step with it. Phases 12–18 have not
started and should not begin until the 1–11 gate closes.
