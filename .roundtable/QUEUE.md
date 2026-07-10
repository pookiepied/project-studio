# Queue

One item = one scoped change = one agent run. Statuses: `todo` · `in-progress` ·
`needs-confirmation` · `blocked` · `done`.

Items are ordered: architectural damage first, cosmetic backlog after. Each item
names its files, its definition of done, and what would make it fail. An item that
cannot state how it fails is not ready to dispatch.

**Gate as of 2026-07-10:** typecheck clean · build passes · lint **257** · cycles **2**.
All 257 lint errors are raw buttons (RT-007). Layering violations: **zero**.

---

## Open

### RT-007 — Raw `<button>` burn-down · `todo` · batched

257 violations across ~100 files: raw `<button>` and `<motion.button>`. All the same rule:
use `<Button>`/`<IconButton>` from `@/ui/primitives`. Mechanical, high-volume — and the item
most likely to silently break behavior, which is why it comes after the structural work.

Batches are **re-derived from the new layout** (the old table pointed at moved files):

| Batch | Path | violations |
|---|---|---|
| 007a | `features/workspace/pages/WorkspacePage.tsx` | 12 |
| 007b | `features/workspace/browser/BrowserPanel.tsx` | 15 |
| 007c | `features/chat/components/` | ~41 |
| 007d | `app/shell/` + `app/globals/` | ~21 |
| 007e | `features/markdown/components/` | ~10 |
| 007f | remainder, by directory | ~158 |

**Done when:** the batch's files are at 0 in `gate/lint-baseline.json`, baseline lowered in the
same commit, typecheck clean, **and the buttons still work.**

**Fails if:** a swap changes default form-submit behavior (`type="button"` lost), drops an
`onClick` or aria attribute, or alters focus/keyboard handling. Report every prop that did not
map cleanly. **Human smoke test mandatory before merge.**

---

### RT-005 — Break the surviving intra-feature cycle · `todo` · small

```
features/chat/services/daemonService.ts > features/models/services/localUsageService.ts
```

One of only two cycles left. No layering violation — a service-to-service tangle. The other
half of this item (`modelService > localModelDetection`) closed in the reorg.

**Done when:** cycle gone, baseline lowered, typecheck clean, no behavior change.

---

### RT-006 — Break `BrowserPanel` ↔ `NativeBrowserHost` · `todo`

```
features/workspace/browser/BrowserPanel.tsx > features/workspace/browser/NativeBrowserHost.tsx
```

The last remaining cycle. `BrowserPanel.tsx` is also the single worst lint offender (15 raw
buttons). Do **not** fix the buttons here — that is RT-007b. One item, one concern.

---

### RT-017 — Five barrels orphaned by the reorg · `done` (c0e556e)

`npm run deadcode` reports these as unused files, newly:

```
src/core/daemon/index.ts
src/core/skills/index.ts
src/features/chat/services/index.ts
src/features/workspace/rightWorkspace/index.ts
src/features/workspace/services/index.ts
```

**Not an automatic delete.** A barrel with no importers today may still be the intended public
surface of its directory. Per the charter: no deletion without evidence. For each, grep for
importers (static, dynamic, and string paths), then either delete with the evidence recorded or
mark it deliberate public API.

---

### RT-009 — the unused devDependency is `madge` (false positive) · `done` (c0e556e)

It is a **false positive.** `scripts/ratchet.mjs` invokes `node_modules/madge/bin/cli.js`
directly, and `knip.json` lists `scripts/**` under `ignore`, so the gate's own tool is invisible
to the gate's own detector.

**Do not remove `madge`.** Fix the detector: either drop `scripts/**` from `ignore`, or add
`madge` to `ignoreDependencies`. Prefer the former — the scripts directory is gate code and
deserves to be analyzed. Verify `npm run gate` still passes afterward.

---

### RT-019 — `@chat` mentions removed · `done` (39dd7f2)

`features/chat/services/contextRetrievalService.ts` exports four functions with **zero callers**:
`parseMentions`, `getAvailableContexts`, `retrieveContexts`, `formatContextsForLLM`. Yet
`ContextAutocomplete.tsx` — rendered by `ChatPage` — imports `ContextReference` from it.

The UI shell exists; the retrieval pipeline behind it was never connected. **This is a product
question, not a cleanup:** is `@chat` mention-based context retrieval a feature you intend to
ship, or an abandoned experiment? Delete the service and simplify the component, or wire it up.
Do not decide this mechanically.

---

### RT-020 — Triage 340 unused exports / 130 unused types · `needs-confirmation`

178 of them sit in 19 `index.ts` barrels — that is deliberate public surface, not dead code.
The remaining ~292 live in 106 non-barrel files.

**Correction (2026-07-10).** An earlier version of this item claimed namespace imports
(`import * as`) defeat knip's per-export analysis. **That was wrong, and it was tested.**
`modelService.ts` calls `fasterWhisperService.loadConfig()` and `.getModelById()` through a
namespace import; knip flagged neither, while correctly flagging `saveConfig` and
`getAllModelNames`, which nothing calls. knip resolves namespace member access.

**Still do not bulk-delete.** The real traps:
1. **knip cannot see non-import usage.** It called `madge` an unused dependency while the gate
   was running it, because `ratchet.mjs` invokes it by filesystem path. Anything reached by
   string name — Tauri commands, route conventions — is invisible the same way.
2. **Re-export chains.** Most flagged symbols in `fasterWhisper/` have exactly one reference
   outside their own file: the barrel that re-exports them into nothing. Deleting the symbol
   means deleting the barrel line too, or the build breaks.
3. **A symbol can be dead while its file is alive.** `contextRetrievalService` was 100% dead
   yet its consumer component was rendered on every chat page (see RT-019). File-level
   reasoning would have deleted a working feature.

Suggested method: for each candidate, remove the `export` keyword rather than the symbol.
`tsc --noUnusedLocals` then either passes (the symbol was used locally; keep it private) or
fails (the symbol is genuinely dead; delete it). The typechecker adjudicates, not the detector.

---

### RT-008 — superseded by RT-020 · `done`

`npm run deadcode` reports 340 unused exports and ~126 unused types. This is **not** a delete
list. Many are deliberate public barrels (`runtime/index.ts`, `cliBridges/index.ts`) and knip
cannot tell a public API from dead weight.

**This item is triage, not deletion.** Produce a categorized list: (a) genuine dead code with
evidence, (b) intentional public surface, (c) unknown. Deletion happens in follow-up items, per
category (a) only, with evidence in the ledger.

---

### RT-012 — Stale comment in `builtinTools.ts` · `done` (6efd186)

The header comment (~lines 16-18) still says the type-only import comes from
`./executeLocalTools`. It now comes from `./types`. Fold into any future item touching the file.

---

### RT-010 — Dangling doc reference in `eslint.config.js` · `done` (verified; both docs exist)

[eslint.config.js:13](../STUDIO/eslint.config.js:13) cites
`Documentation/frontend-loop-engineer-master-prompt.md § 6`. Confirm that path still resolves
after the doc purge; if not, restate the rationale inline. Do not weaken the rules.

---

### RT-018 — Consider moving `claudeBridgeService.ts` into `cliBridges/claude/` · `todo` · optional

Proposed by doc 13, verified sound by RT-016. 89 lines, imports only Tauri and `core/logging`,
so it stays a leaf either way. Cosmetic coherence, not a fix. Low priority.

---

## Closed

| Item | Outcome |
|---|---|
| RT-001 | `core/network → features` inversion — closed by the human reorg (2026-07-10) |
| RT-002 | `core/storage → features/chat` — closed; `chatHistoryService` moved into `features/chat/conversations/` |
| RT-003 | `runtime/execution` self-cycle — types hoisted to `runtime/execution/types.ts` |
| RT-004 | `chat/context ↔ runtime` barrel cycle — dissolved for free by RT-015f |
| RT-011 | `runtime/execution/types.ts → features` — superseded by RT-015f |
| RT-013 | `<motion.button>` guardrail bypass closed; baseline 229 → 257 (debt counted, not added) |
| RT-014 | Control primitives carved out of the raw-button rule; 232 → 229 |
| RT-015 | **All 22 upward imports gone.** 015f by the loop; 015a–e,g,h by the human reorg |
| RT-016 | `cliBridges/` audited: 185 lines, 5 files, zero upward imports, 19 dependents. Healthy |

---

## Standing constraints

- **Never re-baseline a ratchet to turn a red gate green.** The single admissible exception is a
  pure rename/relocation, where the ratchet's path keys cannot see a move. It must be proven with
  a basename-matched move ledger and `no existing file got worse`. **A falling total is not
  sufficient evidence on its own.**
- No deletion without evidence. Uncertain files → `needs-confirmation`, not deleted.
- The gate proves nothing about runtime behavior. The human smoke-tests. The human merges.
