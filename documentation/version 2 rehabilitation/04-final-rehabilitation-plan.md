# Studio Version 2: Final Rehabilitation Plan

Evidence pass: 2026-07-18
Status: planning source of truth; implementation proceeds only through named,
verified slices.

## Source Of Truth

The Version 2 documentation has four non-duplicating responsibilities:

1. `01-removal-audit.md` explains why an old owner must leave Studio and the
   dependency order for doing so.
2. `02-target-structure-audit.md` defines the product boundaries and proposed
   destination structure.
3. `03-file-ownership-ledger.csv` is the executable audit index. It contains one
   row for every tracked file under `STUDIO/`.
4. This document combines the removal audit, target structure, and unfinished
   Version 1 rehabilitation work into the ordered program of work.

When these documents disagree, the precedence is:

1. The live code and build/package configuration.
2. A file-specific row in the ledger backed by direct evidence.
3. This final plan.
4. The removal and target-structure audits.
5. `STUDIO/docs/studio-rehabilitation-map.md`, which is historical Version 1
   evidence unless this plan explicitly carries an item forward.

## Verified Inventory

- Tracked files under `STUDIO/`: 844.
- Ledger rows: 844, plus one CSV header.
- Textual tracked files read by the audit: 785.
- Binary assets classified by path, package role, and reference requirements: 58.
- Gitlinks: 1 (`STUDIO/src-tauri/yt-transcript-mcp`).
- Version 2 planning files: 4, including this document.

The ledger currently assigns these atomic dispositions:

| Disposition | Files | Meaning |
| --- | ---: | --- |
| `KEEP_REWORK_IN_STUDIO` | 550 | Retain behavior, then judge structure under the rework policy. |
| `MIGRATE_TO_CLI_PRESERVE_SOURCE` | 67 | Move the first-party computer-use package/skill to Studio CLI without losing source. |
| `DELETE_AFTER_CLI_REPLACEMENT` | 63 | Legacy Studio Harness files removed after Studio CLI covers required behavior. |
| `DECISION_REQUIRED` | 43 | No deletion or move until the product owner and replacement are chosen. |
| `EXTRACT_TO_OWNER_THEN_DELETE` | 30 | Move useful capability to Studio CLI or Cloud, then delete the old source. |
| `MOVE_TO_CLI_OR_DELETE` | 29 | CLI ownership must be proved; otherwise delete after callers disappear. |
| `EXTRACT_THEN_DELETE` | 20 | Extract cloud/client behavior, redirect callers, then delete the legacy file. |
| `DELETE_CONFIRMED` | 8 | Static reachability and direct content checks support a focused deletion slice. |
| `DELETE_AFTER_REPLACEMENT` | 9 | Replace the caller-facing behavior first, then delete. |
| `REPLACE_THEN_DELETE` | 7 | Replace a legacy UI/service path with Studio CLI behavior, then delete it. |
| `MOVE_WITHIN_REPOSITORY` | 7 | Retained behavior moves to its correct Studio/Cloud owner. |
| `IMPORT_THEN_DELETE` | 4 | User data needs an import/migration path before source deletion. |
| `DELETE_AFTER_CALLERS` | 3 | Remove frontend/native callers and registration first. |
| `ARCHIVE_IMPORTER_OR_DELETE` | 3 | Keep only as a bounded migration importer if legacy user data requires it. |
| `DELETE_OR_MOVE_TO_DEV_ARCHIVE` | 1 | Remove from product source; retain only as explicitly owned developer config. |

These counts describe ownership work, not an instruction to bulk-delete files.

## Current Verification Baseline

Checks run against the live checkpoint on 2026-07-18:

- `npm run typecheck`: passes.
- `npm run ratchet:cycles`: passes with zero circular imports.
- `npm run deadcode`: intentionally fails the cleanup baseline with six unused
  source files, three unused dependencies, 29 unused exports, and 28 unused
  exported types. The six unused files and three dependencies are included in
  R0; unused exports/types require caller-level review rather than blind removal.
- `npm run gate`: stops at the lint ratchet with 38 errors in eight files:
  `ChatFloatingDockRows.tsx`, `LeftWorkspaceSidebar.tsx`,
  `ArtifactMotion.tsx`, `CalendarArtifact.tsx`,
  `ImageGenerationArtifact.tsx`, `workspaceService.ts`,
  `ProjectShaderCover.tsx`, and `WorkspacePage.tsx`.

The lint regression is an existing source baseline to resolve in a dedicated
slice. It does not invalidate this documentation-only checkpoint, but no later
implementation slice may report the full gate as passing until it is fixed or
explicitly re-baselined with justification.

## Confirmed Cleanup Set

The first removal slice may contain only these eight files:

- `STUDIO/twtest_input.css`
- `STUDIO/twtest_out.css`
- `STUDIO/src/features/artifacts/examples.ts`
- `STUDIO/src/features/chat/attachments/kbService.ts`
- `STUDIO/src/features/workspace/pages/WorkspaceAutomation.tsx`
- `STUDIO/src/features/workspace/pages/WorkspaceContextLists.tsx`
- `STUDIO/src/features/workspace/pages/workspaceFormat.ts`
- `STUDIO/src/features/workspace/services/agentWorkflowService.ts`

Knip reports the six TypeScript/TSX files as unreachable from an entry point.
Direct inspection confirms that the five workspace/chat files form an orphaned
cluster whose imports point only within that unreachable cluster. The two CSS
files are unreferenced Tailwind experiment/output artifacts.

The same slice may remove these unused dependency declarations only after a
fresh reference search and lockfile update:

- `@react-three/fiber`
- `camera-controls`
- `three-stdlib`

## Atomic File Decisions

Every ledger row must answer these independently. A compound answer such as
"migrate or remove" is a blocked decision, not permission to act.

1. Final disposition: keep, delete, move inside the repository, migrate to
   Studio CLI, migrate to Cloud, preserve as reference, or generated output.
2. Exact destination: product owner and target path, not only a folder family.
3. Current callers: imports, dynamic imports, IPC invokes, native events,
   package scripts, Tauri resources, manifests, public assets, and tests.
4. Replacement prerequisite: the API, protocol, package, importer, or UI that
   must exist first.
5. Data obligation: persisted user data, settings, transcript formats, cache,
   secure storage, and migration/recovery behavior.
6. Structural judgment: keep cohesive, split by responsibility, merge genuine
   duplicates, or remove dead branches.
7. Naming judgment: whether the current name describes responsibility and
   authority; record a candidate name before a move.
8. Import judgment: owner-local import, stable public feature surface, shared
   contract, or forbidden cross-feature/deep import.
9. Provenance: first-party, third-party, generated, vendored, gitlink, or
   unknown. Unknown provenance blocks movement into `third-party/`.
10. Verification: exact static checks, tests, package builds, native checks,
    packaged-app checks, and user-visible smoke tests.

The ledger columns encode these answers through `final_disposition`,
`target_path_or_owner`, `removal_or_move_method`, `prerequisites`,
`rework_flags`, `verification`, and `audit_status`.

`initial_action` is retained only to show how the first folder-level audit
classified the path. It is historical and non-authoritative. It never grants
permission to edit or delete a file; the atomic fields above and live code
evidence override it.

`evidence_scope` states whether evidence was collected from the file itself, a
static reachability check, a package/subsystem contract, native packaging, an
asset reference scan, or inherited directory context. `DIRECTORY_INHERITED`
and `AREA_LEVEL` evidence may defer a retained file to rework, but can never by
themselves authorize deletion or migration.

## Rework Judgment Policy

After the removal program reduces the tree, every retained file is judged on
all of the following axes. Line count is a signal, never the sole reason for a
split.

| Axis | Questions | Typical outcome |
| --- | --- | --- |
| Necessity | Is it entry-reachable, dynamically registered, packaged, or intentionally reference-only? Does another file duplicate it? | Keep, delete, merge, or mark generated/reference. |
| Product ownership | Is behavior owned by Desktop, Web/Cloud, Studio CLI, or an external package? | Keep in Studio, move to `cloud`, move to the CLI product, or remove. |
| Responsibility | Does the file have one reason to change? Does UI also own transport, persistence, or execution? | Keep cohesive or extract named responsibilities. |
| Physical location | Does the path match the feature/subsystem that owns the behavior? | Move to an owner folder after caller and cycle analysis. |
| Naming | Does the name identify purpose, authority, and surface? Is it generic, positional, or colliding? | Rename with a file-by-file import update. |
| Imports/public API | Are there deep cross-feature imports, broad barrels, cycles, or inline implementations that should be owner-local modules? | Add a small public surface, remove unused exports, or invert the dependency. |
| Monolith structure | Are independent state machines, services, fixtures, or view sections coupled in one file? | Extract a controller/service/hook/component, then import it into the owner root. |
| State/persistence | Who creates, restores, mutates, and clears the state, and for how long does it live? | Move to the correct provider/store/client and define migration order. |
| Native/package boundary | Does React directly own shell, file, process, MCP, browser, Git, or daemon authority? | Keep a typed platform/CLI client or remove the duplicated executor. |
| Text/comments | Is wording stale? Are comments decorative narration, ASCII art, box drawing, mojibake, or unnecessary Unicode? | Delete or rewrite in plain ASCII without behavior changes. |
| Verification | What proves imports, behavior, persistence, packaging, and visuals still work? | Define checks before editing, then record results. |

### Subsystem Shape

A folder is justified when several files share one owner and a stable internal
relationship. A preferred feature/subsystem shape is:

```text
subsystem/
  components/        user-interface leaves owned by the subsystem
  hooks/             React orchestration and state adapters
  services/          side effects and owner-specific clients
  state/             stores, reducers, persistence adapters
  types.ts           owner-local contracts
  index.ts           small public surface only when another owner needs it
```

Do not create all of these folders mechanically. Create only the branches a
real subsystem needs. The root file composes imported branches; it should not
reimplement their internal logic inline.

### Split Conditions

Split a file when at least one of these is true and the extraction has a stable
name and boundary:

- It contains two or more independent state/persistence lifecycles.
- It mixes UI composition with transport, filesystem, process, or tool execution.
- A large fixture/catalog/generated dataset hides the operational component.
- Independent sections can be tested or reused through a small contract.
- Changing one responsibility repeatedly risks unrelated behavior.

Do not split merely to reach a target line count, create one-function files, or
introduce an `index.ts` that re-exports an entire internal tree.

## Product Ownership

- Studio Desktop/Web keeps the shell, account/auth, settings, cloud-client UI,
  Studio CLI orchestration, run visibility, approvals, review presentation,
  artifacts, voice/product navigation, and platform adapters.
- Studio CLI owns local repository/files/terminal/Git/session/tool execution,
  local providers if retained, local MCP/tool packages, and local transcripts.
- Studio Cloud owns cloud runtimes, context engine, registry, connectors,
  gateway, cloud memory, tool pool/execution, and cloud MCP/native tools.
- `third-party/` is reserved for source with verified external provenance and
  license. First-party computer-use code moves directly to Studio CLI or a
  clearly named migration-staging area; it must not be mislabeled third-party.

## Version 1 Carryover

Version 1 completed useful dead-code proofing and small monolith extractions.
Those commits remain valid checkpoints. Its structural description of
`runtime`, `library`, `daemon`, and `vendor` is superseded by Version 2.

The following Version 1 architecture tracks remain mandatory before shell,
page, workspace, startup, or CSS restructuring:

- Startup lifecycle and readiness phases.
- Window and surface taxonomy.
- Page and shell ownership.
- Layer and portal registry.
- Layout, clipping, resize, and scroll ownership.
- State ownership and persistence scopes.
- Theme and CSS authority.

Version 1 monolith, naming, cycle, dead-code, ASCII-art/Unicode, bug, and
optimization findings are inputs to the rework phase. They do not override a
Version 2 removal disposition.

## Ordered Program

### R0: Proven Dead Code

Delete only the eight confirmed files and three dependency declarations listed
above. Run reference search, typecheck, dead-code analysis, gate, build, and
focused UI smoke tests. Commit this as one reviewable checkpoint.

### R1: Preserve Computer Use

Recover provenance/license information, create the Studio CLI package owner,
copy the first-party computer-use package and skill intact, verify checksums and
package build/tests, update packaging ownership, then remove the Studio copy.

### R2: Define The Studio CLI Contract

Specify launch/version/capability detection, headless sessions, send/cancel,
stream events, tool events, approvals, files, Git/review, terminal behavior,
errors, reconnect, and migration/import APIs. No runtime deletion begins before
the replacement contracts needed by its callers exist.

### R3: Split Conversation Authority

Separate cloud conversation transport from Studio CLI local sessions. Replace
`ChatEngine`, Claude bridge state, local runtime request building, and local tool
execution with cloud and CLI clients. Preserve chat UI and run-event display.

### R4: Migrate User Data

Decide import behavior for Desktop local conversations and Claude transcripts.
Test recovery and rollback, redirect reads/writes, then remove the old stores and
live Claude adapter.

### R5: Retire Desktop Local Execution

Remove local MCP lifecycle, local registry/control server, runtime server catalog,
local tool executor, Tauri commands, build scripts, and bundled MCP resources in
caller-first order. Extract runtime UI to `run-events` and cloud WebSocket logic
to `cloud/chat`; delete the final `src/runtime` path.

### R6: Retire Or Migrate Daemon And Vendor

Decide whether Studio CLI needs the Ollama/LM Studio bridge and vendored
`rg`/Git/Bash packaging. Move only required behavior to CLI ownership; otherwise
remove callers, Tauri resources, package scripts, CSP allowances, and source.

### R7: Resolve Product Surfaces

Make explicit keep/remove/CLI-backed decisions for browser, terminal, files,
Git/review, project launcher, transcription, TTS, and the YouTube transcript
gitlink. Each decision gets its own bounded implementation slice.

### W0: Freeze The Final Tree And Rename Matrix

Re-run the ledger against the post-removal tree. Record every retained current
path, target path, exact new name, public import surface, and caller update.
Apply moves manually in small feature/subsystem slices, never through a broad
rename script.

### W1: Establish Architecture Contracts

Complete the seven Version 1 carryover tracks before moving shell, startup,
window, portal, layout, persistence, or CSS owners.

### W2: Rework By Feature Or Subsystem

For each owner, apply the full judgment policy to every retained file. Remove
newly proven dead code, create only justified subfolders, localize types and
services, and make root files compose imports instead of inline subsystems.

### W3: Split Monoliths

Work from highest responsibility risk, not only size: artifact lab/fixtures,
workspace page/controller, chat authority/provider/pipelines, native command
families, review/terminal, token management, diagnostics, and large catalogs.

### W4: Repair Imports And Public Surfaces

Remove unused exports/dependencies, eliminate forbidden deep cross-feature
imports and cycles, and add narrow feature/subsystem public surfaces only where
cross-owner consumers exist.

### W5: Rename And Move

Apply the accepted rename matrix one bounded slice at a time. Verify imports,
dynamic registrations, native commands/events, package resources, persistence,
and UI behavior after every slice.

### W6: Clean Text And Comments

Remove decorative ASCII art, box-drawing separators, mojibake, unnecessary
Unicode, stale wording, and comments that narrate obvious code. Keep only
comments that explain non-obvious contracts or constraints.

### W7: Fix Bugs And Optimize

After ownership is readable, address verified behavior defects, startup
readiness, missing native commands, performance, accessibility, and visual
consistency. Optimization must be measured and must not hide architectural work.

## Slice Contract

Every implementation slice must state:

1. Exact ledger rows in scope.
2. Current and target owner.
3. User-visible behavior that must remain or intentionally disappear.
4. Callers, package resources, native commands/events, and persisted data touched.
5. Verification commands and manual smoke tests.
6. A checkpoint commit after verification.

No bulk rename/reorganization script is permitted. A slice may update several
files when they form one dependency cluster, but it must remain reviewable and
reversible.

## Completion Criteria

The rehabilitation is complete only when:

- Every live Studio file has a final owner and justified location.
- No Desktop-local runtime, MCP execution substrate, generic chat CLI bridge,
  local transcript authority, or obsolete provider daemon remains unintentionally.
- Studio CLI and Cloud integrations use explicit typed contracts.
- Monoliths are split by responsibility and root files compose imported modules.
- Naming and import direction are consistent and contributor-readable.
- ASCII art, mojibake, unnecessary Unicode, stale comments, unused exports,
  unused dependencies, and proven dead files are removed.
- TypeScript, dead-code, lint/cycle ratchets, relevant package/native checks,
  builds, and user-visible smoke tests pass at the final checkpoint.
