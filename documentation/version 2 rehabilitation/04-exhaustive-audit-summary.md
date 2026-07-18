# Version 2 Rehabilitation: Exhaustive File Audit Summary

Evidence pass: 2026-07-18
Status: tracked-file audit checkpoint, not implementation approval.
Ledger: `03-file-ownership-ledger.csv`

## What Was Audited

This pass audits every tracked file under `STUDIO/`, excluding only generated
Git worktree directories such as `node_modules`, `dist`, and `target`.

- Total tracked audit rows: 844 files.
- Ledger rows: 845 lines, including the CSV header.
- The ledger records: path, line count, current area, current role, V2 owner,
  action, confidence, and evidence/blocker.

The CSV is now the file-level source of truth. This summary is only the readable
map over that file-level ledger.

## Important Correction

The previous structure checkpoint was not strict enough. The real V2 boundary is:

- Studio Desktop/Web is an app shell, product UI, cloud client, and Studio CLI
  integration surface.
- Studio CLI owns local repo/files/terminal/git/session/tool execution.
- Studio Cloud owns cloud runtimes, cloud registry, connectors, context engine,
  tool pool, tool execution, gateway, cloud memory, and cloud MCP/native tools.
- Studio Desktop must not keep a second local agent runtime, local MCP execution
  substrate, local provider daemon, generic Claude bridge, or local conversation
  store as final architecture.

## Hard Removal Or Migration Targets

These are not approved for immediate deletion. They are classified as
remove/migrate targets, with caller and packaging blockers still required before
actual removal.

| Area | Files | Ledger action | Decision |
| --- | ---: | --- | --- |
| `STUDIO/library/mcp-servers/desktop/computer-use/**` | 66 | `PRESERVE_THEN_MIGRATE_OUT_OF_STUDIO` | Preserve intact first; move to Studio CLI package or reference storage. |
| `STUDIO/library/mcp-servers/harness/studio-harness/**` | 63 | `MIGRATE_OR_REMOVE_AFTER_CLI_REPLACEMENT` | Legacy local coding/files/git/shell MCP server; replace with Studio CLI/OpenCode-derived implementation. |
| `STUDIO/library/mcp-servers/system/**` | 30 | `MIGRATE_OR_REMOVE_AFTER_OWNER_EXISTS` | Local MCP/skill management/execution belongs to Studio CLI or cloud registry/workers. |
| `STUDIO/library/skills/studio-computer-use/skill.json` | 1 | `MIGRATE_TO_CLI_OR_REFERENCE` | Skill metadata follows computer-use out of Studio. |
| `STUDIO/daemon/**` | 16 | `MIGRATE_TO_CLI_OR_REMOVE` | Ollama/LM Studio local-provider bridge; not a final Desktop-owned subsystem. |
| `STUDIO/vendor/**` | 2 tracked files | `MIGRATE_TO_CLI_OR_REMOVE` | Manifest/docs for harness `rg`, Git, Bash vendoring; only remains if Studio CLI owns that dependency. |
| `STUDIO/src/runtime/**` | 26 | `DELETE_AFTER_EXTRACTION` | Desktop Local Runtime. Extract cloud socket/display pieces only; no target `runtime` folder remains. |
| `STUDIO/src/cliBridges/**` | 5 | `REMOVE_AFTER_STUDIO_CLI_REPLACEMENT` | Claude-specific bridge hidden behind generic naming. |
| `STUDIO/src/features/chat/cliTabs/**` | 5 | `REMOVE_OR_REPLACE_WITH_STUDIO_CLI` | Generic Claude/Codex/OpenCode tab launcher should not be primary chat engine. |
| `STUDIO/src/features/chat/conversations/storage/**` | 4 | `MIGRATE_OR_REMOVE_AFTER_CLI_SESSION_PROTOCOL` | Desktop-owned local transcript/session store should be replaced by Studio CLI sessions/import path. |
| `STUDIO/src/features/chat/conversations/claude/**` | 3 | `REMOVE_OR_ARCHIVE_IMPORTER` | Claude native transcript adapter; keep only as one-time importer if needed. |
| `STUDIO/src-tauri/src/mcp.rs`, `local_registry.rs`, `control_server.rs` | 3 | `MIGRATE_OR_REMOVE_AFTER_CALLERS_GONE` | Native local MCP/skill registry/control runtime. |
| `STUDIO/src-tauri/src/daemon/mod.rs` | 1 | `MIGRATE_TO_CLI_OR_REMOVE` | Native launcher for the local provider daemon. |
| `STUDIO/scripts/mcp-build.mjs` | 1 | `MIGRATE_TO_CLI_OR_REMOVE` | Builds bundled MCP packages for current Desktop bundle. |
| `STUDIO/scripts/vendor-sync.mjs` | 1 | `MIGRATE_TO_CLI_OR_REMOVE` | Feeds harness/vendor dependency path. |
| `STUDIO/twtest_input.css`, `STUDIO/twtest_out.css` | 2 | `REMOVE_CANDIDATE` | Tracked Tailwind test/generated artifacts at root. |
| `STUDIO/.claude/launch.json` | 1 | `REMOVE_OR_ARCHIVE` | Claude-specific local dev launcher. |
| `STUDIO/src-tauri/yt-transcript-mcp` | 1 | `DECIDE_MIGRATE_OR_REMOVE` | Gitlink/submodule; not normal Studio source. |

## Major Split Targets

These files/folders are not deletion targets by default, but they are currently
monolithic or mix ownership boundaries.

| Area | Ledger action | Why |
| --- | --- | --- |
| `STUDIO/src/features/chat/**` | `SPLIT_RETARGET_REMOVE_LOCAL_RUNTIME` | Chat mixes cloud run, Desktop runtime, Claude bridge, local storage, local capability prompts, and UI state. |
| `STUDIO/src/features/workspace/**` | `SPLIT_CLOUD_WORKSPACE_FROM_LOCAL_SURFACES` and local-surface decisions | Workspace mixes cloud workspace data with local files, terminal, browser, review, project launcher, and fixtures. |
| `STUDIO/src/features/models/**` | `KEEP_SPLIT_LOCAL_PROVIDER_BITS` and local-provider migration | Model UI mixes cloud model registry with direct Ollama/LM Studio and daemon paths. |
| `STUDIO/src/features/extensions/**` | `SPLIT_REMOVE_LOCAL_MCP_MANAGEMENT` | Extension UI currently invokes Desktop `mcp_*` commands. |
| `STUDIO/src/features/settings/**` | `KEEP_SHRINK_LOCAL_RUNTIME_SETTINGS` | Settings exposes harness, local services, daemon, transcription, and TTS toggles. |
| `STUDIO/src-tauri/src/commands.rs`, `lib.rs` | `SPLIT_AND_REMOVE_LEGACY_COMMANDS` | Registers startup/window/tray, secure storage, OAuth, shell/file helpers, Claude bridge, MCP, daemon, PTY, browser, Git. |
| `STUDIO/src/core/storage/**` | `SPLIT_BY_STORAGE_SCOPE` | App local settings, web storage, cloud storage, secure storage, and memory storage are mixed. |
| `STUDIO/src/core/permissions/**` | `SPLIT_RETARGET_APPROVAL_PROTOCOL` | Permission engine still knows `ChatEngine`, MCP management, local tool risk, and Git risk. |
| `STUDIO/src/lib/**` | `SPLIT_BY_IMPORT_OWNER` | Shared utilities include API client, token manager, parsers, prompts, model/project helpers. |

## Product Decision Targets

These need a product decision before code moves or deletion:

- Native browser: keep only if Desktop browser adds unique review/research value.
- PTY terminal: keep only as Studio CLI host or advanced terminal, not generic chat engine.
- Git/review: Desktop may keep review UI, but repo authority should likely be
  Studio CLI. Current `ReviewPanel` also calls missing `git_stash_and_checkout`.
- Transcription and TTS: keep as Desktop optional add-ons or move to Studio CLI
  capability surface.
- Direct files panel/Monaco source view/project app launcher: likely migrate to
  CLI-backed focused surfaces or remove as direct file-manager duplication.
- `src-tauri/yt-transcript-mcp`: decide whether it belongs to Studio CLI/cloud
  capability registry or should be removed.

## Keep, But Reorganize Later

These areas are generally retained, but still need physical organization after
removal/migration decisions:

- `STUDIO/src/app/**`: keep shell/startup/providers/routes, then split startup
  lifecycle, window surfaces, providers, shell, docks, globals.
- `STUDIO/src/design/**`: keep as design system, rename after CSS authority map.
- `STUDIO/src/ui/**`: keep primitives/brand/icons, reorganize into
  design-system/shared/brand.
- `STUDIO/src/features/activity`, `auth`, `markdown`, `memories`, `voice`,
  `permissions`: keep product features, split only where platform/cloud/approval
  authority leaks.
- `STUDIO/web/**`: keep as web distribution entry, but keep cloud/web semantics
  separate from Desktop local execution.
- `STUDIO/gate/**`, root config files, installer icons/assets: keep and update
  after command/package surface shrinks.

## Next Required Pass

Before deleting or moving source, the next pass must use the ledger to produce
an ordered removal plan:

1. Caller matrix for every `MIGRATE`, `REMOVE`, `DELETE`, and `DECIDE` row.
2. Packaging matrix for Tauri resources, package scripts, bundle resources,
   locks, and generated directories.
3. Data migration/import decisions for local conversations and Claude sessions.
4. Studio CLI protocol requirements for local sessions, tools, approvals,
   terminal/headless mode, Git/review, and computer-use.
5. Final target tree after removing V2-incompatible owners.

