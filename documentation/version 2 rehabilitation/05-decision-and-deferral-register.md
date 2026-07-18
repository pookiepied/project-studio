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
| D-04 | Stage the computer-use copy in `temporary/` rather than `third-party/` or `studio-cli/`. | Studio CLI does not exist yet as a stable tree. `third-party/` is wrong on the evidence (see O-01). `temporary/` defers the naming question without asserting false provenance. | 2026-07-19 |
| D-05 | Do not build Studio CLI as part of the rehabilitation program. | Converting the OpenCode clone into Studio CLI is an unbounded product build with no ledger rows and no defined done-state. It would break the slice contract. It runs as its own tracked program. | 2026-07-19 |
| D-06 | Keep the Composio connector UI in the Studio frontend; retire only the local MCP management inside the same feature. | `composioService.ts` already targets the cloud `connectors` worker through `apiManager`, so it is correctly a cloud client. `useMcpServers.ts` in the same feature invokes local `mcp_*` Tauri commands and is the part that retires. See O-02. | 2026-07-19 |
| D-07 | Stage the preserved computer-use copy in `temp/computer-use-migration`, but treat Git history plus the tracked checksum manifest as the real preservation guarantee. | `temp/` is gitignored (`.gitignore:66`), so a copy placed there is not version-controlled and cannot by itself satisfy "preserve intact". The manifest at `artifacts/computer-use-checksums.sha256` is tracked, so any future copy can be proven identical. | 2026-07-19 |
| D-08 | Normalize three minified `package.json` files to standard indentation while adding metadata. | `mcp-management`, `skill-execution`, and `skill-management` were single-line minified; the other two packages were already pretty-printed. Minification in a hand-editable manifest is an artifact, not a style choice. Semantically identical. | 2026-07-19 |

## Deferred Items

| # | Item | Owning phase | Why deferred | Risk if forgotten |
| --- | --- | --- | --- | --- |
| F-01 | Bundle size: main chunk 11.4 MB raw, ~4.3 MB gzipped. | W7 | R3-R7 delete `src/runtime`, the local MCP substrate, the Claude bridge, and several right-panel surfaces. Chunk tuning now would be redone after every removal phase. | Startup performance stays poor. Revisit immediately after R7, before W7 optimization is declared done. |
| F-02 | Static-plus-dynamic import duplication for `unifiedStorageService`, `apiManager`, `errorReporting`. | R3/R4 | These are exactly the modules R3 and R4 re-own. Fixing the import pattern now is discarded work. | Code-splitting stays defeated. Must be re-checked when R3/R4 land, not left to W7. |
| F-03 | 38 lint-ratchet errors (design-system violations) across 8 files. | W6, with a ratchet re-baseline recommended now | All are convention violations, not correctness defects. Fixing changes rendered output and cannot be visually verified without credentials. 22 of 38 are in `WorkspacePage.tsx`, which W3 splits. | The gate stays red for all of R1-R7, so no new lint violation can be detected. This is the highest-cost deferral in the register. See O-03. |
| F-04 | 26 unused exports and 26 unused exported types. | W4 | Each needs per-symbol caller review; no runtime cost because the bundler already drops them; the files move or die in R3-R7. | Low. Purely a report-noise issue. |
| F-05 | `ArtifactLabPanel.tsx` (1,870 lines) has no consumer and is fully dead. | Product decision, then W3 | Artifact surface ownership is undecided: separate catalog page versus right-panel surface. Not a mechanical dead-code removal. | Largest single dead-code item in the tree. Decide before W3 begins. |
| F-06 | `documentation/audit/` G-02 lists restoring `youtube-transcript` into `Backend/Cloud`. | Cloud audit program | D-02 cancelled the feature in Studio, but the cloud remediation binder still plans to restore it. Different program, not touched here. | Cloud work could re-introduce a cancelled feature. Confirm cancellation there. |
| F-07 | Remove the Studio copy of computer-use plus its Tauri resources, `mcp-build.mjs` entry, catalog registration, and source references. | R5 | The package is still live and bundled. Removing it in R1 breaks the desktop build. | This is the step that actually completes R1's intent. R5 must not close without it. |
| F-08 | Package metadata: `license` is absent on all five `@studio/*` packages. | R1 Phase A | A license is a legal declaration; it must come from the product owner, not be invented. | Packages ship without licensing terms. |

## Open Questions

| # | Question | Blocking | Notes |
| --- | --- | --- | --- |
| O-01 | Is `@studio/computer-use` first-party or externally sourced? | R1 final destination | All evidence says first-party: `@studio/` scope, no copyright or attribution anywhere in source, only dependency is the official MCP SDK, bespoke Windows automation, sole author. All five sibling `@studio/*` packages share the same no-license convention. Moving it to `third-party/` would assert external ownership of what appears to be the owner's own IP, and the plan forbids it without verified external provenance. |
| O-02 | Should `features/extensions` be split now or at R5? | Sequencing | The feature currently mixes a cloud connector client (keep) with local MCP lifecycle management (retire). The split is clean but the local half has callers in settings and permissions. |
| O-03 | Re-baseline the lint ratchet at 38 now, or fix the violations first? | Regression detection for R1-R7 | Re-baselining is a one-command, zero-risk change that restores the ability to catch new violations immediately, while leaving the existing 38 to W6. The plan explicitly permits re-baselining with justification. |
| O-04 | Artifact surface ownership: separate page or right-panel surface? | F-05, W3 | Both exist in the tree today. `ArtifactCatalogPage` is routed and live; `ArtifactLabPanel` is dead. |

## Completed In This Program

| Slice | Commit | Outcome |
| --- | --- | --- |
| R0: Proven dead code | `d1667e8` | 8 files deleted, 2 unused dependencies removed, unused files 6 to 0. |
| R0.5: Pre-R1 cleanup | `9323125` | 9 npm advisories to 2 with all high-severity resolved, orphaned gitlink removed, knip false positive silenced, stale catalog comment corrected, 5 redundant re-exports dropped. |
| Decision register created | `90d72f5` | This document. |
| R1 Phase A: preserve computer-use | pending commit | Scope proved as exactly 67 files (66 package + 1 skill), matching the ledger's 67 `MIGRATE_TO_CLI_PRESERVE_SOURCE` rows 1:1. Provenance verified first-party. `author` metadata added to all five `@studio/*` packages. SHA-256 manifest recorded and tracked. Copy staged and verified byte-for-byte. Package builds standalone and serves 117 tools over MCP; no tests exist. |
