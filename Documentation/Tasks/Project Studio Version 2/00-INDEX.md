# Project Studio Version 2 — Documentation Index

> This folder is the single self-contained home for the Phase 2 (Version 2) refactor.
> An AI system or developer should be able to read these documents in order and
> understand the project without hunting through the repository.

| # | Document | Layer | Purpose |
|---|---|---|---|
| 01 | [01-CURRENT-SYSTEM.md](01-CURRENT-SYSTEM.md) | Architecture | Mental model of the system as it exists today — workers, bindings, data flow, sizes, problems |
| 02 | [02-TARGET-ARCHITECTURE.md](02-TARGET-ARCHITECTURE.md) | Architecture | What Version 2 looks like when finished, and why each piece is shaped that way |
| 03 | [03-DECISION-LOG.md](03-DECISION-LOG.md) | Architecture | Every settled decision, its reasoning, and its status (including reversed proposals) |
| 04 | [04-EXECUTION-PLAN.md](04-EXECUTION-PLAN.md) | Implementation | Exact migration order: phases, folders, cutover steps, verification |
| 05 | [05-COMPONENT-REPLACEMENT-MAP.md](05-COMPONENT-REPLACEMENT-MAP.md) | Architecture (code-level) | File-by-file: every existing component → its replacement, per environment |
| 06 | [06-AGENT-RUNTIME-DESIGN.md](06-AGENT-RUNTIME-DESIGN.md) | Architecture (code-level) | Agents SDK removal analysis (D14), replacement primitives, cloud/local parity matrix (D13) |
| 07 | [07-VERCEL-AI-SDK-USAGE.md](07-VERCEL-AI-SDK-USAGE.md) | Architecture (code-level) | AI SDK v7 feature inventory; what we use / don't / should; ADOPT-EVALUATE-AVOID buckets for maximizing SDK over custom code (D8/D9) |

## Reading order

- **New to the project?** 01 → 02 → 03 → 04.
- **Resuming work?** 04 (find the current phase) + 03 (check nothing you're about to do re-litigates a decision).
- **Making a new decision?** Record it in 03 before implementing.

## Relationship to other documents in the repository

These remain valid and are referenced from here — they are build guides for specific
workers, one level below this documentation:

- `../../../SYSTEM_ARCHITECTURE.md` — full source-derived audit of the current system (long form of doc 01)
- `../../../gateway-v2/GATEWAY_GUIDE.md` — Gateway v2 build guide (locked)
- `../../../ai-v2/AI_GUIDE.md` — studio-ai build guide (amended by D4/D8/D9/D14; amendment list in doc 06 §8 — edit into the guide at P3.1)
- `../../../STUDIO_MASTER_PLAN.md` — JWT/auth decisions (§0 still final)

Older planning docs at the repo root (`CHAT_REFACTOR_*.md`, `STUDIO_AGENT_TOOL_PLAN.md`,
`MCP_PUBLIC_PLAN.md`, `PHASE2_REFACTOR_GUIDE.md`) are **superseded** by this folder.
