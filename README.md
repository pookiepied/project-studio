# Project Studio

A local-first environment for coding work driven by agents, built as separate
products designed to work together.

| Product | What it is | Where |
|---|---|---|
| **Studio Harness** | The runtime — agents, permissions, sandboxing, policy, execution, storage, MCP. | `STUDIO HARNESS/` |
| **Studio Client** | The Tauri desktop application over the Harness. | `STUDIO/` |
| **Studio Gateway** | Legacy hosted model gateway. **Paused** — reference only. | `STUDIO Gateway/` |

The Harness is the primary codebase.

## Where to start

**[`documentation/`](documentation/README.md)** — how the project is managed.

1. [`documentation/tree/conventions.md`](documentation/tree/conventions.md) — how work is recorded.
2. [`documentation/tree/project-tree.md`](documentation/tree/project-tree.md) — what is done and what is not.
3. [`documentation/PROJECT-MAP.md`](documentation/PROJECT-MAP.md) — where everything lives.

## State

Phases 1–11 of the Harness are implemented and under remediation. None is
verified. Phases 12–18 have not started and should not begin until the 1–11
gate closes.
