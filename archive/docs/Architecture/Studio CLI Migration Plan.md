# Studio CLI Migration Plan

## Purpose

Turn the opencode CLI (`packages/opencode`, the "heavy" production binary) into an independent, fully-branded **Studio CLI** that talks to Studio Cloud instead of opencode's provider/gateway system. The TUI is kept; opencode's web/desktop/console/analytics apps are not.

This is a **large product fork**, not a rewrite and not a light reskin. The opencode codebase is well-architected for this: the TUI is decoupled from business logic, the provider abstraction admits a Studio gateway additively, the agent seams (per-agent model, system-context algebra, compaction) already exist, and all the packages we need to delete have zero source imports from the CLI. Everything is MIT/Apache-2.0, so rebranding + redistribution is legally clear.

Source for this analysis: `temp/opencode` (a clone of the `github.com/anomalyco/opencode` fork). File:line references below point into that tree.

---

## 1. Scope: keep vs remove

Studio CLI = the `packages/opencode` binary + the small set of workspace packages it imports. Confirmed by grepping `packages/opencode/src` for imports of every other workspace package — only the "keep" set is referenced at runtime.

### Keep (11 packages)

| Package | Why |
|---|---|
| `packages/opencode` | The CLI itself: 24 commands, session core, tools, agent runtime, system prompt, TUI launch glue |
| `packages/tui` | Terminal UI (`@opentui/solid`) |
| `packages/core` | Domain runtime: DB, providers, sessions, pty, fs, OTEL — imported (leaf utils) by tui |
| `packages/server` | In-process HTTP API the TUI talks to |
| `packages/sdk` | HTTP client `createOpencodeClient` used by TUI |
| `packages/llm` | LLM streaming/protocols (used by `opencode`) |
| `packages/codemode` | Code-rewrite tool (used by `tool/code-mode.ts`) |
| `packages/plugin` | TUI plugin contracts |
| `packages/protocol`, `packages/schema` | Wire contracts (transitive) |
| `packages/script` | Build helper (tiny) |

The CLI runs the server in-process via a Web Worker (`packages/opencode/src/cli/tui/worker.ts`); no external HTTP port is required. `--skip-embed-web-ui` on the build script removes the only dependency on `packages/app`.

### Remove (17 packages — zero source imports from `packages/opencode/src`)

`packages/app`, `web`, `desktop`, `console`, `stats`, `storybook`, `slack`, `enterprise`, `containers`, `http-recorder`, `httpapi-codegen`, `function`, `docs`, `session-ui`, `client`, `sdk-next`, and `sdks/vscode`. Also drop root-level `sst.config.ts`, `infra/`, `nix/`, `flake.nix`, `packages/identity` (brand assets), and the `sso` root script.

### Configurable removals (decide per item)

- `agree`/`github` command, `opencode.github install`, control-plane workspaces — OpenCode-cloud-only, redirect or delete.
- `opencode share` / `opencode web` commands — depend on the embedded web-UI bundle. Delete (no Studio web share) or rebuild later.
- The `console login`, `providers login`, `models.dev` refresh, `stats` local command — review in Phase 3.

---

## 2. Approach: reduced fork, not physical extraction

**Decision:** maintain a reduced fork. Delete the removable packages; keep the original package boundaries. Rationale:

- Physical extraction (restructuring into a new repo layout) gains nothing at runtime and makes future upstream rebases far harder.
- The original package boundaries are clean — preserving them minimizes merge conflict surface.
- The CLI runtime closure is already small (≈11 packages); the "drag" is only `core` (heavy because it bundles ~25 `@ai-sdk/*`), which we need anyway.

**Repo plan:** start from `temp/opencode`, delete the 17 removable packages + infra, commit as the Studio CLI fork. Keep the `dev` branch upstream reference for periodic rebase/cherry-pick.

---

## 3. Phase 1 — Reduced fork + centralized rebrand

**Goal:** a building, runnable CLI named "Studio CLI" with the opencode cloud/update plumbing redirected to Studio. No visual changes yet.

### 3.1 Delete removable packages
Delete the 17 packages + `sst.config.ts`, `infra/`, `nix/`, `packages/identity`, `packages/storybook`, `packages/docs`. Update root `package.json` workspaces globs (currently `packages/*`, `packages/console/*`, `packages/stats/*`, `packages/sdk/js`, `packages/slack`). Set `--skip-embed-web-ui` as the build default.

### 3.2 Brand identifier centralization (the ~10 high-value edits)

| What | Where | Edit |
|---|---|---|
| System config/data/cache dir name | `packages/core/src/global.ts:10` `const app = "opencode"` | → `"studio"` (single source for `~/.config/opencode` etc.) |
| Package + binary name | `packages/opencode/package.json:4` (`name`), `:18` (`bin.opencode`); `packages/core/package.json:15-16` | rename to `studio` / `@studio-ai/cli` scope |
| yargs scriptName + prefix check | `packages/opencode/src/index.ts:47` (`.scriptName("opencode")`), `:37` | `studio` |
| Update/install endpoint + User-Agent + plist domain | `packages/opencode/src/installation/index.ts:41-45,127-147,175-186`; `packages/opencode/src/config/managed.ts:8` (`ai.opencode.managed`); root `install` script | point at Studio `api/…/updates/manifest` (already exists in parent); User-Agent `studio/…`; plist `ai.studio.managed`; remove brew/scoop/choco `opencode` refs |
| GitHub repo URL | `package.json:121` | `github.com/pookiepied/studio` (or your org) |
| Root package name + sso script | `package.json:3,21` | `studio`; drop `sso` |
| Workspace scope rename `@opencode-ai/*` | 35 `package.json` files + import sites | `@studio-ai/*` (mechanical; see §6 risk) |
| ASCII logo | `packages/tui/src/logo.ts`, `packages/opencode/src/cli/ui.ts` | new Studio mark (Phase 2 visual) |
| Build-time define | `packages/cli/script/build.ts:91` (`OPENCODE_CLI_NAME:'lildax'`) + `packages/opencode/script/build.ts` | `STUDIO_CLI_NAME:'studio'` |

### 3.3 Semantic coupling (decide deliberately — DO NOT blind-sed)

- **`.opencode/` project dir** — hard-coded in ~15 sites (`config/paths.ts:29,35`, `plugin/install.ts:337`, `skill/discovery.ts:80,105`, `cli/cmd/mcp.ts:399`, `uninstall.ts:218,269,300`, `installation/index.ts:175`, `agent/agent.ts:173`, `session/session.ts:333`, `plugin/tui/runtime.ts:256,258,817`, `config/tui.ts:203,206`). Decision options: rename to `.studio/` + migrate-on-read; or keep `.opencode/` (less disruptive). **Recommend rename to `.studio/`** with a one-time silent copy shim.
- **`OPENCODE_*` env vars** — ~50 names defined in `packages/core/src/flag/flag.ts:8-76` but inlined as `process.env["OPENCODE_…"]` across ~200+ sites. **Decision: keep env-var names** for now (renaming breaks every user's shell/CI). Optionally add `STUDIO_*` aliases that take precedence. Revisit in a later major version.
- **OpenCode service tags** — `Context.Service<…>()("@opencode/Installation")` etc. in ~12 sites. Internal only. Optional cosmetic rename; low priority.
- **Third-party deps** `opencode-gitlab-auth`, `opencode-poe-auth` (`package.json:82,135-136`) — external npm packages, can't rename. Drop if unused after gateway replacement; keep dependency name as-is otherwise.

### 3.4 Verification gate (Phase 1 done when)
- `bun run --cwd packages/opencode --conditions=browser src/index.ts` launches an in-process server + TUI under the name `studio`.
- `studio --help` shows no `opencode` strings in user-visible output except inside `LICENSE` attribution.
- `studio upgrade` queries the Studio update manifest URL (parent `api/…/updates/manifest`), not `opencode.ai/install`.
- All 17 removable packages deleted; workspace install (`bun install`) succeeds.

---

## 4. Phase 2 — TUI visual redesign

**Goal:** Studio CLI looks and feels like its own product. This phase is **mostly visual** (low architectural risk) because theming is centralized and components are reusable (`packages/tui/src/theme/index.ts` has the only `Theme` interface; `packages/tui/src/component/` holds 34 reusable components; presentation never touches domain logic).

### 4.1 How much to redesign — by surface

| Surface | Current | Effort | What to change |
|---|---|---|---|
| Default theme (`theme/assets/opencode.json`) | primary `#fab283` (peach), accent `#9d7cd8` (purple), 12-step grayscale ramp | Low | Replace with Studio palette. Keep the JSON schema/token names (`primary/secondary/accent/error/warning/success/text/background*` + diff + markdown + syntax) — only swap the hex values. ~50 token keys. |
| Built-in themes catalog | 33 themes (`aura, ayu, catppuccin, dracula, gruvbox, nord, … opencode, vercel, zenburn`) | Low | Remove `opencode.json`; add `studio.json`; optionally prune the catalog to a Studio-curated 6–8 set. Auto-derive `system` theme from terminal ANSI palette already exists (`theme/index.ts:360-469`) — keep. |
| Logo (`packages/tui/src/logo.ts`) | ASCII block spelling "OPENCODE" + separate "GO" mark | Low–Med | New ASCII/SVG-raster mark for Studio. Keep the `{left, right, marks}` shape so `component/logo.tsx` consumes unchanged. |
| Terminal title | `"OpenCode"` literal in `app.tsx:457,464,469` | Trivial | `Studio` |
| Spinner / loading indicator (`ui/spinner.ts`, `component/spinner.tsx`) | Knight Rider-style scanner: bidirectional sweep, hold frames, alpha-decay trail, blocks/diamonds glyphs | Low | Recolor (swap the default red trail for Studio palette), optionally change glyph set (`⬥◆⬩⬪` / `■⬝`), tune trail length + hold-frame timing. The `ColorGenerator` API stays; only `createFrames`/`createColors` defaults change. |
| Empty states / tips (`feature-plugins/home/tips-view.tsx`) | ~15 tip strings referencing `opencode.json`, `.opencode/commands`, `https://opencode.ai`, `OpenCode Zen`, `ghcr.io/anomalyco/opencode` | Med | Rewrite all tips copy for Studio paths/commands/services. Pure text, no logic. |
| Provider dialog (`component/dialog-provider.tsx`) | OpenCode Zen/Go marketing copy, `https://opencode.ai/zen|go`, `__opencode_custom_provider__`, `opencode: "(Recommended)"`, `opencode-go` tier | Med | Replace with Studio Cloud Gateway provider description. The provider-dialog structure stays; the copy + provider id changes. |
| Permission prompts (`routes/session/permission.tsx:144,148,486`) | "until OpenCode is restarted", "Tell OpenCode what to do differently" | Trivial | Brand rename. |
| Footer (`feature-plugins/sidebar/footer.tsx:56`) | "OpenCode includes free models so you can start immediately." | Trivial | Studio copy. |
| Tips + commands referencing `opencode …` | ~13 strings in `tips-view.tsx:220-278` | Med | Point at Studio commands (`studio run`, `studio serve`, `studio agent create`) + `.studio/` dirs; remove `docker … anomalyco/opencode`. |
| Sound pack id | `config/index.tsx:107` `opencode.default` | Trivial | `studio.default` (or keep id; it's an internal name). |
| Keymap mode id | `keymap.tsx:24` `opencode.mode`; `app.tsx:121-122` `opencode.status`/`opencode.debug` command ids | Low | Rename command ids to `studio.*`. Mechanical. |
| Markdown/syntax rendering (`theme/index.ts:556-1088`) | tree-sitter styles per filetype | None | Keep as-is — derived from theme palette automatically. |
| Layout / interaction | SolidJS provider stack in `app.tsx:247-352`; `<Home>` + `<Session>` routes | Optional | Incremental redesign is feasible (swap routes/components one at a time). A full layout rethink is the only thing that approaches a rewrite of the render layer; defer until brand+color is settled. |

### 4.2 Animation policy
All animation lives in `packages/tui/src/ui/spinner.ts` (`createFrames`, `createColors`, `deriveTrailColors`, `deriveInactiveColor`) and `component/spinner.tsx`. To change how animations show up:

- **Speed:** tune `holdStart`/`holdEnd` defaults (`spinner.ts:275-276`: 30/9) and trail-step count (`trailSteps`).
- **Shape:** swap glyph set in `createFrames` (`spinner.ts:313-325`) — blocks `■⬝`, diamonds `⬥◆⬩⬪`, or custom.
- **Color flow:** replace the default red-trail array (`spinner.ts:283-289`) with a `Studio` palette derived via `deriveTrailColors(theme.primary, 6)`.
- **Direction/fade:** `direction: "bidirectional"`, `enableFading`, `minAlpha` are exposed on `KnightRiderOptions`.

No animation framework rewrite needed — these are config knobs on an existing, parametric generator. If you want an entirely different motion language (e.g., a pulsing dot, a progress bar, or a typed-text effect), that's a new `ColorGenerator`/component — moderate effort, isolated to `ui/` + `component/`.

### 4.3 Phase 2 verification gate
- `studio` launches with Studio palette, Studio mark, `Studio` terminal title, no `OpenCode`/`opencode.ai` strings anywhere in the TUI surface (grep `packages/tui/src` for `OpenCode|opencode.ai` → should only match `LICENSE` attribution).
- Default theme is `studio.json`; spinner uses Studio palette.
- All command/keymap ids are `studio.*`.

---

## 5. Phase 3 — Gateway replacement + Studio auth/services

**Goal:** all model traffic routes through Studio Cloud Gateway; Studio JWT auth; update + analytics go through Studio services. This phase contains the deepest architectural changes.

### 5.1 Approach: additive provider, not rip-out
The gateway concept already exists: `packages/core/src/plugin/provider/{gateway,llmgateway,cloudflare-ai-gateway}.ts`. The managed-console analog `opencode.ts` (`server = console.opencode.ai`, remote-provisions provider+catalog from `/api/config`) is the closest existing template for "configure everything from a cloud gateway."

**Do NOT rip out the multi-provider abstraction.** Additive approach (lowest risk, recommended):
1. Register `studio-gateway` as a new provider entry — mirror `llmgateway.ts` or the `opencode` managed provider. `baseURL` → Studio Gateway (`Backend/Cloud/gateways/gateway` / parent `api/` OpenAI-compatible adapter). The default AI-SDK `streamText` path (`packages/opencode/src/session/llm.ts:280-354`) then routes transparently through the gateway.
2. **Hide** the user-facing provider-management UI (`opencode providers`/`auth` commands, `component/dialog-provider.tsx`, `feature-plugins/home/tips.tsx:44` `item.id !== "opencode"` filter) behind a flag — don't delete the abstraction, just gate it.
3. Default the active model + catalog to the Studio-remote-provisioned set (mirror `opencode.ts:190-212 fetchProviders` against a Studio endpoint).

**Alternative (narrowest transport seam):** implement `LLMClient` against `RequestExecutor` at `packages/llm/src/route/client.ts:417-426` (the Layer depends only on `RequestExecutor.Service`). Enable with `OPENCODE_EXPERIMENTAL_NATIVE_LLM=true` after extending the gate currently restricted to openai/anthropic/opencode (`session/llm/native-runtime.ts:46-65`). Keeps the `LLM.stream`/`LLMClient.stream` interface intact. Use this if the Studio Gateway protocol is not OpenAI-compatible.

### 5.2 System-prompt variant coupling
Prompt selection is keyed on model-id substrings (`session/system.ts:27-42`: `gpt-4/o1/o3`→BEAST, `claude`→ANTHROPIC, `gemini`→GEMINI, etc.). A Studio Gateway exposing its own model IDs falls through to `default.txt`. Fix: either add a `studio` branch, or coerce Studio model IDs to keep the substring contracts.

### 5.3 Auth → Studio JWT
Parent Studio already has `auth/` (Google OAuth → JWT) and `api/` (JWT-verified API gateway). Redirect the CLI's `auth.json` credential store (`packages/opencode/src/auth/index.ts`, reads `~/.local/share/opencode/auth.json`) to store the Studio JWT and inject it as the `Authorization` header on every Studio client call. Drop `@openauthjs/openauth` (console-only).

### 5.4 Studio services integration (unified client)
One authenticated Studio SDK client inside the CLI (mirroring `createOpencodeClient` in `packages/sdk/v2`) fronting the parent `api/` gateway — not per-Worker clients. Map each cloud capability onto opencode's existing extension points:

| Studio service | CLI integration point |
|---|---|
| Memory / context-engine | `SystemContext.Source` producer (`packages/core/src/system-context/`, mirroring `builtins.ts:24-42`) — the provider-agnostic, Session-owned extension point |
| Connectors / MCP library | `@/mcp` (`registry.ts:54`, `mcp.tools()`/`mcp.instructions`) |
| Native tools / tool-execution / tool-pool | `Tool.define(...)` + `tool/registry.ts:204-247` entry, or `{tool,tools}/*.{js,ts}` config dir |
| Image / video generation | New `Tool.define` native tools, cloud-executed |
| Agent library / planner | Per-agent config (`agent.ts:35-55`) loaded from Studio backend |
| User account / workspace | Replace `account/account.ts` console login with Studio JWT issuance |
| Tracker (analytics) | Replace OTEL exporter (`core/src/observability/otlp.ts`) with Studio tracker worker, or remove entirely |

Offline behavior: local-only tools (file/shell/grep/edit/read) keep working; cloud tools degrade to "unavailable while offline" with the existing permission/error surface. Cache auth JWT with refresh-on-launch like `auth.json` does today.

### 5.5 Telemetry removal
No product analytics SDK exists (posthog appears only in MCP test fixtures; Sentry is build-time sourcemap-only and already `telemetry:false`). The only runtime observability is **opt-in** OpenTelemetry (`core/src/observability/otlp.ts:57-61`, guarded by `cfg.experimental?.openTelemetry`). Either repoint to Studio tracker worker or remove the OTEL wiring entirely. The `opencode stats` command is purely local SQLite aggregation — keep (and rename `studio stats`) or remove depending on product fit.

### 5.6 Phase 3 verification gate
- No request leaves the CLI to `*.opencode.ai`; all model/auth/update traffic targets Studio endpoints.
- `studio` launches authed via Studio JWT; `studio providers` is hidden or shows only Studio.
- Studio Cloud Gateway is the default (and only promoted) provider; `llm.stream` call site (`processor.ts:640`) unchanged upstream structure.
- Cloud capabilities (memory, connectors, image gen) are invokable as tools/context sources through the Studio client.

---

## 6. Phase 4 — Agent runtime + sub-agent model routing + token optimization

### 6.1 System prompt rewrite/compact
Built-ins in `packages/opencode/src/session/prompt/*.txt` (`default.txt` 95 lines, starts "You are opencode…"; plus `beast, trinity, gemini, gpt, anthropic, codex, kimi, meta, plan, plan-mode, copilot-gpt-5, build-switch`). Assembly in `session/prompt.ts:1257-1271`; plugin hook `experimental.chat.system.transform` (`agent.ts:381`) lets you mutate the assembled array without touching core. Compact = edit prompt files + record per-agent context sources → small effort.

### 6.2 Per-agent model routing (mostly already built)
- `Agent.Info.model` override exists (`agent.ts:45-50`, applied `:281`); consumed in `task.ts:167-170` (`next.model ?? parentMsgModel`).
- `getSmallModel()` already implemented (`provider.ts:1871-1938`): family priority `gemini-flash/gpt-nano/claude-haiku`, `cfg.small_model`, `experimental.provider.small_model` plugin hook.
- **For policy routing** (main=reasoning, sub-agents=cheap): set `model` on built-in sub-agents `general`/`explore` (`agent.ts:182-218`), OR one-line edit `task.ts:167` → fall back through `getSmallModel`. Optionally add a `modelPolicy: "reasoning"|"small"|"inherit"` field. Crosses no session-core boundary.

### 6.3 Token optimization (the "Ponytail" layer)
OpenCode already has: compaction (`session/compaction.ts` `prune()` `:243` + `process()` `:289-511` summarizes), overflow gating (`overflow.ts`), instruction attachment/dedup (`instruction.ts:179-221`), tool-output truncation (`tool/truncate.ts`).

**Clean insertion point for an additional optimization layer:** `packages/core/src/system-context/index.ts` — the `Source<A>` algebra (`make`, `combine`, `initialize`, `reconcile`, `replace`, durable `Snapshot`). AGENTS.md mandates extensions stay here, provider-agnostic, Session-owned. Register lazy-loading context sources mirroring `builtins.ts:24-42`. No provider/session change.

⚠ **"Ponytail" and "Graphyfy" do not appear anywhere in the repo** (grep = no files found). Treat them as external systems per description; verify the exact upstream projects before committing to them by name.

### 6.4 Phase 4 verification gate
- System prompt is Studio-branded, compact, and lazy-loads context via `SystemContext.Source`.
- Sub-agents use configured cheap models without main-session model drift.
- Token usage per session measurably lower against a benchmark prompt set.

---

## 7. Phase 5 — Graph-based code intelligence + Studio-native tools

Not present in opencode. Integration seams already exist:
- **Graph context** → register a `SystemContext.Source` backed by a graph index (`system-context/index.ts`), surfaced via the Session-owned epoch. The graph itself is built by a Studio cloud worker feeding the CLI source, OR a local indexer.
- **Graph-aware tools** (`find_symbol`, `impact_analysis`, `call_path`, `callers_of`) → `Tool.define(...)` + `tool/registry.ts:204` entry. Phased start with read-only queries; persistence against project-level state later.
- **Native Studio tools** (image gen, video gen, connectors) → `Tool.define` + registry, cloud-executed through the Phase 3 Studio client.

Largest unknown is building/indexing the graph, not the CLI plumbing.

---

## 8. Visual vs deep-architectural changes

| Mostly visual (low arch risk) | Deep architectural (cross-cutting) |
|---|---|
| Theme palette + catalog | Provider/gateway routing (`processor.ts:640`, `llm.ts:95-103`, `provider.ts:1666-1857`) |
| Logo, terminal title, spinner colors/glyphs | Prompt-variant model-id coupling (`system.ts:27-42`) |
| Tips/empty states/footer/permission copy | `OPENCODE_*` env-var + `.opencode/` dir semantic coupling |
| Command/keymap id renames | Studio SDK + auth layer (new code, not a swap) |
| `SystemContext.Source` producers (token opt, graph) — additive | Replacing `installation/index.ts` update endpoint + User-Agent |
| New native tools (additive via `Tool.define`) | Provider-management UI gating + `models.dev` refresh removal |

Rule of thumb: if it touches `tool/registry.ts`, `system-context/index.ts`, or `tool/task.ts` model resolution → additive, low risk. If it touches `session/llm.ts`, `provider/provider.ts` core, or `session/system.ts` prompt selection → plan carefully, keep upstream structure.

---

## 9. Phase ordering & effort

| Phase | Effort | When |
|---|---|---|
| 1. Reduced fork + central rebrand | Medium (mostly mechanical, ~10 edits + 17 deletions + scope rename) | Now |
| 2. TUI visual redesign | Low–Medium (centralized theme; isolated animate/config knobs) | After 1 |
| 3. Gateway replacement + Studio auth/services | Medium–High (deepest arch change; additive strongly preferred) | After 2 |
| 4. Agent runtime + sub-agent routing + token opt | Low per item (seams exist) | After 3 |
| 5. Graph code intel + Studio-native tools | Medium (build the graph infra; CLI plug-in is low) | After 4, ongoing |

Recommended Phase 1 deliverable before any major rewriting: a building `studio` binary that launches the TUI, branded, with opencode cloud/update plumbing redirected — no functional behavior changes yet. This proves the fork is stable and unblocks every later phase.

---

## 10. Maintenance discipline & rewrite threshold

- **Keep a Studio change-log** of every touched upstream file. Prefer additive changes (plugins, `SystemContext.Source`, `Tool.define`) over edits inside shared files — these cherry-pick cleanly from upstream `dev`.
- **Periodic rebase** onto upstream `dev`; selective cherry-pick when a conflict touches a Studio-customized file (`provider.ts`, `system.ts`, `agent.ts`, prompt txts, `global.ts`).
- **Rewrite threshold:** if Studio-specific provider/auth/model-routing/prompt/context logic collectively exceeds ~30–40% of `core`+`opencode`, or rebasing becomes a weekly conflict grind, a clean-room CLI reusing only `tui` + `sdk` + `@opentui/solid` becomes cheaper than perpetual rebasing. We are far below that today.

---

## 11. Licensing

Root `LICENSE` = MIT "Copyright (c) 2025 opencode". All 35 workspace `package.json` declare `license: MIT`. 14 patchedDeps are functional-only (photon-node is Apache-2.0, patch is Bun/WASM bindgen fix — redistributable, keep NOTICE). No GPL/AGPL/SSPL anywhere.

Legally clear to: fork, rename/rebrand, modify, redistribute (incl. compiled binaries), sell services, remove original branding — provided MIT copyright + permission text is retained in substantial portions (invisible in compiled binary). Must also retain the photon-node Apache-2.0 NOTICE.

---

## Open decisions (need your call before Phase 2 starts)

1. **`.opencode/` project dir** → rename to `.studio/` with migrate-on-read shim, or keep as `.opencode/`? (recommend rename)
2. **`OPENCODE_*` env vars** → keep names + add `STUDIO_*` aliases, or hard-rename in a major version? (recommend keep + alias)
3. **Package scope** → `@studio-ai/*` (recommend), `@studiocli/*`, or other?
4. **Binary name** → `studio` (recommend), `studio-cli`, or other? (also affects `studio.ts` exports)
5. **Default theme palette** → you pick the Studio primary/accent; I'll generate the rest of the ramp. Current opencode palette is peach `#fab283` + purple `#9d7cd8`.
6. **Provider-management UI** → fully hidden behind a flag, or removed (commands deleted)? (recommend hidden — keeps multi-provider for power users/debugging)
7. **`opencode share`/`web` commands** → delete now, or keep behind `--skip-embed-web-ui` for later rebuild? (recommend delete)
8. **Spinner redesign** → keep Knight Rider motion recolored, or entirely new motion language? (recommend recolor first; new motion later)
