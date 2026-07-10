# Frontend Loop Engineer - Folder Taxonomy

Status: First-pass taxonomy recorded on 2026-07-10.

## Classification System

| Category | Current locations | Notes |
|---|---|---|
| A. App Shell | `src/main.tsx`, `src/app/**` | Startup, providers, route gating, shell chrome, global events. |
| B. Feature | `src/features/**` | Domain-owned screens, hooks, services, state, components. |
| C. UI Component | `src/ui/**` | Shared primitives, layout, feedback, overlays, brand, icons. |
| D. Design System | `src/design/**`, `tailwind.config.js`, `src/index.css` | Tokens, typography, global CSS, Tailwind bridge. |
| E. Runtime / Desktop Backend | `src/runtime/**`, `src/core/platform/**`, `src/core/daemon/**`, `src/core/storage/backends/tauri.ts` | Native bridge, local servers, execution, platform services. |
| F. Shared | `src/lib/**`, `src/types/**`, some `src/core/config/**` | Needs finer ownership; currently too broad. |
| G. Error System | `src/core/errors/**`, `src/ui/ErrorBoundary.tsx`, `src/ui/feedback/ErrorDisplay.tsx` | Exists but not consistently consumed. |
| H. Deprecated / Dead / Duplicate | Not proven in first pass | Duplicate patterns exist; no deletion-ready file yet. |

## Existing Public Entrypoints

- `src/runtime/index.ts`
- `src/features/chat/index.ts`
- `src/features/chat/context/index.ts`
- `src/features/settings/index.ts`
- `src/features/workspace/index.ts`
- `src/features/workspace/rightWorkspace/index.ts`
- `src/features/models/index.ts`
- `src/features/models/context/index.ts`
- `src/features/extensions/index.ts`
- `src/features/permissions/index.ts`
- `src/features/markdown/index.ts`
- `src/core/connection/index.ts`
- `src/core/config/constants/index.ts`
- `src/core/daemon/index.ts`
- `src/core/notifications/index.ts`
- `src/core/permissions/index.ts`

## Alias Decision

Keep `@/* -> src/*`. It is already mirrored in `tsconfig.json`,
`vite.config.ts`, and `vite.config.web.ts`.

Preferred imports:

- Cross-folder imports should use `@/...`.
- Same-folder and private sibling imports may use relative paths.
- Feature internals should be imported through feature entrypoints only when
  intentionally public.
- Avoid importing from `@/lib` without first deciding whether the item belongs in
  feature, core, runtime, ui, or shared.

## `src/lib` Reclassification Queue

Current high-use `lib` modules should be classified before moving:

- `api.ts`: likely `shared/api` or `core/network`.
- `tokenManager.ts`: likely `core/auth` or `core/network/auth`.
- `theme.ts`: likely `design` or `app/theme`.
- `formatters.ts`: likely `shared/formatting`.
- `hooks/*`: likely `shared/hooks`.
- `tokenEstimator.ts`: likely `features/chat/context` or `shared/ai`.
- `artifact.ts`: likely `features/artifacts`.
- `chatParser.ts`, `dsmlParser.ts`, `responseParser.ts`: likely chat/runtime
  parser ownership split.
- `projectContextUtils.ts`: likely `features/chat/context` or workspace shared
  context.

Do not move `lib` mechanically; each file has many cross-feature imports.
