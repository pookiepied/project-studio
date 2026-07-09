# Local Runtime & Frontend Reorg — Task Index

> **Status:** STRUCTURAL WORK COMPLETE. Phases 0–7 are all done and verified by
> `tsc --noEmit` + `vite build`. All 11 audit findings in doc 06 are resolved
> (B4 and B5 were fixed on request after the structural phases; B11 is a
> documented edge, no change).
>
> **The only thing outstanding is the behavioral smoke test** that every phase's
> "Done when" box calls for — start the app, open a chat, run a local tool,
> confirm the card renders and results return. That needs a desktop session and
> has not been run.
>
> This folder is the single, self-contained plan for two linked pieces of work on
> the `STUDIO/` desktop app:
>
> 1. **Name and centralize the Local Runtime** — the currently-nameless subsystem
>    that lets the cloud agent execute tools on the user's own machine.
> 2. **Reorganize `STUDIO/src/`** into a clean, feature-honest structure with real
>    imports instead of code smeared across unrelated folders.
>
> An AI agent or a developer should be able to read these documents **in order**
> and execute the whole migration without asking anyone questions and without
> reading any other document in the repository.

---

## Scope lock (read this first)

This plan assumes the **current, post-pivot architecture**:

- There is **ONE agent loop**, and it runs **in the cloud** (the `chat/` Cloudflare
  Worker / Durable Object). There is **no** local agent loop. We are **not**
  building a portable/in-process loop.
- The **daemon stays** (`STUDIO/daemon/` — the local Ollama / LM Studio proxy). It
  is not being removed.
- The **CLI Bridge** (`STUDIO/src/cliBridges/`) is a **real, shipping feature** and
  is **out of scope**. Do not move, rename, or refactor it. (It has Codex /
  OpenCode / KiloCode integrations planned. Leave it alone.)

> ⚠️ **Any older task folder under `Documentation/Tasks/` is RETIRED and INVALID.**
> They were written for a split cloud/local-loop scope that no longer exists.
> Do not read them, do not reconcile with them, do not follow them.

---

## Documents

| # | Document | Purpose |
|---|---|---|
| 01 | [01-HOW-IT-WORKS-TODAY.md](01-HOW-IT-WORKS-TODAY.md) | Ground truth: how the Local Runtime data path works end-to-end today (Rust ↔ WebSocket ↔ cloud), and the concrete structural problems in `STUDIO/src/`. Read this to build the mental model. |
| 02 | [02-NAMING-AND-DECISIONS.md](02-NAMING-AND-DECISIONS.md) | The name ("Local Runtime"), why, and every settled decision with reasoning. Check here before making a call that might re-litigate something. |
| 03 | [03-TARGET-STRUCTURE.md](03-TARGET-STRUCTURE.md) | The finished target: the `src/` top-level layout and the internal shape of the `runtime/` module. What each directory owns. |
| 04 | [04-FILE-MOVE-MAP.md](04-FILE-MOVE-MAP.md) | Exhaustive current-path → target-path table for every file that moves, every rename, every monolith to split, and the dead-code list (each marked VERIFY-FIRST). |
| 05 | [05-EXECUTION-PLAN.md](05-EXECUTION-PLAN.md) | The ordered, phase-by-phase runbook for an LLM to execute. Each phase has goal, why, exact steps, verification, and a done-when checklist. **This is where you work from.** |
| 06 | [06-SUBSYSTEMS-AND-AUDIT.md](06-SUBSYSTEMS-AND-AUDIT.md) | The full subsystem inventory (~15), how they share code (cross-cutting hubs + import direction), the two transports, and the code audit (11 bugs/risks found, with disposition). Read this to see the whole system as subsystems, not files. |

## Revision note (cross-reference pass)

After the first draft, the plan was re-verified against the source. Three moves were
corrected because they would have created a `runtime → features` import cycle or
coupled two subsystems by accident:
- `useAgentChat` is runtime transport glue → moved to `runtime/transport/`, not chat.
- `services/ai/types.ts` is split by consumer; shared DTOs go to `src/types/` (D-9).
- `mcpService` (cloud MCP registry) is dual-use → `core/mcpRegistry/`, not runtime.
Also: the daemon was confirmed **HTTP/SSE, not WebSocket** (D-10). See doc 06 for the
full subsystem map and the 11-item audit.

## Reading order

- **First time / cold start:** 01 → 02 → 03 → **06** → 04 → 05.
- **Resuming mid-migration:** open **05**, find the first phase whose "Done when"
  box is unchecked, then re-read that phase. Glance at **02** so you don't undo a
  settled decision.
- **Unsure where a file goes:** **04** is the lookup table.

## How to work from this plan (for the executing agent)

1. Work **one phase at a time**, in the numbered order in doc 05. Do not skip ahead.
2. After each phase, run the phase's **Verification** commands. The app must
   type-check and build at the end of **every** phase — never leave the tree broken
   between phases.
3. Prefer **git-aware moves** (`git mv`) so history is preserved and the diff is
   reviewable as "renames," not "delete + add."
4. When a phase says **VERIFY-FIRST** before deleting a file, actually grep for its
   imports and show the evidence. Do not delete on assumption.
5. Commit at the end of each phase with the phase name in the message. One phase =
   one reviewable commit (or PR).
