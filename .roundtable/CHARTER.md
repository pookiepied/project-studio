# Charter — Project Studio frontend

## Goal

Make `STUDIO/src/` read as though a professional engineering team built it:
organized, predictable, typed, documented, free of AI-generated mess. Not a
redesign. No new product features.

Standing source of intent: `Documentation/frontend-loop-engineer-master-prompt.md`
(the definition of the work) and `Documentation/frontend-review-engineer-companion-prompt.md`
(the definition of review). The queue is how those get executed one piece at a time.

## Gate

```bash
cd STUDIO && npm run gate
```

Runs `typecheck` → `ratchet:lint` → `ratchet:cycles`. Exit 0 or the item is not done.

Baselines live in `STUDIO/gate/`. Both ratchets are strict: lint is keyed per-file,
cycles per-cycle. Improving either means lowering its baseline in the same commit
(`npm run ratchet:lint -- --update`).

Detectors that inform the queue but do not gate: `npm run deadcode` (knip).

**Baseline at charter time (2026-07-10):** typecheck clean · 232 lint errors across
93 files, all of them raw `<button>` · 11 circular imports · 336 unused exports,
126 unused types · 0 unused files · 0 unused dependencies.

## Scope lock

**In scope:** `STUDIO/src/`, `STUDIO/gate/`, `STUDIO/scripts/ratchet.mjs`,
`STUDIO/eslint.config.js`, `STUDIO/knip.json`.

**Out of scope — do not modify:**

- `STUDIO/src/cliBridges/` — shipping feature, deliberately excluded
- `STUDIO/daemon/`, `STUDIO/src-tauri/`, `STUDIO/mcp-servers/`, `STUDIO/vendor/`
- `chat/`, `api/`, `auth/`, `gateway/`, `gateway-v2/`, `ai/`, `skills/` — backend
- Anything outside `STUDIO/`

If the frontend depends on out-of-scope code and that dependency is the problem,
document it as a queue item. Do not refactor across the boundary.

## Non-negotiables

- No new product features. No new libraries in `src/` without a written reason.
- No deletion without evidence: grep for imports, dynamic imports, string
  references, route conventions. Uncertain files go to the queue as
  `needs-confirmation`, not to the recycle bin.
- No behavior change unless the current behavior is broken. UX stays as-is.
- Never re-baseline a ratchet to turn a red gate green.

## Human verification

The gate proves the code compiles, does not regress lint, and adds no cycles.
It proves **nothing** about runtime behavior — there is no test suite and no
automated smoke test, by decision.

So after every accepted item, the human runs the app: open a chat, run a local
tool, confirm the card renders and results return. Merge follows that, not the gate.

The human merges. The agents never merge.
