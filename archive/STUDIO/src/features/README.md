# `features/` — feature-based architecture

Everything for a single product feature lives together in `features/<feature>/`, instead of being
spread across `pages/`, `components/`, `hooks/`, `contexts/`, `services/`. This is the target
architecture for the STUDIO frontend refactor.

See **STUDIO/frontend-revamp/02-PLAN.md** for the full plan, and
**STUDIO/frontend-revamp/01-AUDIT.md** for the audit it's based on.

## Per-feature structure

A feature folder uses only the subfolders it actually needs:

```
features/<feature>/
  components/      # feature-only React components
  hooks/           # feature-only hooks
  services/        # feature-only business logic (no JSX)
  context/         # feature-scoped React context/provider
  <Feature>Page.tsx  # the routed entry, if the feature owns a page
  types.ts         # feature-local types
  constants.ts     # feature-local constants
  index.ts         # public surface — other features import ONLY from here
```

## Rules

- **Cross-feature imports go through the feature's `index.ts` barrel only.** Never reach into
  another feature's internals.
- **Shared / generic UI** (used by 2+ features, no product logic) does NOT live here — it goes in
  `src/components/{ui,layout,feedback,overlays,brand,icons}`.
- **Global app state** (auth, settings, navigation, offline, command palette) stays in
  `src/contexts/`. Feature-scoped state lives in `features/<feature>/context/`.
- **Cross-cutting infra** (network, storage, errors, logging, platform, notifications, auth) stays
  in `src/services/`. Feature business logic lives in `features/<feature>/services/`.
- Use the `@/` path alias for imports (e.g. `@/ui/primitives/Button`).

## Planned features (created on migration — Phase 4)

`chat` · `workspace` · `voice` · `transcription` · `computerUse` · `models` · `settings` ·
`manage` · `activity` · `extensions` · `memories` · `artifacts` · `markdown`

Folders are created when a feature is migrated, not ahead of time — so empty placeholder
directories don't accumulate.
