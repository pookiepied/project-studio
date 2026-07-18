# Version 2 Rehabilitation: Target Structure Audit

Evidence pass: 2026-07-18
Status: target-structure evidence. The combined execution policy is
`04-final-rehabilitation-plan.md`; file-specific actions are in
`03-file-ownership-ledger.csv`.
Scope: `STUDIO/` source, native shell, scripts, daemon, bundled capability
library, and build/config files relevant to V2 structure.
Independent cross-check: read-only sidecar agent `019f75b9-7d74-7093-8f17-4f6ff48ffa90`
audited `STUDIO/src/features` and returned feature-level keep/migrate/remove
evidence. Its useful classifications are folded in below. One sidecar statement
was corrected here: `git_checkout_branch` is registered in Rust; the missing
review command is `git_stash_and_checkout`.

## Correction

The previous version of this document was a starter direction. It was not a
complete second pass. It did not justify every move with enough file-level
evidence, and it could have caused bad structural work if treated as final.

This revision raises the bar:

- Every recommendation must name the current owner, future owner, and blocker.
- Removal candidates remain blocked until all frontend callers, native commands,
  bundle resources, build scripts, and data migrations are mapped.
- Physical moves and renames are not approved by this document. This document is
  the target map used to design later small slices.
- Any path not explicitly classified below is not approved for deletion.

## Verified Inventory

Current tracked Studio file count. Generated directories such as `node_modules`,
`dist`, and `target` are not tracked and therefore are not ledger rows:

| Area | Files | Read/audit status | V2 treatment |
| --- | ---: | --- | --- |
| `src` | 550 | Every tracked text file read; import/dead-code/size evidence recorded. File-specific blocked decisions remain in the ledger. | Primary Desktop/Web React source. |
| `src-tauri` | 77 | Every tracked text file read; Rust command/resource callers still require slice-specific proof before removal. | Native desktop shell and OS bridge. |
| `library` | 160 | Every tracked text file read; package ownership/provenance and replacement gates are recorded per file. | Legacy staging only. Migrate preserved packages to Studio CLI, then remove from Studio packaging/tree. |
| `daemon` | 16 | Every tracked text file read; local provider purpose verified from package, providers, Tauri launcher, and frontend callers. | Old Desktop local-provider service unless Studio CLI explicitly adopts it. |
| `scripts` | 6 | Inventory complete; script purposes classified by package scripts and content scan. | Build/release/vendor/proof utilities. |
| `public` | 7 | Inventory only. | Static assets; audit by references before cleanup. |
| `web` | 4 | Inventory only. | Web entry/distribution variant, not Desktop local runtime. |
| `gate` | 2 | Inventory only. | Quality baseline state; preserve unless gate process changes. |
| `vendor` | 2 | Manifest/docs read with harness, sync script, and Tauri resource evidence. | Move to Studio CLI packaging only if still required; otherwise remove after harness retirement. |
| `docs` | 2 | Historical Studio architecture/rehabilitation documentation. | Keep as evidence until replacement docs fully absorb live contracts. |
| Root/config | 17 | Package, build, web, Tauri-facing, CSS fixture, and repository metadata files. | Keep/review individually; two CSS fixtures are confirmed deletion candidates. |
| `.claude` | 1 | Claude-specific developer launch configuration. | Remove from product tree or retain only as explicit developer-owned configuration. |

Current `STUDIO/src` shape:

| Area | Files | Lines | Current role | V2 target |
| --- | ---: | ---: | --- | --- |
| `app` | 46 | 4648 | Boot, providers, routes, shell chrome, global listeners. | Keep as `app`, split into `entry`, `startup`, `providers`, `routes`, `shell`, `globals`. |
| `features` | 332 | 57510 | Product features and several execution surfaces. | Keep feature-oriented, but move execution authority out to `cloud` and `studio-cli`. |
| `core` | 74 | 8291 | Mixed infrastructure: storage, network, permissions, platform, errors, models. | Split into `platform`, `cloud`, `app-storage`, `security`, and feature-owned services. |
| `runtime` | 26 | 3073 | Desktop Local Runtime: WebSocket pool, local MCP lifecycle, local tool execution, runtime UI. | Extract only cloud client/display pieces, then delete the `runtime` subsystem. |
| `ui` | 27 | 1590 | Brand, feedback, icons, primitives. | Split into `design-system`, `brand`, and `shared/components`. |
| `lib` | 24 | 2320 | Mixed utilities, token manager, API client, parsers, hooks. | Move domain utilities to owners; keep only feature-neutral helpers in `shared`. |
| `design` | 7 | 580 | CSS tokens, typography, syntax, prose, motion/font constants. | Rename to `design-system` after CSS authority is mapped. |
| `cliBridges` | 5 | 155 | Claude-specific CLI bridge despite generic name. | Replace with `studio-cli`; keep external CLI only as advanced terminal/agent-runner if needed. |
| `types` | 6 | 364 | Shared DTO/type dumping ground. | Move to owner-local types plus `shared/types` for cross-boundary DTOs. |

Feature clusters by current size:

| Feature | Files | Lines | V2 classification |
| --- | ---: | ---: | --- |
| `chat` | 126 | 15663 | Highest-risk migration area; owns cloud/local/Claude conversation authority today. |
| `manage` | 14 | 13251 | Mostly model/admin registry; huge snapshot file needs source-of-truth decision. |
| `workspace` | 36 | 7285 | Mixes cloud workspace data, local test adapter, file/browser/terminal/review surfaces. |
| `markdown` | 22 | 3440 | Rendering system; likely keep, split artifact renderers from generic markdown. |
| `models` | 24 | 3185 | Model registry/local provider UI; split cloud gateway registry from local provider daemon. |
| `voice` | 19 | 2963 | Keep product feature; preserve provider lifetime and overlay contracts. |
| `artifacts` | 9 | 2677 | Keep, but lab/demo surface needs split/classification. |
| `settings` | 14 | 1877 | Keep, but local services/MCP settings will shrink after V2 removal. |
| `extensions` | 16 | 1765 | Reclassify against cloud connectors/registry and local MCP management removal. |
| `activity` | 10 | 1072 | Cloud/account activity surface; likely keep under `features/activity`. |
| `auth` | 5 | 1063 | Keep; belongs to Desktop/Web account shell. |
| `permissions` | 9 | 1039 | Keep UI, but engine/protocol must split between cloud display and Studio CLI approvals. |
| `transcription`, `tts`, `memories`, `computerUse` | 27 combined | 2196 | Product decision per feature; not deletion by default. |

## Feature Folder Classification

This table is the current feature-level V2 classification. It is not a deletion
approval; it identifies ownership pressure and the next safe action.

| Feature | Classification | Evidence | V2 action |
| --- | --- | --- | --- |
| `features/activity` | Keep. | `pages/useActivityData.ts` consumes cloud tracking endpoints via `apiManager` and authenticated fetch helpers. No local runtime authority found. | Keep as cloud observability/activity surface; later move clients to `cloud/activity`. |
| `features/artifacts` | Keep and split. | `ArtifactLabPanel.tsx` is the largest hand-authored app surface and contains catalog data, fixtures, generated media data, connector examples, activity preview UI, and controls. | Keep production artifact panel/rendering; split or remove lab/demo fixtures after product decision. |
| `features/auth` | Keep. | `AuthContext.tsx`, `GoogleLoginButton.tsx`, `googleSDK.ts`, and `tauriOAuth.ts` own account/login flow; `tauriOAuth.ts` invokes opener plugin. | Keep auth feature; move Tauri-specific OAuth bridge to `platform` later. |
| `features/chat` | Migrate/split with extreme care. | Imports `@/runtime`, `@/cliBridges`, Claude bridge, local conversation store, Claude transcript adapter, storage scope, and WebSocket send pipeline. | Keep chat UI; migrate local authority to Studio CLI and cloud authority to `cloud/chat`; retire Claude/local runtime after replacements. |
| `features/computerUse` | Candidate remove/archive from Desktop route. | Current page is a placeholder surface; actual computer-use capability lives under bundled MCP package. | Remove route or repurpose only if Studio CLI/native computer-use surface is defined. |
| `features/extensions` | Split/migrate. | `useMcpServers.ts` invokes `mcp_list_running`, `mcp_start_server`, `mcp_stop_server`, and resolves bundled local MCP servers. | Keep connector/cloud extension UI if needed; move local MCP management to Studio CLI/cloud registry or retire. |
| `features/manage` | Keep cloud/admin; split snapshot. | `modelRegistry/curatedRegistrySnapshot.ts` is 11k+ lines; registry service talks to backend registry endpoints. | Keep admin/model registry UI; move snapshot to generated/static/source-of-truth path. |
| `features/markdown` | Keep. | Reusable markdown, code, Mermaid, artifact renderers. No direct local execution authority found in scan. | Keep as shared rendering system; later split generic markdown from artifact rendering. |
| `features/memories` | Keep as cloud feature. | Page fetches memories endpoints; no local runtime ownership found. | Keep; move API client to `cloud` if needed. |
| `features/models` | Split/migrate local provider daemon. | `useLocalProviderDaemon.ts` invokes `local_provider_start/stop`; model context imports daemon client. | Keep model library/picker; decide whether Studio CLI owns local providers, then remove Desktop daemon path if so. |
| `features/permissions` | Keep UI, retarget protocol. | Permission cards/modal/hooks import `@/runtime` tool labels/icons and local capability grants. | Retarget to Studio CLI/cloud approval events; retire Local Runtime capability grant UI. |
| `features/settings` | Keep and shrink. | Settings imports runtime permission keys/capabilities and local service panels describe local harness. | Keep settings shell; remove/rename local harness settings after Studio CLI migration. |
| `features/transcription` | Product decision required. | Parakeet install/config services invoke shell/file commands. | Keep if Desktop owns local transcription addon; otherwise move to platform/native service or Studio CLI capability. |
| `features/tts` | Product decision required. | Edge TTS install/synthesis invokes shell/file commands. | Same as transcription. |
| `features/voice` | Keep and split. | Live session uses cloud chat services and local TTS; provider lifetime is mounted through `HomePage`. | Preserve voice session lifetime; split cloud chat, local TTS, overlay concerns. |
| `features/workspace` | Split/migrate. | Terminal invokes PTY, browser invokes native child webviews, review invokes Git, workspace service mixes cloud API and local seeded test adapter. | Keep only V2 surfaces that consume Studio CLI/cloud; split review, terminal, browser, files, and workspace data by owner. |

## Product Boundary

V2 should organize around product authority, not around vague folder importance.

1. Studio Web
   - Cloud-first distribution.
   - Uses Studio Cloud execution, Context Engine, Tool Pool, Tool Execution,
     Registry, Studio Data, Gateway, connectors, cloud memory, and cloud MCP or
     native tools.
2. Studio CLI
   - Local-first execution product.
   - Owns local repo/files/terminal/git authority, local coding sessions,
     headless local agent operation, local tool execution, and local transcript
     mechanics.
3. Studio Desktop
   - Native shell and orchestration product.
   - Owns windowing, auth/account, settings, cloud service access, Studio CLI
     launch/control, run visibility, review UI, side chat, artifacts, and
     product navigation.

Desktop should not keep a second local agent runtime. Cloud execution remains
cloud-owned. Local execution becomes Studio CLI-owned.

## Hard Target Decisions

These decisions correct the most important ambiguity in the earlier checkpoint.

- `STUDIO/src/runtime/**` is a legacy Desktop Local Runtime and is a deletion
  target. It may be mined temporarily for cloud WebSocket client code or
  run-event display components, but the target Studio source tree must not keep
  a folder or subsystem named `runtime`.
- `STUDIO/library/**` is a legacy bundled capability staging area and is a
  migration/removal target. MCP servers, skills, agent-library concepts, and
  local tool packages belong to `studio-cli`, cloud workers, or a separate
  reference/third-party source area, not to the Studio Desktop/Web app.
- `computer-use` must be preserved intact before removal from the Desktop
  bundle. Its package name is first-party (`@studio/computer-use`), so its target
  is `studio-cli/packages/computer-use`. Use temporary migration staging only if
  needed; do not label it third-party without verified external provenance.
- Desktop may keep thin clients named after their authority, such as
  `cloud/chat`, `studio-cli/client`, and `run-events`. Those are integration and
  display layers, not replacements for the old local runtime.
- Any temporary compatibility folder must be named as legacy or migration-only,
  and must not appear in the final target structure.

## Proposed Repository-Level Shape

```text
Project Studio/
  api/                         public API/auth-facing server project
  Backend/
    Cloud/                     cloud workers and cloud-first runtime systems
      gateways/
      data/
      context-engine/
      tool-pool/
      tool-execution/
      runtime/
      registry/
      connectors/
      agent-library/
      skill-library/
      mcp-library/
      tracker/
  studio-cli/                  future adjacent product, likely derived from OpenCode
    packages/
      computer-use/            preserved/migrated local capability package
      mcp-servers/             CLI-owned local MCP/tool packages if retained
      skills/                  CLI-owned local skill packages if retained
  third-party/
    reference/                 only verified externally sourced snapshots with license records
  migration-staging/           temporary checked migration copies when cross-product work requires them
  STUDIO/
    src/                       Desktop/Web React app shell and product UI
    src-tauri/                 native desktop shell and OS bridge
    web/                       web entry/distribution variant
    public/                    static assets
    scripts/                   build, release, vendor, gate utilities
    vendor/                    packaged external binaries/resources
    docs/                      Studio-specific rehabilitation notes
  documentation/
    version 2 rehabilitation/  V2 planning and audit trail
  temp/opencode/               external reference/fork workspace for Studio CLI
```

`Backend/Cloud` should not move into `STUDIO`. `studio-cli` should not live
inside `STUDIO/src`; Desktop should integrate it through a protocol/client.
`STUDIO/library` exists in the current checkout only as legacy staging and is
not part of the target repository shape.

## Proposed `STUDIO/src` Shape

```text
src/
  app/
    entry/                     React entry, pre-React theme/surface setup
    startup/                   readiness phases, splash lifecycle, app_ready contract
    providers/                 app-level provider composition and lifetimes
    routes/                    route-level composition
    shell/                     window chrome, navigation, docks, layout
    globals/                   global listeners, context menus, shortcut hosts

  platform/
    tauri/                     typed invoke wrappers and command-family clients
    windows/                   overlay/conversation/native window orchestration
    storage/                   app-local settings/cache storage only
    secure-storage/            token/keychain wrappers
    updates/                   updater and release metadata
    diagnostics/               local diagnostics/reporting

  cloud/
    api/                       endpoint config and authenticated fetch
    chat/                      cloud conversation/run client
    workspace/                 Studio Data workspace client
    models/                    gateway/model registry client
    connectors/                connector-facing client adapters
    activity/                  tracking/usage/log clients
    mcp-registry/              cloud/local registry sync contracts

  studio-cli/                  Desktop-side client only, not the CLI product source
    client/                    headless process/protocol client
    sessions/                  local session list/read/send/cancel API
    events/                    normalized local run event stream
    approvals/                 local approval request bridge
    review/                    CLI-backed diff/review adapters
    capabilities/              CLI availability/version/config detection
    terminal/                  optional PTY host when visible terminal remains

  run-events/
    components/                tool cards, inline steps, permission cards
    classify/                  display classification for cloud/CLI events
    types.ts

  features/
    chat/
    workspace/
    review/
    artifacts/
    settings/
    auth/
    models/
    activity/
    permissions/
    markdown/
    voice/
    transcription/
    tts/
    memories/
    extensions/

  design-system/
    tokens/
    typography/
    syntax/
    components/
    icons/

  shared/
    components/
    hooks/
    utils/
    types/
```

## Current To Target Mapping

| Current path | Verified role | Target path | Action | Blocker |
| --- | --- | --- | --- | --- |
| `src/main.tsx` | React mount, pre-React theme/window-surface setup, reload shortcut guard, global error logging. | `app/entry/main.tsx` plus `app/startup/preReactSurface.ts` | Split later. | Startup lifecycle contract. |
| `src/app/App.tsx` | Overlay/splash route detection, app initialization, secure storage, error handler, storage init, bundled skill deployment, `app_ready`, splash dismissal. | `app/startup/AppStartup.tsx`, `app/routes/WindowSurfaceRouter.tsx` | Split later. | Readiness phases and splash/native show contract. |
| `src/app/AppRouter.tsx` | Auth/API loading, background completion toast, runtime init modal, main route switch. | `app/routes/AppRouter.tsx` plus `studio-cli/capabilities` or legacy runtime gate during migration. | Keep then split runtime init out. | Local runtime removal plan. |
| `src/app/routes/HomePage.tsx` | Root view switch, provider lifetime for recording/chat/live session, global shortcut hosts. | `app/routes/HomePage.tsx` plus `app/routes/viewRegistry.tsx` | Split view registry later. | Provider lifetime contract. |
| `src/app/shell/**` | Standard titlebar, workspace shell, global dock, traffic lights, nav popup, layout width store. | `app/shell/**` | Keep; rename internals only after shell ownership map. | Global dock/top chrome ownership and layer registry. |
| `src/runtime/transport/wsPool.ts` | Cloud chat WebSocket pool, buffering, reconnect, local-tools-pending bridge. | `cloud/chat/runSocketPool.ts` after local tool callback is removed; delete old `runtime` folder afterward. | Migrate then delete source folder. | Cloud run protocol separated from local tool execution. |
| `src/runtime/transport/useAgentChat.ts` | React adapter for `wsPool`. | `cloud/chat/useCloudRun.ts` | Migrate. | Same as above. |
| `src/runtime/protocol.ts` | Cloud run WebSocket DTO plus local tool handler shapes. | Split to `cloud/chat/protocol.ts` and `run-events/types.ts`. | Split. | Cloud event protocol and CLI event normalization. |
| `src/runtime/servers/**` | Bundled local MCP catalog/lifecycle/manifest sync/runtime init. | No target Studio folder. Delete after callers move to Studio CLI/cloud clients. | Retire/delete. | Studio CLI protocol and replacement for local MCP/skill registry sync. |
| `src/runtime/execution/**` | Desktop local tool executor, permission gate, builtin tool handling. | No target Studio executor. Keep only approval/display types under `studio-cli/approvals` or `run-events` if needed. | Retire/delete. | Studio CLI owns local tool calls. |
| `src/runtime/invoke/invokeMcpTool.ts` | Tauri MCP IPC caller and output truncation/image extraction. | Delete from Desktop or move extraction helpers to `run-events`. | Retire/migrate. | No remaining `mcp_call_tool` callers. |
| `src/runtime/ui/**` | Runtime tool cards and display classification. | `run-events/components` and `run-events/classify`. | Keep/move. | Event shape normalized for cloud and CLI. |
| `src/cliBridges/**` | Claude-specific chat engine bridge. | `studio-cli/**`; optional `legacy/claude-bridge` until removed. | Replace. | Studio CLI local chat engine exists. |
| `src/core/storage/**` | App local storage, web storage, cloud chat storage, Tauri filesystem access, secure storage helpers. | `platform/storage`, `platform/secure-storage`, `cloud/chat/storage`, `studio-cli/sessions`. | Split. | Conversation/session ownership migration. |
| `src/core/network/**` and `src/lib/api.ts` | Endpoint registry and generic authenticated HTTP client. | `cloud/api/**`. | Move later. | API endpoints grouped by product client. |
| `src/core/permissions/**` | Permission mode config, risk engine, grants, scope filtering. | `features/permissions`, `studio-cli/approvals`, `run-events/types`, possibly `platform/security`. | Split. | Approval protocol for Studio CLI. |
| `src/core/platform/**` | Environment, windows, overlay, tray, shortcuts, autostart, paths. | `platform/**` | Move later. | Window/surface taxonomy. |
| `src/core/mcpRegistry/**` | Local registry sync to cloud registry. | `cloud/mcp-registry` plus `studio-cli/capabilities` if retained. | Reclassify. | Registry owner decision. |
| `src/features/chat/**` | Main conversation UX, cloud/local scope, Claude engine, local storage, runtime send/stream. | Keep UI under `features/chat`; move authority clients out. | Major migration. | Studio CLI local session protocol and cloud run client split. |
| `src/features/chat/conversations/storage/**` | Studio-owned local conversation JSON/JSONL/Markdown store. | Delete/migrate to `studio-cli/sessions/import`. | Retire. | Existing local conversation migration/import decision. |
| `src/features/chat/conversations/claude/**` | Claude native transcript adapter. | One-time importer or delete. | Retire. | Whether old Claude sessions need import. |
| `src/features/workspace/pages/WorkspacePage.tsx` | Cloud/local workspace page plus local test adapter UI state. | `features/workspace` with `cloud/workspace` service. | Split. | Workspace source contract. |
| `src/features/workspace/life/workspaceService.ts` | Cloud Workspace API client plus local seeded adapter plus AI organize. | Split to `cloud/workspace/client.ts`, `features/workspace/localFixtures.ts`, `features/workspace/organizeCapture.ts`. | Split. | Product decision: workspace page in Desktop V2. |
| `src/features/workspace/rightWorkspace/**` | Review/browser/terminal/files/side-chat/artifact/conversation panel mix. | `features/review`, `studio-cli/terminal`, `features/side-chat`, `features/artifacts`, `features/workspace/surfaces`. | Split after taxonomy. | Final right-panel surface list. |
| `src/features/workspace/browser/**` | Browser child webview/iframe panel. | Keep only if product surface remains. | Decide. | Browser product value decision. |
| `src/features/workspace/terminal/**` | Generic PTY terminal and CLI tabs. | `studio-cli/terminal` if used to host CLI; otherwise advanced terminal. | Migrate/remove. | Studio CLI headless/PTY strategy. |
| `src/features/workspace/rightWorkspace/ReviewPanel.tsx` | Direct Git review UI. | `features/review` consuming Studio CLI or direct Git adapter. | Keep/migrate. | Missing `git_stash_and_checkout` command bug and owner decision. |
| `src/features/models/**` | Model UI plus local provider daemon UI. | Split cloud model registry from local provider setup. | Split. | Does Studio CLI own local providers? |
| `src/features/settings/**` | Settings panels including local services/debug. | Keep, but remove local runtime settings after migration. | Shrink. | Runtime/MCP/local provider decisions. |
| `src/ui/**` | Brand/icons/primitives/feedback. | `design-system/**`, `brand/**`, `shared/components`. | Move after imports stable. | CSS/design authority. |
| `src/lib/tokenManager.ts` | Large auth token/secure storage manager. | `platform/secure-storage/tokenManager.ts` or `features/auth/services`. | Move/split. | Auth/session storage contract. |
| `src/types/**` | Cross-cutting DTOs. | Owner-local `types.ts` plus `shared/types`. | Split gradually. | Import graph cleanup. |

## Native Command Families

The Rust command inventory is now a hard prerequisite for removals.

| Native file | Commands / responsibility | V2 action |
| --- | --- | --- |
| `src-tauri/src/lib.rs` | Tauri builder, tray, startup visibility, `app_ready`, window close-to-tray, WebView2 mic patch, command registration. | Keep and split only after startup/window contract. |
| `src-tauri/src/commands.rs` | Secure storage, filesystem helpers, Claude bridge, local provider daemon commands, Chrome debug, CSP, shell streaming, platform info, OAuth server wrapper. | Split by command family; remove Claude/local provider only after callers gone. |
| `src-tauri/src/mcp.rs` | MCP subprocess manager, JSON-RPC, bundled server path resolution. | Retire from Desktop after Studio CLI owns local tools. |
| `src-tauri/src/pty.rs` | PTY session store and terminal events. | Keep only as Studio CLI host/advanced terminal. |
| `src-tauri/src/native_browser.rs` | Child webview browser panel commands. | Keep only if browser remains. |
| `src-tauri/src/commands/git.rs` | Git status/diff/stage/commit/branch commands. | Keep/migrate; review UI currently depends on it. |
| `src-tauri/src/local_registry.rs` | Local MCP/skill registry commands. | Reclassify under cloud registry/Studio CLI capability sync. |
| `src-tauri/src/control_server.rs` | Local control server config. | Reclassify with MCP/skill management. |
| `src-tauri/src/daemon/mod.rs` | Local provider daemon handle. | Candidate removal unless Studio CLI adopts it. |

Verified issue:

- `src/features/workspace/rightWorkspace/ReviewPanel.tsx` calls
  `invoke("git_stash_and_checkout", ...)`.
- `src-tauri/src/commands/git.rs` and `src-tauri/src/lib.rs` register
  `git_checkout_branch`, `git_create_branch`, `git_status_summary`, `git_diff`,
  `git_recent_commits`, `git_stage`, `git_unstage`, and `git_commit`, but no
  `git_stash_and_checkout`.
- The review surface is therefore a bug-bearing migration blocker, not a folder
  to delete blindly.

## Monolith Split Matrix

Line count is triage only. Split by responsibility and import direction.

| File | Lines | Current responsibilities | Target split | Import direction |
| --- | ---: | --- | --- | --- |
| `src/features/manage/modelRegistry/curatedRegistrySnapshot.ts` | 11519 | Snapshot data. | Decide generated/source-of-truth; do not hand-split. | UI imports data; data imports nothing. |
| `src/features/artifacts/components/ArtifactLabPanel.tsx` | 1870 | Lab catalog, fixtures, generated media data, connector fixtures, activity preview UI, selection controls. | `artifactLabCatalog.ts`, `fixtures/*`, `artifactLabBuildArtifact.ts`, `ArtifactActivityPreview.tsx`, root panel. | Root panel imports fixtures/components. |
| `src/features/workspace/pages/WorkspacePage.tsx` | 1045 | Page state, local helpers, note/task/project CRUD UI, Markdown editor, quick capture, context preview, revision UI. | `useWorkspaceController.ts`, `workspacePageUtils.ts`, `WorkspaceLibrary.tsx`, `WorkspaceEditor.tsx`, `WorkspaceDetailsPanel.tsx`, `QuickCaptureDrawer.tsx`. | Page imports controller and sections; sections receive props. |
| `src/features/chat/pages/ChatPage.tsx` | 675 | Chat page composition, shell/dock wiring, workspace panel wiring, composer props. | Wait for shell/global dock map; then split page controller and layout sections. | Page owns orchestration; shell consumes only public callbacks. |
| `src/features/chat/context/ChatProvider.tsx` | 573 | Conversation state coordinator, engine state, project context, tool state, streaming refs. | After Studio CLI/cloud split: `CloudConversationProvider`, `LocalCliSessionProvider`, `ChatUiStateProvider` or smaller hooks. | Provider composes authority clients; clients do not import UI. |
| `src/features/chat/context/useSendPipeline.ts` | 509 | Studio cloud send, Claude send, local runtime body building, image/doc handling, regeneration/continue. | `sendCloudTurn.ts`, `sendStudioCliTurn.ts`, `prepareAttachments.ts`, `continueOrRegenerate.ts`. | Pipeline imports cloud/CLI clients; no runtime executor. |
| `src-tauri/src/commands.rs` | 941 | Many unrelated command families. | `commands/storage.rs`, `commands/claude_bridge.rs` temporary, `commands/local_provider.rs`, `commands/browser_debug.rs`, `commands/shell.rs`, `commands/platform.rs`, `commands/oauth.rs`. | `lib.rs` registers command families. |
| `src-tauri/src/mcp.rs` | 573 | MCP subprocess lifecycle and JSON-RPC. | No split unless retained temporarily; otherwise remove after migration. | Runtime/CLI migration first. |
| `src/runtime/transport/wsPool.ts` | 518 | Cloud WebSocket pool plus local tool-pending execution bridge. | `cloudRunSocketPool.ts` without local executor; local tool events become display/approval protocol. | Cloud client emits events; UI subscribes. |
| `src/features/workspace/terminal/TerminalPanel.tsx` | 556 | xterm tabs, PTY lifecycle, panel chrome, resizing. | `usePtySessions.ts`, `TerminalTabs.tsx`, `TerminalViewport.tsx`, optional `StudioCliTerminalHost.tsx`. | Panel imports session hook and UI leaves. |
| `src/features/workspace/rightWorkspace/ReviewPanel.tsx` | 469 | Git status/diff/branch/commit UI plus missing stash command path. | `useReviewState.ts`, `ReviewFileList.tsx`, `DiffViewer.tsx`, `CommitPanel.tsx`, `BranchSwitcher.tsx`. | Review page imports adapter; adapter targets Studio CLI or Git service. |
| `src/lib/tokenManager.ts` | 492 | Token storage, refresh, secure persistence, user id helpers. | `authTokenStore.ts`, `tokenRefreshClient.ts`, `secureTokenPersistence.ts`. | Auth/platform services import secure storage. |

## Removal And Migration Dependencies

Do not delete a folder until these dependency checks are complete.

| Candidate | Required proof |
| --- | --- |
| `src/runtime/**` | All `@/runtime` callers moved to `cloud`, `studio-cli`, or `run-events`; `AppRouter` no longer starts local MCP runtime; chat send no longer calls `buildChatBody/getMcpServers/executeLocalTools`. |
| `src/cliBridges/**` | `ChatEngine` no longer includes `claude`; `ChatProvider`, `ChatComposer`, permission modes, conversation ownership, and Tauri `claude_bridge_*` callers are removed or migrated. |
| Local conversation store | Studio CLI session list/read/send protocol exists; local history UI reads CLI sessions or migration/import path is implemented. |
| Claude transcript adapter | Decision made whether to import old Claude sessions; `claude-native:` ids no longer needed in live list. |
| Bundled MCP packages | `mcp-build.mjs`, `tauri.conf.json` resources, `src-tauri/src/mcp.rs`, runtime catalog, settings/extensions callers are all removed/migrated. |
| PTY terminal | Studio CLI headless strategy decided; generic terminal either stays advanced tool or is removed from primary chat. |
| Native browser | Browser product decision made; `native_browser_*` callers gone if removed. |
| Local provider daemon | Studio CLI/cloud gateway ownership of local models decided; models/settings callers gone if removed. |

## Naming Decisions

Use names that describe authority:

| Current name | Problem | Candidate |
| --- | --- | --- |
| `runtime` | Conflicts with cloud runtime and is not future local authority. | Split into `cloud`, `studio-cli`, `run-events`, then delete legacy. |
| `cliBridges` | Generic name hides Claude-only implementation. | `studio-cli`; temporary `legacy/claude-bridge` if needed. |
| `core` | Mixed infrastructure and domain code. | `platform`, `cloud`, `security`, feature-owned services, `shared`. |
| `lib` | Utilities plus auth/API/token/domain parsers. | `shared/utils` for true utilities; owner folders for domain code. |
| `ui` | Presentation dumping ground. | `design-system/components`, `design-system/icons`, `brand`, `shared/components`. |
| `design` | Acceptable but less explicit. | `design-system` after CSS authority audit. |
| `workspace/rightWorkspace` | Describes placement, not responsibility. | `features/review`, `features/side-chat`, `features/workspace/surfaces`, `studio-cli/terminal`. |

## Implementation Order

1. Remove only the proven-dead first slice recorded in the final plan.
2. Define Studio CLI Desktop protocol:
   - launch/headless mode
   - session list/read/send/cancel
   - stream events
   - tool-call events
   - approval requests
   - file/git/review events
   - error/reconnect semantics
3. Split cloud chat transport from Desktop local tool execution.
4. Migrate local chat/workspace authority from Claude/local runtime to Studio CLI.
5. Remove Claude chat engine path.
6. Migrate or import local conversation history.
7. Retire local MCP runtime from Desktop.
8. Remove bundled MCP build/resources only after runtime callers are gone.
9. Simplify right workspace surfaces.
10. Split monoliths and rename folders after removal reduces the tree.
11. Apply the final judgment policy to the post-removal tree, then execute the
    accepted target-path and rename matrix in small manual slices.

## Remaining Gates Before Structural Implementation

The file inventory and first disposition pass are complete. These implementation
gates remain mandatory for rows that are still blocked:

- Exact frontend-to-native invoke matrix, including dynamic invokes inside
  `nativeBrowserService.ts`.
- Exact package/resource/caller matrix for runtime, MCP, daemon, vendor, and
  local conversation removal clusters.
- Provenance/license recovery for code proposed for external/reference storage.
- Studio CLI protocol and data-import contracts required by blocked rows.
- Product decisions for browser, terminal, files, review/Git, local providers,
  transcription/TTS, and the YouTube transcript gitlink.
- Fresh asset/reference, dead-code, import-cycle, and cross-boundary reports at
  the start of each relevant implementation slice.

This target document is not itself a deletion or rename checklist. Execution is
authorized only by a scoped ledger selection and the slice contract in the final
plan.
