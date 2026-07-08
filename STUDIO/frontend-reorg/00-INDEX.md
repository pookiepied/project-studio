# Frontend Reorg — Task Folder

**Status:** PLANNING / staged. Nothing has been moved yet. This folder is the
authoritative go-forward target for reorganizing `STUDIO/src/`. It **supersedes**
the old `STUDIO/frontend-revamp/` doc set (`02-PLAN §2` target in particular).

## Why this folder exists

The `frontend-revamp/` work (Phases 0–5 `☑`, Phase 6 mostly done) built toward an
older `components/contexts/hooks/services/utils` target. That target is now
**retired** — we are reorganizing into a domain-honest structure that also makes
room for the incoming **local agent loop** (the current chat, refactored into a
portable loop that runs both in the cloud and in-process on the user's machine).

When the reorg is executed, the six `frontend-revamp/` files get collapsed: the
load-bearing decisions were salvaged into `04-DECISIONS-AND-CARVEOUTS.md` here,
and the rest (intent, audit snapshot, old plan, phase summaries) can be deleted.

## Files

| File | What it holds |
|---|---|
| `01-ARCHITECTURE.md` | The system context that drives the structure: two domains (cloud/local), two engines (Studio AI / Claude Code), the agent-loop deployment model, registries, gateway, pairing. |
| `02-TARGET-STRUCTURE.md` | The target `src/` tree and what each top-level directory owns. |
| `03-PLACEMENT-AND-PURGE.md` | Current-dir → target-dir map, the purge list (daemon/legacy/dead), and the migration caveats we learned the hard way. |
| `04-DECISIONS-AND-CARVEOUTS.md` | Salvaged load-bearing decisions: D-401 strict-neutral, the carve-out registry (the legend for `eslint-disable` markers already in the code), lint-enforce state, and the deferred design debt (the "later pass"). |
| `05-MIGRATION-ORDER.md` | Leaf-first execution sequence with the dual-build gate. |

## The one deferred design note

The `ai/studio` loop must be **runtime-agnostic** (no DOM / React-render deps) so
the *identical* package runs in a Cloudflare Worker **and** in the Tauri desktop
app. The React side is a thin driver on top. This matters when we *build* the
loop — it does **not** block the reorg, which only reserves the `ai/` home and
relocates the Claude Code bridge. See `01-ARCHITECTURE.md`.
