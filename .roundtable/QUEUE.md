# Queue

One item = one scoped change = one agent run. Statuses: `todo` · `in-progress` ·
`needs-confirmation` · `blocked` · `done`.

Items are ordered: architectural damage first, cosmetic backlog after. Each item
names its files, its definition of done, and what would make it fail. An item that
cannot state how it fails is not ready to dispatch.

**Gate as of 2026-07-10:** typecheck clean · build passes · lint **256** · cycles **1**.
All 256 lint errors are raw buttons (RT-007). Layering violations: **zero**.
knip: 336 unused exports (from 399), zero unused files.

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

### RT-005 — Break the surviving intra-feature cycle · `done` (9137d06)

```
features/chat/services/daemonService.ts > features/models/services/localUsageService.ts
```

**Closed by deletion, not restructuring.** The cycle existed for one reason: `daemonStream`
called `reportLocalUsage` on its last line. `daemonStream` had no callers. It was a cycle held
open entirely by dead code, and no amount of dependency-inversion cleverness was the right fix.

It stayed hidden because `aiService`'s `export * from "./daemonService"` re-exported it into
nothing, so the detector counted it as used — the same barrel pollution as fasterWhisper.
Trimming that barrel (RT-027) made it visible; deleting it dissolved the cycle for free.

**Third time this pattern has held.** The reorg dissolved 7 of 9 cycles without targeting one.
This closed the 8th by deleting dead code. *Cycles are a symptom. Look for the disease.*

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

### RT-021 — Dead exports in `core/platform` + `core/storage` · `done` (2c67ba2)

`studioPaths.ts` defined a 14-branch path hierarchy of which one branch was ever used.
`getStudioSkillsHome()` was worse than unused: it resolved to `%APPDATA%/Studio/skills`, while
bundled skills are written to and read from `$HOME/.studio/skills`
([skillDeployer.ts:140](../STUDIO/src/core/skills/skillDeployer.ts:140), and `mcp-servers/computer-use`
reads `os.homedir()/.studio/skills`). **It pointed at a directory nothing reads.**

`configService.ts`'s real public surface is the `configService` object literal, not its named
function exports. Five object members had no callers.

---

### RT-020 — Triage 340 unused exports / 130 unused types · `in-progress`

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

Method: for each candidate, remove the `export` keyword rather than the symbol.
`tsc --noUnusedLocals` then either passes (the symbol was used locally; keep it private) or
fails with `TS6133` (the symbol is genuinely dead; delete it). The typechecker adjudicates, not
the detector.

**The un-export step is not optional, and RT-024 proved why.** `noUnusedLocals` never flags an
*exported* symbol — it cannot, since an export is by definition reachable from outside the file.
My RT-024 spec told the implementer to delete `getModelsByType`'s callers and let `TS6133`
adjudicate what remained. tsc came back clean and said nothing, because `getModelsByType` was
still exported. The implementer noticed, fell back to grep, got the right answer, and reported
that my instruction was unsound. **Drop the `export` first, then run tsc. Otherwise the
typechecker is silent exactly where you are relying on it to speak.**

**Two fixed points, not one.** Established across batches 1–2:
- *Within a file*, deleting a function can orphan its callees. Iterate `tsc` until it converges.
- *Across files*, deleting a consumer can orphan an exporter. **`tsc` cannot see this** —
  `noUnusedLocals` reasons only within a file. Re-run `knip` after each batch. Batch 2 deleted
  `configService.updateSetting`, which silently orphaned `fileConfigService.updateSetting`.
- `noUnusedLocals` never flags unused `interface`/`type`. Check those by hand.

**Batch log:**

| Batch | Files | Result |
|---|---|---|
| 1 | `fasterWhisper/` (7 files + barrel) | 21 deleted, 4 privatized — `52a14d7`, `bafb003` |
| 2 | `core/platform/studioPaths.ts`, `core/storage/configService.ts` | 21 deleted, 7 privatized — `2c67ba2` |
| 3 | cascade: `core/storage/fileConfigService.ts` | `updateSetting` deleted; `importSettings` → RT-022 |
| 4 | `features/models/services/modelService.ts` (+1 import line in `modelFilter.ts`) | 12 deleted, 2 re-exports dropped — `01a5212` |
| 5 | `features/chat/attachments/fileAttachmentService.ts`, `lib/modelUtils.ts` | 14 deleted, 1 privatized — `05ee015` |
| 6 | `features/chat/services/aiService.ts` facade (+`useLiveSession.ts` import) | 9 re-exports dropped — `214647e` |
| 7 | cascade: `daemonService.ts`, `services/types.ts` | `daemonStream` + 2 dead types; **RT-005 cycle dissolved** — `9137d06` |
| 8 | `core/models/` barrel, then `modelCapabilityService.ts` + `claudeBridgeService.ts` | 6 deleted, 4 privatized; 302→119 lines — `86fb9fb`, `1f818a7` |
| 9 | `types/artifacts.ts`, `ui/icons/index.tsx` | 2 deleted, 8 privatized, 1 dead re-export dropped — `c7371f0` |
| 10 | `lib/harnessEventUtils.ts`, `lib/textMerger.ts`, `chat/context/messageBuilder.ts` | 1 deleted, 14 privatized — `91338b2` |

knip: 399 unused symbols at the start of RT-020, **291** now. Zero unused files. Cycles 2 → 1.

**Most flagged exports are private helpers, not corpses.** Batch 10 is the clean statement of
this: in all three files knip flagged *N−1 of N* exports, and the one it left alone was the
module's entry point — `buildHarnessEvent`, `processTranscriptionChunks`,
`applyAllSystemMessages`. Each entry point calls the helpers below it. Nothing was dead; the
`export` keyword was just scattered across a file's whole call graph rather than its surface.
When knip flags nearly everything in a file, **look for the survivor and read what it calls**
before reaching for a delete. 14 of the 15 were privatized; only `mergeTranscriptionChunks`
(which nothing called, not even its own module) was actually removed.

**Trim the barrel first — every single time.** Batches 1, 6 and 7 all found the same thing: a
dead re-export makes a sibling-only symbol look alive to the detector. `daemonStream` had been
invisible for the whole of RT-020 because `aiService` re-exported it into nothing. The per-file
view is only truthful once the barrel is honest.

**The non-barrel list is now exhausted.** What remains — ~180 symbols across ~20 barrels — must
be taken one folder at a time, trimming the barrel before trusting the per-file view.

**Name collisions are THE recurring hazard — eight so far.**
- `supportsTranslation` — a function *and* a boolean property on 14 models.
- `updateSetting` — three declarations, one live.
- `getModelById` — three declarations, two live; one reached via a namespace import.
- `formatFileSize` / `formatTokenCount` / `MAX_ATTACHMENTS` — declared in two to three places
  each, none of them the one being deleted.
- `ArtifactTable` — an interface in `types/artifacts.ts` *and* a local component at
  `ArtifactRenderer.tsx:138`. The renderer never imports the interface.
- `iconSize` — a const in the icon barrel, a prop in `SearchInput.tsx`, a parameter in
  `toolCardUtils.tsx`. Only the const was dead. Note the exported *type* `IconSize`, one
  character apart, has two real consumers and had to stay.
- `IconProps` — the icon barrel's, and a separate already-private one in `WorkspaceIcons.tsx`.

**Disambiguate by import source, never by bare name.** The last of these was *the lead's* error:
I counted bare-name greps, marked three dead exports as "externally consumed", and wrote that
into the spec. The implementer checked, found no importer, and reported the contradiction rather
than quietly following the instruction. Both halves of that are the protocol working.

**Watch for duplicated implementations.** The dead copy is often the *second* one:
`calculateMaxAttachmentTokens`/`getModelContextWindow` duplicated `attachmentLimits.ts`;
`formatFileSize` existed three times; `MAX_ATTACHMENTS: 10` still sits in `constants/ui.ts`;
`detectToolSupport` duplicated the inline check at `features/models/helpers.ts:39`.

**Dead *data* is invisible to every tool we have.** `CAPABILITY_PATTERNS.tools` and
`.longContext` — two arrays of regexes — survived only because a deleted function read them.
Neither tsc nor knip flags an unread object property. After deleting a function, read what its
module-level constants were for.

**Never script these edits — the rule covers deletions, not just rewrites.** Two failures, both
the lead's, both in RT-029:
1. A regex-based un-export script printed `MISS` for all six targets, changed one unintended
   line, and reported success. Caught by reading its output.
2. Two `node -e` line-slice truncations *worked* — and left a double blank line that tsc,
   eslint and the gate all passed over in silence (fixed in `3495243`).

The first failure is loud. **The second is the dangerous one:** a script can leave a
correct-compiling file with a fingerprint no tool will ever report. Hand-edit with Edit, and
read the resulting file end to end. "It typechecks" is not "it is right."

---

### RT-030 — Three consumers bypass the icon barrel · `todo` · organize-phase

`ui/icons/index.tsx` opens by declaring itself "the SINGLE import surface for UI glyphs."
It is not. `RightWorkspaceControls.tsx`, `TitleBar.tsx` and `ChatHeader.tsx` all import
`NavToggleIcon` / `OverviewIcon` straight from `@/ui/icons/WorkspaceIcons`, and the barrel's
re-export of those two had **zero** importers — which is why batch 9 removed it as dead.

Removing the dead line was correct (no importer, no evidence of use) but it does leave the
header comment overstating the barrel's reach. Two further inaccuracies in that header, both
pre-existing: it claims Phosphor is "imported ONLY here", while `WorkspacePage.tsx` and
`ArtifactRenderer.tsx` import glyphs directly.

Fix in the organize phase, not here: point the three consumers at `@/ui/icons`, restore the
`WorkspaceIcons` re-export as *live* surface, and either enforce the Phosphor rule with a lint
restriction or soften the comment to match reality. **Do not do this as part of a removal
commit** — it deletes nothing and changes import graph shape.

---

### RT-026 — `lib/modelUtils.ts` is now a one-line delegate · `todo` · small

After RT-025 the file is 14 lines: `isVisionModel(model)` returning `detectVisionSupport(model)`.
Its two consumers (`ModelPicker.tsx:22`, `features/models/helpers.ts:3`) could import
`detectVisionSupport` from `@/core/models` directly and the file would disappear.

Not done in RT-025 to keep that item's scope honest. Belongs to the rename/organize phase.

---

### RT-022 — `importSettings` is the unwired half of a round-trip · `needs-confirmation`

[fileConfigService.ts:359](../STUDIO/src/core/storage/fileConfigService.ts:359) exports
`importSettings`, which parses a `.conf` blob back into `AppSettings` and saves it. **It has zero
callers.** `SettingsDebugPanel` can *export* settings and reveal the config file location, but
nothing anywhere imports them back.

This is the same shape as RT-019 (`@chat`): a working backend behind a UI that was never built.
It is dead by every static measure, so a mechanical sweep would delete it — but deleting it
removes a capability, not cruft. **That is a product decision, not a cleanup.**

Options: (a) delete it and accept export-only, (b) wire an "Import settings" control into
`SettingsDebugPanel` next to the existing export. A comment at the declaration marks it as a
deliberate hold so a later sweep does not quietly take it.

Its two helpers (`confToSettings`, `settingsToConf`) are used by the live load/save paths and
survive either way.

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
