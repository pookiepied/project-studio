# Studio Rehabilitation Map

This document is the working map for making Studio easier to understand,
maintain, and safely refactor. It is intentionally conservative: first map the
system, then remove proven dead code, then split monoliths, then rename or move
files once ownership is clear.

Last evidence pass: 2026-07-13.
Baseline checkpoint: `d44311e chore: checkpoint studio worktree`.

## Goals

- Make the project human-readable for contributors.
- Remove unused, stale, duplicate, and misleading code only after evidence.
- Split monolithic files by responsibility, not by arbitrary line count alone.
- Keep changes scoped and checkpointed so each phase can be reviewed.
- Avoid batch rename or move scripts for structural changes.
- Fix bugs and optimize after the structure is clear enough to reason about.

## Current Shape

Studio is a React, Vite, TypeScript, and Tauri application with supporting
runtime code.

Top-level areas:

| Area | Current role | Treatment |
| --- | --- | --- |
| `src/` | Frontend application source | Primary rehabilitation target |
| `src-tauri/` | Tauri shell, Rust commands, desktop bridge | Audit as platform layer |
| `daemon/` | Local backend service for model/provider behavior | Audit after frontend map |
| `library/` | MCP servers and skills bundled with Studio | Treat as bundled capability library |
| `vendor/` | Bundled third-party/runtime binaries and trees | Do not mix into app cleanup queue |
| `scripts/` | Build, release, vendor, and installer utilities | Audit separately |
| `public/` | Static assets | Asset inventory pass |
| `web/` | Web entry/build variant | Keep separate from desktop app shell |
| `gate/` | Quality gate data | Preserve unless replacing gate process |
| `dist/` | Build output | Ignore for architecture work |

Current file counts after the first dead-code proof pass:

- `src`: 490 files
- `library`: 192 files
- `src-tauri`: 85 files
- `daemon`: 16 files
- `scripts`: 6 files
- `web`: 4 files
- `gate`: 2 files
- `vendor`: 4919 files

`vendor/` is large by design and should be classified as bundled runtime
material, not ordinary source debt.

## Existing Architecture Signal

The strongest existing architecture rule is in `eslint.config.js`:

```text
features -> runtime/ui -> core/lib -> types
```

Meaning:

- `app/` composes the application shell, routes, providers, and global UI.
- `features/` owns product features and may depend on lower layers.
- `runtime/` owns local runtime integration, transport, tool execution, and
  runtime-facing UI.
- `ui/` owns generic presentation and primitives.
- `core/` and `lib/` own shared infrastructure and utilities.
- `types/` owns shared type surfaces.

The rule is useful, but the names `core`, `lib`, and `runtime` are still
conceptual. They should not be renamed until their contents are classified more
precisely.

## `src/` Inventory

Current `src/` top-level areas:

| Area | Files | Notes |
| --- | ---: | --- |
| `features/` | 274 | Dominant app code; already feature-oriented |
| `core/` | 71 | Shared infrastructure, but broad naming |
| `app/` | 45 | App composition, routes, shell, globals |
| `ui/` | 28 | Brand, feedback, icons, primitives |
| `runtime/` | 27 | Runtime transport/execution/server integration |
| `lib/` | 24 | Mixed utilities and hooks |
| `design/` | 7 | Tokens, CSS systems, motion/font constants |
| `types/` | 6 | Shared types, some overlap with feature types |
| `cliBridges/` | 5 | Claude CLI bridge |
| root files | 3 | `main.tsx`, `index.css`, `vite-env.d.ts` |

Largest feature clusters:

| Feature | Files | Lines |
| --- | ---: | ---: |
| `chat` | 94 | 13811 |
| `manage` | 14 | 13253 |
| `workspace` | 23 | 5078 |
| `models` | 24 | 3242 |
| `voice` | 16 | 2931 |
| `settings` | 15 | 2089 |
| `extensions` | 16 | 1785 |
| `markdown` | 14 | 1752 |

Largest `core` clusters:

| Subsystem | Files | Lines |
| --- | ---: | ---: |
| `storage` | 10 | 1803 |
| `errors` | 5 | 1435 |
| `permissions` | 9 | 1203 |
| `platform` | 11 | 1155 |
| `network` | 5 | 906 |

Largest `runtime` clusters:

| Subsystem | Files | Lines |
| --- | ---: | ---: |
| `ui` | 6 | 763 |
| `execution` | 7 | 664 |
| `transport` | 3 | 555 |
| `servers` | 5 | 545 |

## Monolith Candidates

Line count is only a signal. Each file still needs a responsibility review
before splitting.

| File | Lines | Initial read |
| --- | ---: | --- |
| `src/features/manage/modelRegistry/curatedRegistrySnapshot.ts` | 11519 | Generated or snapshot-like data; classify before editing |
| `src/features/workspace/pages/WorkspacePage.tsx` | 951 | Page likely mixes workflow state, UI sections, and creation forms |
| `src/features/chat/context/ChatProvider.tsx` | 918 | Provider likely owns too many chat concerns |
| `src/features/chat/components/ChatFloatingDock.tsx` | 893 | Complex composite UI; split by panels/rows/actions |
| `src/features/chat/pages/ChatPage.tsx` | 835 | Page composition is heavy |
| `src/features/voice/hooks/useAudioRecorder.ts` | 668 | Hook likely mixes device, recording, state, and error handling |
| `src/core/errors/comprehensiveDiagnostics.ts` | 616 | Diagnostic collectors may be separable |
| `src/features/workspace/rightWorkspace/RightWorkspacePanel.tsx` | 582 | Workspace panel composition candidate |
| `src/features/activity/pages/ActivityPage.tsx` | 574 | Page-level decomposition candidate |
| `src/features/chat/context/useStreamHandlers.ts` | 536 | Streaming protocol/event logic candidate |

## Dead-Code Signals

`npx knip --reporter compact` currently reports:

- 0 unused files after the first proof pass
- 26 unused exports
- 45 unused exported types
- 0 duplicate exports after the duplicate-export proof pass

Unused files removed in the first proof pass:

- `src/features/chat/components/ProjectContextPicker.tsx`
- `src/features/workspace/rightWorkspace/WorkspaceHomePanel.tsx`
- `src/features/workspace/rightWorkspace/WorkspacePlaceholderPanel.tsx`
- `src/lib/hooks/useFetchState.ts`

Removal evidence:

1. `knip` reported each file as unused.
2. Name and path searches found no live imports, route references, or public
   barrel exports.
3. Remaining references were stale prompts, lint baseline entries, this map, or
   comments.
4. TypeScript verification passed after removal.

Duplicate exports removed in the duplicate-export proof pass:

- `src/core/config/tauriConfig.ts`: removed unused default export; kept
  canonical named `TAURI_CONFIG`.
- `src/design/fonts.ts`: removed unused `*_STACK` aliases; kept canonical
  `FONT_SANS` and `FONT_MONO`.

## Dependency Cycle Signal

`npx madge --circular --extensions ts,tsx src` reports one circular dependency:

```text
features/workspace/browser/BrowserPanel.tsx
features/workspace/browser/NativeBrowserHost.tsx
```

This should be an early cleanup task because cycles make later moves and splits
harder to trust.

## Naming Concerns

Names to review after classification:

- `core`: broad infrastructure bucket; subfolders are clearer than the parent.
- `lib`: mixed utilities; decide whether each item is shared utility, feature
  logic, runtime support, or design support.
- `runtime`: overlaps mentally with Tauri, daemon, MCP servers, and local
  execution. It may need a clearer name or stronger internal README.
- `library`: exists both at Studio root and conceptually inside source
  discussions. Root `library/` currently means bundled MCP servers and skills.
- `manage` vs `models`: both touch model/provider concepts and need boundary
  clarification.
- `workspace`, `rightWorkspace`, and `workspace/browser`: clarify whether these
  are product feature surfaces, layout regions, or tool integrations.

Rename only after imports and ownership are understood. Prefer small manual
renames with one commit per coherent concept.

## Target Organization Rules

Use these rules before moving files:

1. Feature-specific UI, hooks, services, context, and types live under
   `src/features/<feature>/`.
2. Shared visual components with no product logic live under `src/ui/`.
3. Design tokens, typography, motion, and CSS systems live under `src/design/`.
4. Runtime transport, tool execution, local server manifests, and runtime
   permission UI live under `src/runtime/` until a clearer name is chosen.
5. Cross-cutting infrastructure lives under `src/core/`, but each subfolder
   should have a domain-specific name.
6. Small generic helpers live under `src/lib/`; anything with product behavior
   should move toward a feature or core subsystem.
7. Shared type barrels should not duplicate feature-local types. Prefer
   feature-local `types.ts` unless multiple layers need the type.
8. Generated or snapshot data should be marked clearly and excluded from
   monolith cleanup unless the generation process is changing.
9. Root `library/`, `daemon/`, and `src-tauri/` are adjacent systems. Do not
   fold them into `src/`.
10. Avoid new cross-feature deep imports. Use feature public surfaces when they
    exist, and create them deliberately when they do not.

## Phase Plan

### Phase 0: Baseline and map

Status: in progress.

Completed:

- Created checkpoint commit `d44311e`.
- Confirmed clean worktree after checkpoint.
- Confirmed `npm run typecheck` passes.
- Confirmed `npm run ratchet:lint` passes.
- Confirmed `npm run ratchet:cycles` passes against the current baseline.
- Captured initial file counts, large files, dead-code signals, and cycle signal.

Next:

- Keep this document updated as the map becomes more exact.

### Phase 1: Dead-code proof pass

Status: in progress.

Completed:

- Removed the 4 unused files reported by `knip`.
- Removed the 4 duplicate export pairs reported by `knip`.
- Removed `FONT_DISPLAY` after the duplicate-export cleanup revealed it had no
  live consumers.
- Removed 8 unused animation exports from `src/design/motion.ts`; kept the
  live shared `chevronRotateTransition`.
- Removed or privatized unused exports from small `src/lib` helpers while
  preserving their live public functions.
- Removed or privatized unused app-level convenience exports while preserving
  the live app shell and settings surfaces.
- Removed or privatized unused CLI bridge exports while preserving the live
  Claude bridge surface.
- Removed or privatized unused core config/project helper exports while
  preserving the live model-tier and project-registry surfaces.
- Removed or privatized unused core logging/error-reporting exports while
  preserving the live logger and stored-error surfaces.
- Removed or privatized unused core network, platform, and storage convenience
  exports while preserving live diagnostics, overlay, shortcut, and settings
  surfaces.
- Removed unused permission grant and barrel exports while preserving the live
  permission engine, runtime scoping, and Settings permissions surface.
- Removed unused notification barrel exports while preserving the live
  notification store, service, and agent-result adapter.
- Removed unused local MCP registry wrapper exports while preserving and
  reformatting the live startup registry sync path.
- Privatized the activity health-card status indicator while preserving the
  live `HealthCard` component surface.
- Removed the unused artifact example markdown export while preserving the live
  artifact example data used by the artifact lab.
- Removed or privatized unused chat attachment helper exports while preserving
  live validation, document indexing, uploads, and cache restoration.
- Removed the unused high-level image vision service and trimmed the image
  attachment barrel to the live compression/base64 utility surface.
- Removed unused chat composer style constants while preserving the shared
  composer controls still used across chat, voice, and model selection.
- Trimmed the chat context barrel to the live `ChatProvider` and `useChat`
  surface, and removed stale chat-local tool classification constants now owned
  by the runtime UI classifier.
- Privatized chat conversation helpers that were only used inside their owning
  files: Claude tool-name mapping, Claude native ID prefixing, and conversation
  owner resolution.
- Removed unused legacy chat history helpers for raw conversation
  import/export and last-response regeneration; the live regenerate flow is
  handled by conversation actions and the send pipeline.
- Trimmed unused extensions component exports and removed stale decorative
  separator comments from the extension icon helpers while preserving the live
  Extensions page surface.
- Trimmed unused Manage component barrel exports and privatized the model
  registry currency helper that is only used by its formatter module.
- Removed the unused markdown video processing placeholder while preserving the
  live video player used by markdown code blocks.
- Removed separator-art and unnecessary Unicode punctuation from the platform
  overlay and global-shortcut services as the first comment-artifact cleanup
  pass.
- Updated stale live comments that referenced deleted code.
- Updated `gate/lint-baseline.json` with the project ratchet command after the
  deleted files made old baseline entries stale.
- Verified no unused files remain in the `knip` report.
- Verified `npm run typecheck`.

Remaining scope:

- Continue with unused exports.
- Review unused exports in small groups by subsystem.

Rules:

- Do not delete from `vendor/`, generated snapshots, or package lock files.
- Do not delete exported APIs that are intended for external/plugin use without
  checking their boundary.
- Verify with `npm run typecheck` after each deletion group.

### Phase 2: Cycle removal

Scope:

- Break the `BrowserPanel.tsx` and `NativeBrowserHost.tsx` cycle.

Likely approach:

- Extract shared browser host types, constants, or callbacks into a third module
  inside `src/features/workspace/browser/`.
- Keep UI ownership obvious.
- Verify with `npm run ratchet:cycles`.

### Phase 3: Feature boundary map

Scope:

- `chat`
- `workspace`
- `manage`
- `models`

Deliverable:

- A short README or section per major feature that states what the feature owns,
  what it imports from shared layers, and what should not live there.

### Phase 4: Monolith splits

Start with files that are large and actively edited, not generated data.

Recommended order:

1. `src/features/workspace/pages/WorkspacePage.tsx`
2. `src/features/workspace/rightWorkspace/RightWorkspacePanel.tsx`
3. `src/features/chat/pages/ChatPage.tsx`
4. `src/features/chat/context/ChatProvider.tsx`
5. `src/features/chat/components/ChatFloatingDock.tsx`
6. `src/features/voice/hooks/useAudioRecorder.ts`

Split rule:

- Extract named responsibilities into nearby folders first.
- Keep imports local and readable.
- Avoid moving across major layers during the first split.
- Typecheck after each split.

### Phase 5: Naming and folder moves

Only begin after phases 1-4 clarify ownership.

Candidate decisions:

- Whether `core` should remain as the infrastructure layer or be renamed.
- Whether `lib` should be reduced to pure utilities.
- Whether `runtime` needs a clearer name or an internal README.
- Whether `manage` and `models` should be more explicitly separated.

### Phase 6: Bug fixing and optimization

Begin after the code is easier to navigate.

Targets:

- Bugs found during mapping.
- Performance issues in chat/workspace/model registry paths.
- Build, startup, and runtime stability.

## Verification Commands

Use these as phase gates:

```powershell
npm run typecheck
npm run ratchet:lint
npm run ratchet:cycles
npm run deadcode
```

For structural changes, prefer:

1. Make a small manual change.
2. Run the narrowest relevant check.
3. Run `typecheck`.
4. Commit the checkpoint if the change is coherent.

## Open Questions

- Is `curatedRegistrySnapshot.ts` generated? If yes, where is the generator or
  source of truth?
- Should `daemon/` eventually be treated as part of Studio's runtime layer, or
  as an independent local service?
- Is root `library/` purely bundled MCP/skills content, or will it also contain
  user-installable marketplace assets?
- Should `web/` remain a separate entry variant, or is it a distribution target
  for the same app shell?
