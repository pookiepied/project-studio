# 05 — Migration Order

**Leaf-first.** Move the things nothing depends on first, work up toward the
composition root. Both builds stay green at **every** step (never batch multiple
boundaries into one unverified commit).

## Sequence

1. **`design/`** — `tokens.css`, `typography.css`, `fonts`. Pure CSS, zero runtime
   coupling. Warm-up slice; proves the import-rewrite + dual-build loop.
2. **`systems/`** — `errors/`, `logging/`, `notifications/`, `permissions/`. Low
   coupling, mostly leaf logic. (`domain/` is created here but filled when the
   loop lands — reorg just reserves it.)
3. **`infrastructure/`** — the big one; do it **subdir by subdir**, not all at
   once. `platform/` is already started. Order within: platform → storage →
   files → network → auth → mcp → skills → local → gateway/api clients.
   **Apply the purge list as you go** (daemon, legacy SSE, provider-selection
   guts) — don't move dead code into the new tree.
4. **`ai/`** — relocate `claude-code/` **as-is** (mechanical, no logic edits).
   Stage `studio/` as the home for the loop. **The loop refactor itself (current
   chat → portable runtime-agnostic core) is a SEPARATE workstream after the
   reorg** — this step only reserves the folder and relocates existing AI service
   files into it.
5. **`shared/`** — `components/` → `ui/` + `layout/`; then `hooks/`, `utils/`
   (JSX-free), `types/`, `constants/`. Watch multi-feature consumers (D-407).
6. **`shell/`** — window chrome. Partially exists already.
7. **`app/`** — composition root, `providers/` (global contexts), routing,
   `config/`. Last, because everything above must be in place first.

`features/` are already organized from Phase 4 — **verify boundaries**, don't
re-move them wholesale. Fix stragglers (scoped contexts, `artifacts/examples.ts`).

## Per-slice checklist

Run after **every** slice before committing:

- [ ] `tsc --noEmit` clean (the only reliable catch for relative-import breakage)
- [ ] `npm run build` (desktop, `vite.config.ts`) green
- [ ] `npm run web:build` (web, `vite.config.web.ts`) green
- [ ] no new ESLint warnings/errors (DS guardrail is ERROR — see D-604)
- [ ] barrels complete-or-deleted (no partial `index.ts`)
- [ ] `utils/` still JSX-free

## After the reorg lands

1. Delete the six `frontend-revamp/` files (decisions already salvaged into
   `04-DECISIONS-AND-CARVEOUTS.md`).
2. Run the deferred design/dead-code pass (the "later pass" — see `04` §deferred).
3. Build the `ai/studio` portable loop (resolves the runtime-agnostic design note).
