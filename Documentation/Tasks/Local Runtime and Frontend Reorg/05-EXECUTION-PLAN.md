# 05 — Execution Plan (the runbook)

> **Verified build/lint commands (recorded Phase 0):**
> - Build + type-check: `npm run build` (= `tsc && vite build`)
> - Type-check only: `npx tsc --noEmit`
> - Lint: `npm run lint`
> - Web build: `npm run web:build`
> - Dev: `npm run dev` (or `npm run tauri dev`)
> - Alias `@/*` → `src/*` confirmed in `tsconfig.json`, `vite.config.ts`, `vite.config.web.ts`.

Work from this document. Do the phases **in order**. Do not skip. The app must
type-check and build at the end of **every** phase. One phase = one commit/PR.

**Global rules (apply to every phase):**
- Use `git mv` for moves (preserves history; diff reads as rename).
- After moving a file, update **all** its importers. Prefer path aliases (`@/…`).
- Never change behavior in this task — only structure. If you feel tempted to "fix"
  something, leave a `// TODO(reorg):` and move on.
- After each phase run the **Verification** block. If it fails, fix before committing.
- Check the **Done when** box before moving to the next phase.

**Verification block (referenced as "VERIFY" below):**
```
cd STUDIO
npm run build        # or: npx tsc --noEmit && npx vite build
# Optional smoke: npm run tauri dev, open a chat, run one local tool (e.g. ls),
# confirm the tool card renders and results come back.
```
Adjust script names to whatever `STUDIO/package.json` actually defines; confirm them
first.

---

## Phase 0 — Prep (no moves)

**Goal.** Make the ground ready so later phases are pure moves.

**Why first.** Establishing the alias + empty skeleton means every later `git mv`
has a valid destination and the barrel exists to import from immediately.

**Steps.**
1. Confirm `@/*` → `src/*` alias resolves in both `tsconfig.json` and
   `vite.config.ts`. If missing, add it.
2. Create empty target skeleton dirs with a placeholder `index.ts` where a barrel is
   expected: `src/runtime/{,servers,transport,invoke,execution,capabilities,ui}`,
   `src/core/`, `src/ui/`, `src/lib/`, `src/design/`, `src/app/`.
3. Read `STUDIO/package.json` scripts; record the real build/type-check commands at
   the top of this file for the executing agent.

**VERIFY.** Build still passes (nothing imported the empty dirs yet).

**Done when.** ☐ Alias confirmed. ☐ Skeleton exists. ☐ Real build command recorded.

---

## Phase 1 — Carve out the Local Runtime  ⭐ (highest value)

**Goal.** Move every file in doc 04 §A into `runtime/`, create `protocol.ts` and
`runtime/index.ts`, and repoint all importers at `@/runtime`.

**Why now.** This is the primary purpose of the task and it is self-contained: the
runtime files depend on `permissions/`, `core/logging`, `core/connection`, and Tauri
— none of which have moved yet, so their import paths are still valid. Doing it first
delivers the win immediately and shrinks `services/` and `features/chat/` before the
bigger reshuffles.

**Steps (in this sub-order):**
0. **Types first (D-9), or everything else fails to compile mid-move.** Split
   `services/ai/types.ts`: move `LocalToolCall` / `ToolResultItem` / `AutoRoutedInfo`
   / `APIChatMessage` → `src/types/chat.ts`; leave the HTTP chat shapes for Phase 3.
   Create `runtime/protocol.ts` and move `ChatRequestBody` / `AgentChatHandlers` (from
   `useAgentChat.ts`) + the WS envelope types (from `wsPool.ts`) into it. Repoint the
   10 `ai/types` importers + the 3 `useAgentChat`-type importers.
1. `git mv` the transport trio (`wsPool.ts`, `wsMessages.ts`, **`useAgentChat.ts`**) →
   `runtime/transport/`. `useAgentChat` is runtime glue (D-9); `ChatProvider` will
   import it from `@/runtime`.
2. `git mv` `mcpInvoker.ts` → `runtime/invoke/invokeMcpTool.ts`.
3. Split `localMcpControl.ts` → `runtime/servers/catalog.ts` + `manifest.ts`
   (doc 04 §A). Move `mcpService.ts` → **`core/mcpRegistry/registryClient.ts`** (it is
   dual-use — Extensions imports it too), and add `runtime/servers/manifestSync.ts`
   that calls it. Create `core/mcpRegistry/` now even though the rest of `core/`
   waits for Phase 2.
4. Split `useHarnessInit.ts` → `runtime/servers/lifecycle.ts` (no React) +
   `runtime/servers/useRuntimeInit.ts` (React wrapper). Keep the two legacy
   permission-key exports re-exported from the barrel.
5. Move `localCapabilities/*` → `runtime/capabilities/`; move `buildChatRequest.ts`
   → `runtime/capabilities/buildChatBody.ts`.
6. Split `toolExecutor.ts` → `runtime/execution/{executeLocalTools,workspaceDefaults,builtinTools}.ts`.
7. Move the tool-card UI (`mcpRegistry.tsx`⇒`toolCardRegistry.tsx`,
   `toolClassifier.ts`⇒`classifyToolDisplay.ts`, `ToolPermissionCard`,
   `HarnessStepCard`⇒`RuntimeStepCard`, `InlineToolSteps`, `toolCardUtils`) →
   `runtime/ui/`.
8. **Create `runtime/protocol.ts`**: lift the WS message interfaces from `wsPool.ts`
   (and mirror what `chat/src/agent/ChatAgent.ts` declares). Point `wsPool` and
   `wsMessages` at it. Add a one-line comment in `ChatAgent.ts` referencing this file
   as the shared source of truth.
9. **Create `runtime/index.ts`** exporting the public surface (doc 03 §2).
10. Repoint every importer to `@/runtime`. Find them with a search for the old paths:
    `services/mcp`, `services/local/localMcpControl`, `services/ai/mcpService`,
    `services/localCapabilities`, `services/conversations/wsPool`,
    `services/conversations/wsMessages`, `features/chat/context/toolExecutor`,
    `features/chat/context/toolClassifier`, `features/chat/context/buildChatRequest`,
    `features/chat/tools/*`, `hooks/useHarnessInit`.
11. Update `App.tsx`'s `useHarnessInit` usage → `useRuntimeInit`, and
    `HarnessPermissionModal` wiring stays (that modal is UI; leave it in `ui/` later).
12. Leave `services/local/daemonClient.ts` + `hooks/useDaemon.ts` **in place** (they
    move in Phase 2 to `core/daemon/`).

**VERIFY.** Build passes. Smoke test: start the app, run one `studio-harness` tool
(e.g. `ls`) and one permission-prompted tool; confirm cards render and results
return. This is the behavioral proof the carve-out preserved the data path.

**Done when.** ☑ All §A files in `runtime/`. ☑ `protocol.ts` + `index.ts` exist.
☑ No file outside `runtime/` imports a runtime internal path (all via `@/runtime`).
☑ Build + smoke pass.

---

## Phase 2 — Split `services/` into `core/` + daemon

**Goal.** Empty the infra half of `services/` into `core/` (doc 04 §B).

**Why now.** With runtime out, the remaining `services/` split is clean: infra →
`core/`, feature logic → features (Phase 3b). Do infra first because features import
infra, not vice-versa.

**Steps.**
1. `git mv` each §B group: `storage`, `network`, `errors`, `logging`, `platform`
   (merge `infrastructure/platform/` in), `notifications`, `connection`, `skills`,
   `config`, `constants`.
2. Create `core/daemon/` and move `services/local/daemonClient.ts` +
   `hooks/useDaemon.ts`; rewrite `services/local/index.ts` into `core/daemon/index.ts`
   (dropping the localMcp re-exports removed in Phase 1).
3. Repoint importers (`@/core/...`).
4. Delete now-empty `services/local/`, `infrastructure/`.

**VERIFY.** Build passes.

**Done when.** ☑ All §B moved. ☑ `infrastructure/` gone. ☑ `core/daemon/` holds the
daemon client + hook. ☑ Build passes.

---

## Phase 3 — `components/` → `ui/` and feature homes

**Goal.** Split the `components/` bucket: shared primitives → `ui/` (doc 04 §D),
feature code → its feature (doc 04 §C).

**Steps.**
1. **3a — primitives:** `git mv` `components/{ui→primitives,brand,icons,feedback,overlays,layout,notifications}` → `ui/*`; move `ErrorBoundary.tsx`.
2. **3b — feature code out of `components/`:** move the loose files to features per
   §C (models UI, voice UI, chat `AttachmentInput`, auth controls, `rightWorkspace/ResizeHandle`).
3. **3c — feature logic out of `services/` and `hooks/`:** move the §C service/hook
   groups (models services, voice hooks, chat conversations + attachments + services,
   `useAgentChat`, extensions `appIconCache`). Create the **new `features/auth/`**.
4. Repoint importers.
5. Delete now-empty `components/`, `hooks/` (leftovers go to `app/hooks` or `lib/hooks`
   in Phase 4), `services/`.

**VERIFY.** Build passes. Smoke: open Models, Voice, Extensions, Settings pages;
confirm they render.

**Done when.** ☑ `ui/` holds only shared primitives. ☑ No feature code left in a
shared bucket. ☑ `features/auth/` exists. ☑ Build + smoke pass.

---

## Phase 4 — `app/`, `lib/`, `design/`, contexts, permissions home

**Goal.** Finish the top-level layering (doc 04 §E, §F) and settle the permissions
home (doc 04 §C permissions row).

**Steps.**
1. Move `shell/` → `app/shell/`; `contexts/` → `app/contexts/` (minus the ones voice
   claimed); routing pages → `app/routes/`; globals → `app/globals/`.
2. Extract `AppProviders.tsx` + `AppRouter.tsx` from `App.tsx`; move `App.tsx` →
   `app/App.tsx` (keep `main.tsx` at `src/main.tsx`, update its import).
3. Move `utils/*` → `lib/*`; truly-global hooks → `lib/hooks/*`; `styles/` + `tokens/`
   → `design/*`; `artifacts/examples.ts` → `features/artifacts/`.
4. **Permissions:** move `permissions/*` → **`core/permissions/*`** (recommended) and
   merge/keep `features/permissions/` as the UI layer importing it. Repoint
   `runtime/execution` + chat.
5. Repoint importers everywhere.
6. Delete emptied top-level folders (`shell`, `contexts`, `utils`, `styles`, `tokens`,
   `pages`, `permissions`, `infrastructure`, `artifacts`).

**VERIFY.** Build passes. Smoke: full app boot to Home; auth gate; open a chat.

**Done when.** ☑ Top level matches doc 03 §1. ☑ `App.tsx` is thin. ☑ Permissions has
one home. ☑ Build + smoke pass.

---

## Phase 5 — Decouple `ChatProvider.tsx`

**Goal.** Break the 2079-line provider into composed hooks (doc 04 §G), behavior
unchanged.

**Why last.** By now the runtime glue and chat services it used are already relocated,
so what's left is genuinely chat-state orchestration — the cleanest possible split.

**Steps.**
1. Extract `useSendPipeline`, `useStreamHandlers`, `useConversationState`,
   `usePersistence` into `features/chat/context/` (or `features/chat/hooks/`).
2. Reduce `ChatProvider.tsx` to a thin composition that wires those hooks + provides
   context. No logic changes — move blocks verbatim, adjust closures.
3. (Optional, schedule separately) the other monoliths in §G.

**VERIFY.** Build passes. Smoke: send a multi-turn chat with a local tool call and a
permission prompt; confirm streaming, tool cards, task list, and persistence all work
exactly as before.

### Outcome — ChatProvider.tsx 2079 → 967 lines (−53%)

The provider is now state + turn-scoped refs + small derived setters + four hook
calls + the context value. Everything below was moved **verbatim**; deps are
destructured at the top of each hook so every `useCallback` dependency array is
unchanged and the staleness profile of each closure is identical to the original.

| Module | Owns |
|---|---|
| `context/runClaudeTurn.ts` | Claude Code (CLI bridge) turn driver + `mapClaudeToolName` |
| `context/useStreamHandlers.ts` | `useAgentChat` handlers, `handleStreamDone` (incl. DSML interception), question segments, the local-tool segment bridge |
| `context/useSendPipeline.ts` | `sendMessage`, pending-queue + drain, `streamAndSaveResponse`, `regenerate`, `continue` |
| `context/useConversationActions.ts` | create / load / fork / retitle / edit / delete / abort / memory toggle |
| `context/toolExecutionCallbacks.ts` | the `executeLocalTools` callback bundle |

Duplication removed along the way (each had been copy-pasted 2–4×):
`buildToolExecutionCallbacks`, `finishStreamingTurn` (end-of-turn teardown),
`failStreamingTurn` (Claude bailouts), `abortOptimisticSend` (sendMessage's four
early exits).

> **Do not** fold the `agentChat.onError` handler or `handleStreamDone`'s
> empty-response early return into `finishStreamingTurn` / `failStreamingTurn`.
> They reset overlapping but strictly *smaller* subsets of state; unifying them
> would clear `thinking`/segments where today's code deliberately does not.

> One new ESLint suppression, in `useSendPipeline`: once refs and setState fns
> arrive through a deps bundle rather than `useRef`/`useState` in scope,
> `exhaustive-deps` can no longer prove they are stable and demands them. The dep
> arrays are the originals verbatim; do not "fix" the warning by adding them.

Still inline (cohesive, low-value to move): message pagination
(`loadInitialMessages` / `loadMoreMessages`), `getOrCreateConversation`,
`persistConversationMetadata`. The doc's proposed `useConversationState` /
`usePersistence` split would separate these from the state they read; folded into
the provider they read as one coherent block.

**Done when.** ☑ `ChatProvider.tsx` is a thin composition. ☑ Extracted hooks own their
slices. ☑ Build + tsc pass. ☐ Smoke pass.

---

## Phase 6 — Dead-code purge (VERIFY-FIRST)

**Goal.** Remove proven-unreferenced scaffolding (doc 04 §H, rule D-7).

**Steps.**
1. For each candidate, grep `src/` + `index.html` + router for every import path and
   exported symbol. Paste the evidence into the commit body.
2. Delete only those with no external references.
3. Do **not** touch `features/workspace/rightWorkspace/`, `cliBridges/`, `daemon/`,
   `mcp-servers/`, `vendor/`.

### Outcome (VERIFY-FIRST corrected two candidates from the original draft)

Deleted — proven unreferenced:
- `core/platform/crossPlatformService.ts` — 135 lines of a disabled canvas feature.
  Zero importers at HEAD **and** at pre-reorg `9d3c262`, so it was already dead
  before this task rather than orphaned by it.
- 11 `export {};` placeholder barrels left by the Phase 0 skeleton: `app/`, `core/`,
  `design/`, `lib/`, `ui/`, and `runtime/{servers,transport,ui,capabilities,execution,invoke}/`.

**Kept — the original draft was wrong.** Both files this doc proposed deleting are
live; grep proved it:
- `app/routes/TemporaryPage.tsx` — routed from `HomePage.tsx` (`case "temporary"`).
- `app/routes/SplashPreviewPage.tsx` — mounted by `app/App.tsx` behind the
  `IS_SPLASH_PREVIEW` build flag.

Also fixed here (stale config the reorg left behind, not dead code):
- `eslint.config.js` now ignores `vendor/` (it was linting vendored git terminfo
  `.js` files → 2 parse errors) and its design-system rule message no longer points
  at the deleted `@/components/ui` path.

**VERIFY.** Build passes. Full smoke.

**Done when.** ☑ Only proven-dead files removed, with grep evidence. ☑ Build + tsc
pass. ☐ Full smoke pass.

---

## Phase 7 (optional) — Rust/cloud symmetry

**Goal.** Cosmetic alignment. Only if cheap.

**Steps.**
1. Optionally rename `src-tauri/src/mcp.rs` → `runtime.rs` (update `mod` +
   command registration). Skip if it risks the Tauri build.
2. Confirm the one-line `protocol.ts` cross-reference comment landed in
   `chat/src/agent/ChatAgent.ts` (from Phase 1 step 8).

**Outcome.** The `mcp.rs` → `runtime.rs` rename was **consciously skipped**: it is
cosmetic, and touching the Tauri `mod` + command registration risks the desktop build
for zero functional gain. The cross-reference comment is present at
`chat/src/agent/ChatAgent.ts:97`.

**Done when.** ☑ Optional rename done or consciously skipped. ☑ Cross-ref comment
present.

---

## Order rationale (why this sequence)

- **Leaf-first, dependency-down.** Runtime and infra have no upward deps, so moving
  them first never breaks features. Features move next; `app/` (which imports
  everything) moves last among structural phases.
- **Highest value first.** Phase 1 (the runtime carve-out) is the actual ask and is
  self-contained — ship it before the larger reshuffle so value lands even if later
  phases slip.
- **Monolith split after relocation.** Splitting `ChatProvider` only makes sense once
  its runtime/chat-service dependencies already live in their final homes; otherwise
  you'd split, then move, then re-split.
- **Delete last.** Dead-code removal is safest once all imports are settled — a file
  that looked dead mid-migration might just be mid-move.
