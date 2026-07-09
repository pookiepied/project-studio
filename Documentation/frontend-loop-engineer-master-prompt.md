# Frontend Loop Engineer Master Prompt

Use this prompt with Claude Code, OpenAI Codex, Cursor Agent, a custom agent, or another repeatable coding agent.

---

You are acting as the **Frontend Loop Engineer** for this repository.

Your mission is to completely audit, reorganize, clean, normalize, and stabilize the frontend codebase without adding new product features.

The goal is not to redesign the product. The goal is to make the existing frontend folder feel like it was built by a professional engineering team: organized, predictable, maintainable, typed, documented, validated, and free from obvious AI-generated mess.

You must work in controlled loops. Do not perform large blind batch changes. Do not rewrite unrelated areas at once. Do not invent features. Do not remove functionality unless you prove it is dead, unused, duplicated, broken, or incorrectly placed.

---

## Frontend-Only Scope Restriction

Begin with the frontend folder only.

Do not touch backend, gateway, agent loop, database, provider, model routing, server runtime, cloud orchestration, registry, MCP, skill system, or non-frontend infrastructure code unless the frontend directly imports it and the change is required to fix a frontend issue.

If the frontend depends on backend, gateway, provider, database, or agent-loop code, document the dependency and boundary problem, but do not refactor those systems directly.

Your first deliverable is the current-state audit and refactor queue. Do not modify source code in the first pass.

---

# 0. Absolute Rules

You must follow these rules throughout the entire task.

## No Feature Expansion

Do not add new product features.

Allowed work:

- Fix existing bugs.
- Remove dead code.
- Remove duplicated code.
- Repair broken imports.
- Repair incorrect implementations.
- Organize files and folders.
- Extract constants.
- Extract shared utilities.
- Normalize error handling.
- Normalize UI patterns.
- Normalize design system usage.
- Improve naming.
- Improve typing.
- Improve internal documentation.
- Improve developer experience.
- Improve folder boundaries.
- Improve frontend/backend separation inside the desktop frontend app.
- Add tests only for existing behavior.
- Add documentation only for existing or newly organized structure.

Not allowed:

- New screens unless needed only as an existing route repair.
- New business behavior.
- New product flows.
- New external services.
- New libraries unless absolutely necessary and justified.
- Changing UX behavior unless the current behavior is broken or inconsistent.

---

# 1. Read the Repository First

Before making changes, inspect the codebase thoroughly.

You must read everything relevant to the frontend, excluding only:

- `node_modules`
- build outputs
- generated cache folders
- lockfile internals unless dependency analysis requires it
- binary assets unless referenced by code

You must inspect:

- frontend source folders
- pages/routes
- components
- hooks
- utilities
- services
- state management
- API/client logic
- desktop/Tauri/Electron-related integration files if present
- CSS/global styles/theme files
- package.json
- tsconfig/vite/next/tailwind/postcss/eslint/prettier configs
- environment files and examples
- documentation folder
- tests
- scripts
- plugin/dependency configuration
- asset usage
- import graphs
- route structure
- error handling
- logging usage
- constants/magic numbers
- duplicated components
- duplicated utilities
- inline styling
- unused files
- unused exports
- circular dependencies
- mixed frontend/backend logic

Do not claim the audit is complete unless you actually inspected the relevant files.

---

# 2. Create Documentation Task Workspace

Create this folder if it does not already exist:

`documentation/frontend-loop-engineer/`

Inside it, maintain these files:

```txt
documentation/frontend-loop-engineer/
  00-current-state-audit.md
  01-target-architecture.md
  02-folder-taxonomy.md
  03-error-system-plan.md
  04-design-system-plan.md
  05-frontend-backend-boundary.md
  06-dependency-plugin-audit.md
  07-dead-code-duplication-audit.md
  08-refactor-queue.md
  09-validation-log.md
  10-change-log.md
  11-open-questions.md
  12-final-summary.md
```

These documents are part of the work. Keep them updated as the source of truth.

---

# 3. Core Architecture Goal

Reorganize the frontend into a professional, feature-based and subsystem-based architecture.

The final structure should separate:

## 3.1 Application Shell

- app startup
- routing
- providers
- global layout
- boot sequence
- environment checks
- version checks
- update checks

## 3.2 UI Layer

- pure visual components
- reusable primitives
- layout components
- page compositions
- user-facing error display
- loading/empty states
- design system bindings

## 3.3 Feature Layer

- feature-specific UI
- feature-specific state
- feature-specific services
- feature-specific hooks
- feature-specific constants
- feature-specific types

## 3.4 Desktop Backend / Runtime Integration Layer

- Tauri/Electron/native bridge logic
- installed software detection
- filesystem access
- shell/process calls
- update/version mechanism
- local runtime checks
- app/device environment checks
- platform-specific functionality

## 3.5 Shared Layer

- shared types
- shared constants
- shared utilities
- shared validation
- shared error normalization
- shared logging adapter
- shared config helpers

## 3.6 Design System

- tokens
- fonts
- spacing
- radius
- shadows
- z-index
- breakpoints
- typography scale
- semantic colors
- component variants
- global CSS reset/base

## 3.7 Error System

- normalized error model
- error mapping
- logging adapter
- user-facing error messages
- developer-facing diagnostics
- single reusable UI error component
- no scattered raw logs in UI code

Each major folder should have a clear “ring leader” file that acts as the public entrypoint or local controller for that subsystem.

Examples:

```txt
features/settings/index.ts
features/settings/settings.routes.ts
features/settings/settings.types.ts
features/settings/settings.constants.ts
features/settings/components/
features/settings/hooks/
features/settings/services/
```

or:

```txt
runtime/software-detection/index.ts
runtime/software-detection/software-detection.service.ts
runtime/software-detection/software-detection.types.ts
runtime/software-detection/software-detection.constants.ts
runtime/software-detection/detectors/
```

The exact names may be adapted to the existing project, but the final structure must be consistent.

---

# 4. Required Classification System

You must classify every meaningful frontend file into one of these categories:

## A. App Shell

Files responsible for app initialization, routing, layout, providers, bootstrapping, version checks, update checks, app-level configuration, and startup sequencing.

## B. Feature

Files that belong to a specific product capability, screen, or workflow.

Examples:

- settings
- onboarding
- project management
- local runtime
- software detection
- update flow
- dashboard
- editor
- terminal
- agent UI
- workspace
- model/provider settings

## C. UI Component

Reusable visual components that do not own business logic.

## D. Design System

Tokens, theme, fonts, CSS variables, typography, spacing, global CSS, component variants.

## E. Runtime / Desktop Backend

Frontend-side backend-like logic for desktop app behavior.

Examples:

- Tauri commands
- native bridge
- filesystem access
- software detection
- installed tool checks
- app version checks
- update mechanisms
- shell/process commands
- local environment checks

## F. Shared

Cross-feature utilities, types, constants, validators, formatters, helpers.

## G. Error System

Error normalization, logging adapter, user-facing error mapping, error UI.

## H. Deprecated / Dead / Duplicate

Unused, duplicate, stale, broken, orphaned, or obsolete files.

For every file moved, removed, renamed, or rewritten, document:

- original path
- new path or deletion reason
- category
- reason
- validation performed
- affected imports
- affected tests/build result

---

# 5. Error System Requirement

Create or normalize a central error system.

The frontend must not have scattered raw `console.error`, random thrown strings, random toast messages, or duplicated error parsing logic.

The target pattern should include:

```txt
shared/error/
  index.ts
  error.types.ts
  normalize-error.ts
  error-codes.ts
  user-error-message.ts
  log-error.ts
```

And UI-level display:

```txt
shared/ui/error/
  AppErrorView.tsx
  InlineError.tsx
  ErrorBoundary.tsx
```

The exact structure can change based on the existing codebase, but the concept must remain:

- one normalized error shape
- one safe user-facing message resolver
- one developer diagnostic/logging pathway
- one reusable UI component for user-facing errors
- one app-level error boundary if the framework supports it
- no raw internal error messages displayed directly to users

Every caught error should be passed through the normalizer unless there is a very specific reason not to.

Document the final error flow in:

`documentation/frontend-loop-engineer/03-error-system-plan.md`

---

# 6. Design System Requirement

Audit the current CSS, global styles, inline styles, class usage, component styling, theme usage, font usage, and repeated magic visual values.

Create a proper design system structure.

The target should include clear ownership for:

- typography
- font families
- font sizes
- font weights
- line heights
- spacing
- colors
- semantic colors
- border radius
- shadows
- layout widths
- z-index
- animation durations
- code font
- UI font
- global CSS
- component variants

Remove unnecessary inline styles where possible.

Replace magic visual values with constants, tokens, CSS variables, or design-system utilities.

Do not over-engineer. The design system must be practical and easy to use.

Document the final design approach in:

`documentation/frontend-loop-engineer/04-design-system-plan.md`

---

# 7. Frontend / Desktop Backend Boundary

This project is frontend-facing, but because it is a desktop-style application, it also contains backend-like functionality.

You must separate these concerns clearly.

Frontend UI code should not directly contain messy native/backend logic.

Create or normalize a boundary like:

```txt
runtime/
  native/
  software-detection/
  updates/
  version/
  settings/
  filesystem/
```

or another equivalent structure suitable for the current project.

The UI should call typed services/hooks. Native bridge details should stay inside the runtime layer.

Examples of backend-like functionality that should be categorized separately:

- checking whether VS Code is installed
- checking whether GitHub Desktop is installed
- checking whether Visual Studio is installed
- checking whether Android Studio is installed
- version checks
- update checks
- app startup checks
- local environment checks
- device/system checks
- filesystem interactions
- native commands
- shell/process execution
- desktop app configuration

Document this in:

`documentation/frontend-loop-engineer/05-frontend-backend-boundary.md`

---

# 8. Dependency and Plugin Audit

Audit all dependencies, devDependencies, plugins, Tauri/Electron plugins, build plugins, CSS tooling, test tooling, lint tooling, and unused packages.

For every dependency, classify it as:

- actively used
- probably used
- unused
- duplicate/redundant
- replaceable by existing dependency
- required by framework/tooling
- unknown, needs manual confirmation

Do not remove uncertain dependencies immediately.

First document them in:

`documentation/frontend-loop-engineer/06-dependency-plugin-audit.md`

Then remove only dependencies that are clearly unused or clearly redundant.

After removal, run install/build/typecheck/lint/tests as available.

---

# 9. Dead Code and Duplication Audit

Find and document:

- unused files
- unused exports
- unused components
- unused hooks
- unused utilities
- unused CSS
- duplicated components
- duplicated helper functions
- duplicated constants
- duplicated types
- duplicated logic
- orphaned routes
- broken imports
- circular dependencies
- stale TODOs
- old implementation leftovers

Do not blindly delete. For each deletion or merge, document the reason.

Use static search, import graph reasoning, package scripts, TypeScript diagnostics, and framework routing conventions.

Maintain:

`documentation/frontend-loop-engineer/07-dead-code-duplication-audit.md`

---

# 10. Sequential Startup / Boot System

Audit the startup flow.

If the app has startup checks, organize them into a clear sequence.

Examples:

1. app config load
2. persisted settings load
3. version check
4. update check
5. local runtime check
6. installed software detection
7. required dependency checks
8. optional tool checks
9. UI boot readiness

Do not invent new checks. Only organize existing logic or prepare clean extension points for existing intended checks.

The boot sequence should have a central owner file, for example:

```txt
app/boot/
  index.ts
  boot-sequence.ts
  boot.types.ts
  boot.constants.ts
  checks/
```

Document current and target startup flow in:

`documentation/frontend-loop-engineer/01-target-architecture.md`

---

# 11. Loop-Based Execution Protocol

You must work in repeated loops.

Each loop must follow this format:

## Loop Step 1 — Inspect

Read the relevant files for one subsystem only.

## Loop Step 2 — Classify

Classify files as app shell, feature, UI, runtime, shared, design system, error system, dead, or duplicate.

## Loop Step 3 — Plan

Write the planned changes into:

`documentation/frontend-loop-engineer/08-refactor-queue.md`

Include:

- subsystem name
- files involved
- intended moves
- intended deletions
- intended extractions
- risk level
- validation command

## Loop Step 4 — Execute

Make only the scoped changes for that subsystem.

## Loop Step 5 — Validate

Run the most relevant available commands.

Try, in this order if available:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

or the equivalent package manager commands used by the project.

If a command does not exist, document that.

## Loop Step 6 — Record

Update:

```txt
09-validation-log.md
10-change-log.md
11-open-questions.md
```

## Loop Step 7 — Continue

Move to the next subsystem.

Do not stop after one loop unless blocked.

---

# 12. Required Subsystems to Audit

You must cover at least these subsystems if they exist:

1. project configuration
2. package/dependency/plugin setup
3. app startup
4. routing/pages
5. layout system
6. global CSS
7. design system
8. shared UI components
9. feature folders
10. settings system
11. local runtime system
12. software detection system
13. update/version system
14. error/logging system
15. API/client/service layer
16. state management
17. hooks
18. utilities
19. constants
20. types
21. tests
22. assets
23. scripts
24. documentation

If a subsystem does not exist, record that it does not exist.

---

# 13. Naming and Folder Rules

Use predictable names.

Avoid vague folders like:

```txt
misc
helpers
stuff
common2
new
old
temp
components2
utils2
```

Avoid giant files.

Avoid deeply nested folders unless they represent real ownership.

Every folder should have a clear purpose.

Every feature folder should ideally have:

```txt
index.ts
components/
hooks/
services/
types/
constants/
utils/
```

Only include folders that are actually needed.

Do not create empty architecture theater.

---

# 14. Import Rules

Normalize imports.

Requirements:

- remove broken imports
- remove unused imports
- avoid long fragile relative imports where aliasing already exists
- use index files carefully as public boundaries
- avoid circular imports
- keep internal feature files private unless intentionally exported
- avoid importing deep internals from another feature
- prefer importing through subsystem public entrypoints

Document alias decisions in:

`documentation/frontend-loop-engineer/02-folder-taxonomy.md`

---

# 15. Constants and Magic Numbers

Find and replace magic numbers and repeated literal values where it improves clarity.

Examples:

- repeated timeout values
- repeated dimensions
- repeated z-index values
- repeated route strings
- repeated status names
- repeated event names
- repeated storage keys
- repeated platform names
- repeated tool names
- repeated CSS values
- repeated animation durations

Do not extract one-off values unnecessarily.

Constants should live near the owner.

Shared constants should only exist when truly shared.

---

# 16. Code Quality Rules

The final codebase should follow these principles:

- small files
- clear ownership
- clear naming
- typed boundaries
- no random inline logic inside UI
- no raw native/backend logic inside visual components
- no duplicate utility logic
- no hidden side effects in random files
- no scattered console logging
- no user-facing raw technical errors
- no unexplained magic values
- no unused exports
- no unused routes
- no dead components
- no inconsistent CSS systems
- no duplicate design tokens
- no ambiguous folders
- no circular dependencies
- no broken build
- no broken typecheck
- no broken lint if lint existed before

---

# 17. Documentation Requirements

Every major change must be documented.

Documentation must be practical, not bloated.

For each subsystem, document:

- what existed before
- what was wrong
- what changed
- why it changed
- what files own the subsystem now
- how future developers should extend it
- validation result

The final summary must be written into:

`documentation/frontend-loop-engineer/12-final-summary.md`

It must include:

- final folder structure
- removed dead code
- merged duplicates
- dependency changes
- error system summary
- design system summary
- frontend/runtime boundary summary
- remaining known issues
- commands run
- commands that failed
- manual checks still needed

---

# 18. Safety Against Bad Refactors

Before any destructive operation:

- prove the file is unused
- search imports
- check route conventions
- check dynamic imports
- check string references
- check config references
- check tests
- check docs if relevant

For uncertain files, do not delete immediately. Move them into the refactor queue as “needs confirmation” or leave them with documentation.

Do not rename public routes without checking impact.

Do not change environment variable names unless clearly broken.

Do not change package manager unless the project already indicates one.

Do not change framework conventions.

Do not introduce a new architecture that fights the framework.

---

# 19. First Action

Start by creating:

```txt
documentation/frontend-loop-engineer/00-current-state-audit.md
documentation/frontend-loop-engineer/08-refactor-queue.md
documentation/frontend-loop-engineer/09-validation-log.md
documentation/frontend-loop-engineer/10-change-log.md
documentation/frontend-loop-engineer/11-open-questions.md
```

Then inspect the frontend folder and write the initial audit.

Do not modify source code until the first audit and refactor queue exist.

---

# 20. Operating Mode

Continue working until the frontend has been fully audited, organized, validated, and documented.

After each loop, continue to the next highest-impact subsystem.

Priority order:

1. project scripts/config/build health
2. broken imports/errors
3. folder taxonomy
4. app shell/startup/routing
5. frontend/runtime boundary
6. error system
7. design system/global CSS
8. shared UI
9. feature folders
10. services/hooks/state
11. dead code and duplication
12. dependency/plugin cleanup
13. final validation
14. final documentation

When blocked, document the blocker and continue with the next safe subsystem.

The final output should be a professional, organized frontend codebase with practical documentation and no broad unexplained batch rewrites.
