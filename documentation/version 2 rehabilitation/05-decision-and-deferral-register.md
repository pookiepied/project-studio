# Version 2: Decision And Deferral Register

Purpose: a single running record of what was decided, what was fixed, and what
was deliberately left for later. The ledger tracks files; the final plan tracks
phases; this document tracks *judgment* so that a deferral never becomes an
accidental permanent state.

Every deferral must name the phase that owns it. An item with no owning phase is
a bug in this register, not an acceptable backlog entry.

Last updated: 2026-07-19.

## Decisions Taken

| # | Decision | Rationale | Date |
| --- | --- | --- | --- |
| D-01 | Keep `@react-three/fiber` despite knip reporting it unused. | It is a real runtime dependency, imported by the compiled output of `@shadergradient/react`, which `ProjectShaderCover` loads. Proven by build failure when removed. Added to `knip.json` `ignoreDependencies`. | 2026-07-18 |
| D-02 | Remove the `yt-transcript-mcp` gitlink and cancel YouTube transcript support. | Genuinely third-party (MIT, external upstream), orphaned gitlink with no `.gitmodules` mapping, wired into nothing. Product owner cancelled the feature. | 2026-07-19 |
| D-03 | Accept the two remaining `dompurify` advisories. | Both come from `monaco-editor`'s internally bundled `dompurify@3.2.7`. We are already on the latest monaco (0.55.1); npm's only "fix" is a semver-major downgrade to 0.53.0. No forward fix exists until upstream monaco updates. Exposure is low: Monaco renders local file content in a desktop app. | 2026-07-19 |
| D-04 | Stage the computer-use copy under the existing `temp/` tree rather than `third-party/` or `studio-cli/`. Refined by D-07 to the exact path `temp/computer-use-migration`. | Studio CLI does not exist yet as a stable tree. `third-party/` is wrong on the evidence (see O-01). Staging under `temp/`, alongside the OpenCode clone, defers the naming question without asserting false provenance. | 2026-07-19 |
| D-05 | Do not build Studio CLI as part of the rehabilitation program. | Converting the OpenCode clone into Studio CLI is an unbounded product build with no ledger rows and no defined done-state. It would break the slice contract. It runs as its own tracked program. | 2026-07-19 |
| D-06 | Keep the Composio connector UI in the Studio frontend; retire only the local MCP management inside the same feature. | `composioService.ts` already targets the cloud `connectors` worker through `apiManager`, so it is correctly a cloud client. `useMcpServers.ts` in the same feature invokes local `mcp_*` Tauri commands and is the part that retires. See O-02. | 2026-07-19 |
| D-07 | Stage the preserved computer-use copy in `temp/computer-use-migration`, but treat Git history plus the tracked checksum manifest as the real preservation guarantee. | `temp/` is gitignored (`.gitignore:66`), so a copy placed there is not version-controlled and cannot by itself satisfy "preserve intact". The manifest at `artifacts/computer-use-checksums.sha256` is tracked, so any future copy can be proven identical. | 2026-07-19 |
| D-08 | Normalize three minified `package.json` files to standard indentation while adding metadata. | `mcp-management`, `skill-execution`, and `skill-management` were single-line minified; the other two packages were already pretty-printed. Minification in a hand-editable manifest is an artifact, not a style choice. Semantically identical. | 2026-07-19 |
| D-09 | Set `"license": "UNLICENSED"` and `"private": true` on all five `@studio/*` packages. | `UNLICENSED` is the conservative direction: it grants no rights. Choosing a permissive license such as MIT would give away rights that may not have been intended, and that is far harder to walk back than the reverse. `private: true` additionally blocks accidental `npm publish` of proprietary code. Change to MIT/Apache later if these are ever opened up; that is a deliberate grant and a one-line edit. | 2026-07-19 |
| D-10 | Re-baseline the lint ratchet at its existing 38 errors rather than fixing them first. | The problem was never the 38 violations; it was that a red gate cannot detect *new* violations. Re-baselining restores that detection immediately at zero risk. The baseline is per-file, so a new violation in any of the eight files still fails, and fixing a file lowers its number. The plan explicitly permits re-baselining with justification. | 2026-07-19 |
| D-11 | Derive the Studio CLI contract from the CLI's existing API rather than specifying one. | `temp/opencode` already ships a typed HTTP API and SSE event stream with 18 protocol groups. Writing an idealized contract against a CLI that already has a real one would produce fiction. R2's deliverable is a mapping plus gap analysis. | 2026-07-19 |
| D-12 | Do not unify the cloud and CLI transports. | Cloud chat is WebSocket; the CLI is SSE. Only the normalized event model in `run-events` is shared. Forcing one transport layer would couple two independently evolving protocols. | 2026-07-19 |
| D-15 | Local-session attachments pass by reference, not upload. | `PromptInput.FileAttachment` carries a `uri`, and `resolvePrompt` in `packages/core/src/session.ts` accepts either a `data:` URI or a parseable URL/path, deriving MIME from either. Local workspace files can therefore be passed by path and never leave the machine. Cloud sessions keep the existing Studio Data upload path. | 2026-07-19 |
| D-19 | Complete the Studio CLI rebrand now, as an isolated subagent task, before Desktop integration. | R3 slices 3.4-3.6 will hardcode env var names, config paths, and the binary name. Renaming after integration forces a second pass through Desktop. The package rename is already done, so the tree is stuck in a half-state. 460 test files provide a verification baseline. The work is isolated from STUDIO. Supersedes the narrow reading of D-05, which was about not building CLI *functionality*; a naming pass is not product work. | 2026-07-19 |
| D-20 | Clean break on CLI naming: no backward compatibility. | Nobody uses this CLI and Desktop is its only future consumer, so dual-path config/env fallback code would be written only to be deleted. Confirmed by the product owner. | 2026-07-19 |
| D-17 | The Studio CLI already runs; no build-out is needed to unblock R3. | Verified live on 2026-07-19: `bun run --conditions=browser ./src/index.ts serve --port <n>` from `temp/opencode/packages/studio` starts a working server. `/api/health` returned `{"healthy":true}`, `/api/event` streamed `server.connected` plus heartbeats, and `/api/session` responded. Bun 1.2.19 and 648 installed dependencies were already present. Creating a separate runnable copy would duplicate a working tree for no gain. | 2026-07-19 |
| D-16 | Split the cloud generated-image helpers out of the display classifier during the run-events extraction. | `extractGeneratedImageIds` and `deleteRemoteImages` matched a cloud endpoint shape and issued a DELETE `fetch`. Leaving them in `run-events/classify` would have put a cloud network call inside an authority-neutral display module, contradicting the point of the extraction. Moved to `features/chat/services/generatedImages.ts`, target owner `cloud/chat`. | 2026-07-19 |
| D-14 | Retire the CLI bridge entirely rather than retargeting it from Claude Code to Studio CLI. Desktop launches `studio serve` and speaks HTTP + SSE through the generated SDK. | The CLI ships a headless `serve` command, and its own TUI is an HTTP client of that server rather than a stdio consumer. A generated typed SDK (`createStudioClient`) already exists. A PTY bridge would mean parsing human-readable output from a program that already offers a typed API with a structured event stream. | 2026-07-19 |
| D-21 | The subset diff, not the failure total, is the Studio CLI rebrand's gate. | A name-level `comm -13` of sorted-unique baseline failures against current failures is the only check that detects "something that passed now fails". Totals are misleading in both directions: a falling total hid six broken auth tests, and a flat total hid a 14-item cluster swap. See C-05. | 2026-07-19 |
| D-22 | Judge each remaining OpenCode-era subsystem by need, not by repairability: needed and broken gets fixed or rebuilt, unneeded gets removed. | Confirmed by the product owner. Studio is a private product embedded in a desktop app, so upstream's community-maintenance and public-distribution machinery has no role regardless of whether it works. Rebuilding a release pipeline we control is cheaper than adapting one wired to an org we do not own. | 2026-07-19 |
| D-13 | Make the `run-events` extraction the first slice of R3, ahead of any protocol work. | Verified that `src/runtime/ui/` imports nothing from transport, execution, servers, or protocol. It is a pure relocation with no CLI dependency, and it shrinks the `src/runtime` deletion surface before protocol risk is introduced. | 2026-07-19 |

## Deferred Items

| # | Item | Owning phase | Why deferred | Risk if forgotten |
| --- | --- | --- | --- | --- |
| F-01 | Bundle size: main chunk 11.4 MB raw, ~4.3 MB gzipped. | W7 | R3-R7 delete `src/runtime`, the local MCP substrate, the Claude bridge, and several right-panel surfaces. Chunk tuning now would be redone after every removal phase. | Startup performance stays poor. Revisit immediately after R7, before W7 optimization is declared done. |
| F-02 | Static-plus-dynamic import duplication for `unifiedStorageService`, `apiManager`, `errorReporting`. | R3/R4 | These are exactly the modules R3 and R4 re-own. Fixing the import pattern now is discarded work. | Code-splitting stays defeated. Must be re-checked when R3/R4 land, not left to W7. |
| F-03 | 38 lint-ratchet errors (design-system violations) across 8 files. | A dedicated slice whenever the app can be run and inspected; no later than W6 | Ratchet re-baselined per D-10, so regression detection is restored and the gate is green. The remaining blocker is *verification capability*, not wasted effort: an earlier version of this register claimed the work would be thrown away by restructuring, and that was wrong. None of the eight files are deleted by R3-R7; they are kept, split, or moved, so a `<button>` to `<Button>` swap survives. The real risk is that these changes alter rendered output and cannot be visually confirmed in an environment without credentials. | Moderate now that the gate is green. The 38 remain, and a per-file baseline can normalize them into permanence if nobody lowers it. |
| F-04 | 26 unused exports and 26 unused exported types. | W4 | Each needs per-symbol caller review; no runtime cost because the bundler already drops them; the files move or die in R3-R7. | Low. Purely a report-noise issue. |
| F-05 | `ArtifactLabPanel.tsx` (1,870 lines) has no consumer and is fully dead. | Product decision, then W3 | Artifact surface ownership is undecided: separate catalog page versus right-panel surface. Not a mechanical dead-code removal. | Largest single dead-code item in the tree. Decide before W3 begins. |
| F-06 | `documentation/audit/` G-02 lists restoring `youtube-transcript` into `Backend/Cloud`. | Cloud audit program | D-02 cancelled the feature in Studio, but the cloud remediation binder still plans to restore it. Different program, not touched here. | Cloud work could re-introduce a cancelled feature. Confirm cancellation there. |
| F-07 | Remove the Studio copy of computer-use plus its Tauri resources, `mcp-build.mjs` entry, catalog registration, and source references. | R5 | The package is still live and bundled. Removing it in R1 breaks the desktop build. | This is the step that actually completes R1's intent. R5 must not close without it. |
| F-09 | Git/review is implemented in the CLI core but not exposed over HTTP. | R7, plus a CLI-side protocol addition | `packages/core/src/git.ts` provides a full `@studio/GitV2` service including `change.capture`, `change.apply`, and `change.discard`, which is exactly accept/reject of file changes. There is no `git` protocol group, so none of it is reachable from Desktop. The session already knows which files it changed via `revert.files` and snapshots; Desktop's Tauri git cannot answer that question because it has no session concept. | Recommended resolution: expose a git group in the CLI and have Desktop mirror it. Pending product-owner confirmation. See contract G-1. |
| F-10 | Migration format mapping for existing local conversations and Claude transcripts. | R4 | Downgraded from a hard block: `studio import <file>` accepts session data as JSON, and `studio export` emits that shape. The remaining work is converting Desktop's stores into that schema, using export output as the target. | R4 needs the format mapping, not a new API. See contract G-2. |
| F-11 | ~~SSE reconnect/replay unverified.~~ **Resolved 2026-07-19 by inspection:** there is no SSE resume. Events are emitted with `id: undefined`, so `Last-Event-ID` cannot work, and the subscriber queue is dropping at capacity 256. Desktop must reconcile via `session.history` after any disconnect or overflow, and must never block the subscription while rendering. Now a design constraint, tracked in the contract. | Closed | - | - |
| F-08 | ~~Package metadata: `license` absent on all five `@studio/*` packages.~~ **Resolved 2026-07-19** by D-09: `UNLICENSED` + `private: true`. | Closed | - | - |

## Rename Candidates

Recorded at move time, applied in W5. The plan requires a candidate name to be
recorded before a move; these are those records. Nothing here is applied yet,
because renaming during a relocation makes the diff unreviewable.

| Current | Candidate | Why | Owning phase |
| --- | --- | --- | --- |
| `run-events/components/RuntimeStepCard.tsx` | `RunStepCard.tsx` | Carries the legacy `Runtime` prefix into a subsystem that deliberately replaced the local runtime. | W5 |
| `run-events/components/toolCardRegistry.tsx` | `toolCardRegistry.ts` or keep | Holds JSX so the extension is correct today; revisit if the registry becomes data-only. | W5 |
| `src/runtime/**` | deleted, not renamed | Target tree keeps no `runtime` folder. Remaining contents split to `cloud/chat`, `studio-cli/*`, or are removed. | R3-R5 |
| `src/cliBridges/**` | deleted | Generic name hiding a Claude-only implementation. Superseded by the CLI client. | R3 |
| `src/core/**` | `platform`, `cloud`, `security`, `shared` | Mixed infrastructure and domain code. | W5 |
| `src/lib/**` | `shared/utils` plus owner folders | Utilities mixed with auth/API/token/domain parsers. | W5 |
| `src/ui/**` | `design-system/*`, `brand`, `shared/components` | Presentation dumping ground. | W5 |
| `src/design/**` | `design-system` | Less explicit than the target name. | W5 |
| `workspace/rightWorkspace/**` | `features/review`, `features/side-chat`, `features/workspace/surfaces` | Describes placement, not responsibility. | W5 |

## Legacy Removal Checklist

Every legacy item that must eventually disappear, with the phase that owns the
deletion. This exists so that "we will remove it later" is auditable rather than
aspirational. An item may only be struck when its removal is committed.

| # | Legacy item | Owning phase | Blocked by |
| --- | --- | --- | --- |
| L-01 | `src/cliBridges/**` and the Claude chat-engine path | R3 | Nothing; retirement decided in D-14 |
| L-02 | `claude_bridge_start` / `claude_bridge_stop` Tauri commands | R3 | All frontend callers removed first |
| L-03 | `ChatEngine = "studio" \| "claude"` type and Claude metadata in chat types | R3 | Conversation authority model replaces it |
| L-04 | `src/runtime/transport/**` (wsPool, useAgentChat) | R3 | Extract to `cloud/chat` first |
| L-05 | `src/runtime/execution/**` (executeLocalTools, permission gate) | R3 | CLI owns tool execution |
| L-06 | `src/runtime/capabilities/**` (buildChatBody, getMcpServers) | R3/R5 | Cloud body building moves to `cloud/chat` |
| L-07 | `src/runtime/servers/**` (local MCP catalog/lifecycle) | R5 | CLI owns local MCP |
| L-08 | `src/runtime/invoke/invokeMcpTool.ts` | R5 | No remaining `mcp_call_tool` callers |
| L-09 | `src/runtime/` folder itself | R5 | All of L-04 through L-08 |
| L-10 | Local conversation store and Claude transcript adapter | R4 | Migration format mapping (F-10) |
| L-11 | Bundled MCP Tauri resources and `mcp-build.mjs` entries | R5 | Runtime callers gone |
| L-12 | Studio copy of computer-use and its registrations | R5 | Same as F-07 |
| L-13 | `library/mcp-servers/harness/studio-harness/**` | R5 | CLI covers local coding tools |
| L-14 | `library/mcp-servers/system/**` (mcp/skill management/execution) | R5 | Schemas moved to CLI or cloud |
| L-15 | `STUDIO/daemon/**` and `local_provider_*` commands | R6 | Local provider ownership decision |
| L-16 | Vendored `rg`/Git/Bash packaging | R6 | CLI packaging decision |
| L-17 | `docs/architecture/Cloud and Local*.md` | W6 | Superseded by V2 docs |
| L-18 | `OPENCODE_*` env var names surfaced to Desktop | CLI program | Upstream rebrand incomplete |

## Corrections To Earlier Findings

Recorded so that a wrong call made confidently does not survive as fact.

| # | Original claim | Correction | Date |
| --- | --- | --- | --- |
| C-01 | The 38 lint errors would be throwaway work because the files get restructured. | Wrong. None of the eight files are deleted by R3-R7; they are kept, split, or moved, so the fixes survive. The real blocker is inability to verify rendered output without credentials. | 2026-07-19 |
| C-02 | `opencode.ai` URLs are a high-risk "must not rename" category because they are live external endpoints and provider attribution. | Overstated. `opencode.ai` appears in **zero** source files; all 12 occurrences are in tests. Source already emits `https://studio.ai/` and `X-Title: studio`. The headers are attribution sent *to third-party gateways* (OpenRouter, NVIDIA, Kilo, LLMGateway, ZenMux), never a dependency on OpenCode's own gateway. The CLI is already independent of it. | 2026-07-19 |
| C-04 | The six `HttpApi` auth failures were a partially-applied `OPENCODE_SERVER_PASSWORD` rename. | Wrong. The source rename was complete and correct. The *tests* still presented `opencode:secret` to a server that had properly become `studio`, so they received honest 401s. The failures were the system working. Fixed by updating the test credentials, not the source. | 2026-07-19 |
| C-05 | Falling total failure counts indicated the rebrand was going well. | Unsafe measure. Totals twice looked stable or improving while the underlying failure *set* churned — 339 to 49 concealed six broken auth tests, and a later 49 to 50 concealed a 14-item patch/revert cluster. Only a name-level subset diff (`comm -13` of sorted-unique baseline vs current) detects regressions. Totals are not a gate. | 2026-07-19 |
| C-03 | Implicit assumption that the CLI test suite was a clean baseline. | Wrong. The suite is already red: source was rebranded but 118 of 460 test files still assert pre-rebrand values. Verified by running `provider-nvidia.test.ts` (1 pass, 3 fail). Any rebrand plan must capture which tests already fail before changing anything. | 2026-07-19 |

The genuine "must not rename" set is narrower and different from C-02: the npm
package names `opencode-gitlab-auth`, `opencode-poe-auth`,
`opencode-openai-codex-auth`, and `opencode-copilot-auth`. The first two are live
imports; all four are real published packages whose names are not ours to change.

## Open Questions

| # | Question | Blocking | Notes |
| --- | --- | --- | --- |
| O-01 | Is `@studio/computer-use` first-party or externally sourced? | R1 final destination | All evidence says first-party: `@studio/` scope, no copyright or attribution anywhere in source, only dependency is the official MCP SDK, bespoke Windows automation, sole author. All five sibling `@studio/*` packages share the same no-license convention. Moving it to `third-party/` would assert external ownership of what appears to be the owner's own IP, and the plan forbids it without verified external provenance. |
| O-02 | Should `features/extensions` be split now or at R5? | Sequencing | The feature currently mixes a cloud connector client (keep) with local MCP lifecycle management (retire). The split is clean but the local half has callers in settings and permissions. |
| O-03 | ~~Re-baseline the lint ratchet, or fix the violations first?~~ **Resolved 2026-07-19** by D-10: re-baselined. Fixing the 38 is now F-03. | Closed | - | - |
| O-04 | Artifact surface ownership: separate page or right-panel surface? | F-05, W3 | Both exist in the tree today. `ArtifactCatalogPage` is routed and live; `ArtifactLabPanel` is dead. |
| O-05 | Studio CLI release pipeline: org, repo, artifact names, container image. | CLI packaging | The pipeline is **already broken independent of the rebrand**. `build.ts` derives artifact names from `pkg.name` (`"studio"`) and emits `dist/studio-darwin-arm64.zip`, while `publish.ts`, `Dockerfile`, and `postinstall.mjs` all consume `opencode-*` names at `github.com/anomalyco/opencode`. Not a consistency nit — it cannot currently run. Per D-22 this is rebuild-not-repair work, but the target names are a product decision. Also covers `vars.OPENCODE_APP_ID` / `secrets.OPENCODE_APP_SECRET`, which can only be renamed alongside the GitHub UI. |

## Completed In This Program

| Slice | Commit | Outcome |
| --- | --- | --- |
| R0: Proven dead code | `d1667e8` | 8 files deleted, 2 unused dependencies removed, unused files 6 to 0. |
| R0.5: Pre-R1 cleanup | `9323125` | 9 npm advisories to 2 with all high-severity resolved, orphaned gitlink removed, knip false positive silenced, stale catalog comment corrected, 5 redundant re-exports dropped. |
| Decision register created | `90d72f5` | This document. |
| R1 Phase A: preserve computer-use | `45df4c0` | Scope proved as exactly 67 files (66 package + 1 skill), matching the ledger's 67 `MIGRATE_TO_CLI_PRESERVE_SOURCE` rows 1:1. Provenance verified first-party. `author` metadata added to all five `@studio/*` packages. SHA-256 manifest recorded and tracked. Copy staged and verified byte-for-byte. Package builds standalone and serves 117 tools over MCP; no tests exist. |
| Licensing + lint re-baseline | `c96cf58` | `UNLICENSED` + `private: true` on all five packages (D-09). Lint ratchet re-baselined per-file at 38 (D-10); `npm run gate` passes end to end for the first time. |
| R2: Studio CLI contract | `3164c97`, `efda1eb` | `06-studio-cli-contract.md`. Contract derived from the CLI's real protocol: 18 groups, typed HTTP API, SSE stream, already rebranded to `@studio-ai/*`. Sessions, approvals, files, terminal fully covered. CLI bridge retired in favour of `serve` + SDK (D-14). |
| Studio CLI rebrand (`temp/opencode`) | `60c443e`..`0487ea5` (14 commits) | Test assertions, ~130 `OPENCODE_*` env vars, config names, docs, and internal identifiers rebranded. Verified by subset diff, not totals (D-21): studio 339 to 36 unique failures, core 39 to 9, tui 13 to 1, **zero effective regressions**. Auth verified live rather than by test: with only the old `OPENCODE_SERVER_PASSWORD` set the server runs unsecured *and says so*, so there is no silently-half-secured state. Fixed a real source bug where `server/src/auth.ts` defaulted the username to `studio` on one line and `opencode` on another. `cli` shard hang root-caused to `test/cli/run/runtime.test.ts` (pre-existing, hangs at 25min too); fixed by splitting the shard. |
| Studio CLI de-OpenCoding (`temp/opencode`) | `54f6392`, `a7ececd`, `e576a41`, `6490fc9` | Applies D-22. Removed upstream community-maintenance automation (issue triage, PR standards, Discord release notifications, contributor stats, compliance windows) and upstream distribution channels (hourly beta publisher, sst deploy, ghcr pushes to anomalyco, nix packaging, VS Code extension publisher, GitHub Action release, docs locale sync), plus the scripts and agents they orphaned. Retained test, typecheck, generate, storybook, publish. Two real breaks fixed in passing: `test.yml` set `OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER` while source reads `STUDIO_*`, so Windows CI never disabled the filewatcher; and `run-workspace-server` wrote `/tmp/opencode-workspace-dev-data.json` while `debug-workspace-plugin.ts` read the `studio-` path, so the dev handshake was broken. Files containing "opencode": 334 to 96. |
| R3 slice 1: run-events extraction | `0a49ff4` | Six display files moved from `src/runtime/ui` to `src/run-events/{components,classify}`. Cloud image helpers split out (D-16). Seven consumers retargeted. Import purity verified: run-events depends only on `@/lib/formatters`, `@/types`, `@/ui`, framer-motion, and react. Gate, build, typecheck, and cycles all pass. |
