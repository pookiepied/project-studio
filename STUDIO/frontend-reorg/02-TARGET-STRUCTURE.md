# 02 — Target Structure

Based on `Frontend Organise.md` (`app / systems / infrastructure / features /
shared / shell / design`), with two additions this codebase needs: a top-level
**`ai/`** (the two engines) and a **`systems/domain/`** (cloud/local ownership).

```
src/
  app/              Composition root. Bootstrap, routing, global providers, app config.
                    - providers/     global contexts (Auth, Settings, Navigation, Offline, CommandPalette…)
                    - config/        autoMode, tauriConfig, app-level constants
                    - routing / App bootstrap

  ai/               The AI engines. UI engine-selector maps 1:1 to this folder.
                    - studio/        the portable agent-loop core (our brain).
                                     Runtime-agnostic: identical code runs in the
                                     cloud Worker AND in-process in the desktop app.
                    - claude-code/   the existing CLI bridge, relocated AS-IS
                                     (wrapper over the user's Claude Code CLI).
                                     No logic changes — relocation only.
                    - engine types / selector logic shared by both

  systems/          Cross-cutting APP BEHAVIOR (not adapters). Pure-ish logic.
                    - errors/        errorService + friends
                    - logging/       logger
                    - notifications/
                    - permissions/   the 9-file permission engine (grants, scope, toolRisk)
                    - domain/        cloud vs local ownership, capability-per-domain,
                                     the explicit handoff policy

  infrastructure/   OUTWARD SEAMS / adapters — how the app talks to the world.
                    - gateway/       thin client to the gateway worker (NO provider logic)
                    - api/           client to our API + the MCP/agents/skills registries
                    - mcp/           MCP invocation contract
                    - storage/       local persistence (conversations DB, etc.)
                    - platform/      studioPaths + OS/Tauri platform glue (already started here)
                    - files/         file attachment/handling
                    - network/       connection/transport
                    - auth/
                    - local/         local-capability detection, local MCP wiring (daemon REMOVED)
                    - skills/        bundled-skill deployment (app-bootstrap infra)

  features/         Product surfaces (already mostly organized in Phase 4). Each is
                    self-contained {components, context, hooks, tools}:
                    chat, voice, transcription, artifacts, activity, memories,
                    extensions, models, settings, workspace, markdown, …

  shared/           Multi-feature reusables (D-407: multi-consumer ⇒ shared).
                    - ui/            design-system primitives (Button, IconButton, Icon…)
                    - layout/        layout components
                    - hooks/         cross-feature hooks (useChatScroll, useTerminalPanel…)
                    - utils/         JSX-FREE utilities only
                    - types/
                    - constants/

  shell/            Window chrome / app frame: TitleBar, overlays, FloatingIsland.

  design/           tokens.css, typography.css, fonts. Pure, structure-neutral.
```

## Ownership rules (how to decide where a file goes)

- **Is it an engine?** → `ai/`.
- **Is it cross-cutting behavior the app runs (errors, logging, perms, domain
  routing)?** → `systems/`.
- **Is it a seam to something external (gateway, API/registries, MCP, storage,
  OS, network, auth)?** → `infrastructure/`.
- **Is it a product surface a user opens?** → `features/`.
- **Is it consumed by ≥2 features and framework-generic?** → `shared/`.
- **Is it window chrome?** → `shell/`.
- **Is it a token / global style?** → `design/`.
- **Is it bootstrap/composition/routing/providers?** → `app/`.

## Non-negotiables carried from the revamp

- **D-401 strict-neutral** palette holds (see `04-DECISIONS-AND-CARVEOUTS.md`).
- **`utils/` stays JSX-free** (§6 rule).
- **Barrels: complete or delete** — no partial `index.ts`.
- **Dual-build gate**: `npm run build` (desktop) + `npm run web:build` (web) both
  green at every step.
