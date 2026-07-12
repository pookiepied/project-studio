# Frontend Audit — Brief

> **For the operator (human):** hand each prompt in `01-AGENT-PROMPTS.md` to a separate
> agent session. Collect the seven reports into `reports/`. They are the input to the
> architecture pass, which happens back in Claude Code with the technical lead.

## What this is

A **read-only** current-state audit of `STUDIO/src/` — the desktop frontend of Project
Studio, a Tauri + React 19 + TypeScript + Tailwind app.

It exists because the work queue up to now was generated entirely by tools (eslint,
madge, knip). Tools find raw `<button>` elements and circular imports. They cannot see
an incoherent feature folder, an error system with three competing conventions, or a
React component quietly shelling out to the filesystem. Those are the actual subject of
`Documentation/frontend-loop-engineer-master-prompt.md`, and none of them are in the
queue, because nothing we can install can see them.

Your job is to see them.

## Absolute rules

1. **Change nothing.** No edits, no file creation, no renames, no deletions, no
   formatting, no commits, no branches. If you catch yourself opening an editor, stop.
2. **Cite evidence for every claim**, as `path/to/file.ts:123`. A finding without a
   file:line is an opinion, and it will be thrown out.
3. **Do not propose fixes.** Not in passing, not as a footnote. Describe what exists and
   what is wrong with it. An agent that starts designing the solution stops observing
   the problem, and the architecture decision belongs to the humans downstream.
4. **Distinguish what you verified from what you suspect.** Label uncertainty. "I did not
   check X" is a valuable sentence. A confident wrong finding costs more than a missing one.
5. **Do not summarize the codebase back to us.** We can read. Report what is *wrong*,
   what is *inconsistent*, and what *surprised* you.
6. **Read the code, not the comments.** Comments in this repo have already been found
   stale. Where a comment contradicts the code, that is itself a finding.

## Ground truth — do not re-derive this

A quality gate already exists (`cd STUDIO && npm run gate`). Measured 2026-07-10:

| Check | Result |
|---|---|
| `tsc --noEmit` | clean, 0 errors |
| eslint errors | 232, across 93 files, **all** the raw-`<button>` rule |
| circular imports (madge) | 10 (was 11; one fixed) |
| unused files (knip) | 0 |
| unused dependencies | 0 |
| unused exports / types | 336 / 126 — mostly barrel re-exports, **not** a delete list |

Do not spend time re-finding these. They are known, queued, and boring. Everything
interesting is what these numbers cannot show.

Note the gate's blind spot, discovered while fixing a cycle: **madge only reports
dependencies that close a loop.** `runtime/execution/types.ts:15` imports from
`@/features/chat/context/types` — `runtime/` depending on `features/`, a layering
inversion — and no tool in this repo reports it. Assume there are more. Finding them is
squarely your job.

## Scope

**Audit:** everything under `STUDIO/src/`. All of it, including `cliBridges/`.

**Do not audit:** `STUDIO/daemon/`, `STUDIO/src-tauri/`, `STUDIO/library/mcp-servers/`,
`STUDIO/vendor/`, and the backend services at the repo root (`chat/`, `api/`, `auth/`,
`gateway/`, `gateway-v2/`, `ai/`, `skills/`). Where `src/` depends on them, **describe
the dependency and where it crosses** — that boundary is one of the most important
things you can report. Do not read the backends to do it.

### About `cliBridges/`

`STUDIO/src/cliBridges/` (5 files) is a **live, load-bearing subsystem** with planned
Codex / OpenCode / KiloCode integrations. It has previously been misidentified as dead
code. It is not. Audit it like everything else. Nothing about it is to be removed.

## The architecture this is measured against

From the master prompt. The target separates:

- **App shell** — startup, routing, providers, layout, boot sequence, version/update checks
- **UI layer** — pure visual components, primitives, no business logic
- **Feature layer** — feature-owned UI, state, services, hooks, types, constants
- **Runtime / desktop-backend layer** — Tauri bridge, filesystem, shell/process, software
  detection, updates. Called by UI through typed services. Native details stay inside it.
- **Shared layer** — cross-feature types, constants, utils, validation, error normalization
- **Design system** — tokens, typography, spacing, radius, shadows, z-index, variants
- **Error system** — one normalized error shape, one user-message resolver, one logging
  path, one reusable error UI, one boundary. No raw internals shown to users. No scattered
  `console.error`.

Your report says how far the code is from that, with evidence. It does not say how to
close the gap.

## Deliverable

One markdown file per slice, following `02-REPORT-TEMPLATE.md` exactly. Write it to
`Documentation/Tasks/Frontend Audit/reports/<slice-id>.md`.

Length is not a virtue. A precise, evidence-dense three pages beats a discursive ten.
