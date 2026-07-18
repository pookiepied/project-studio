# Version 2 Rehabilitation: Target Structure Audit

Evidence pass: 2026-07-18
Scope: Independent target-structure proposal for Studio after the V2 removal
audit. This document intentionally does not edit source files. It describes the
shape we should verify and then implement in small slices.

## Product Boundary

Studio should be organized around three product surfaces:

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

Desktop should not keep a second local agent runtime that competes with Studio
CLI. Cloud execution remains cloud-owned. Local execution becomes Studio
CLI-owned.

## Naming Rule

Avoid folder names that describe importance instead of responsibility.

Prefer:

- `app-shell`
- `cloud`
- `studio-cli`
- `workspace`
- `chat`
- `review`
- `settings`
- `auth`
- `design-system`
- `platform`
- `storage`
- `commands`

Avoid vague names for large areas:

- `core` when the module is actually auth, platform, storage, network, or
  permissions.
- `runtime` inside Desktop when the real runtime authority is either Studio
  Cloud or Studio CLI.
- `library` inside `src` when it is not a shared leaf utility.
- `ui` as a dumping ground for unrelated visual pieces.

## Proposed Repository-Level Shape

This is the target mental model, not a patch plan.

```text
Project Studio/
  api/                         public API / auth-facing server project
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
  STUDIO/
    src/                       Desktop/Web React application source
    src-tauri/                 native desktop shell and OS bridge
    web/                       web entry/distribution shell
    public/                    shared static app assets
    scripts/                   build, package, vendor, proof utilities
    vendor/                    packaged external binaries/resources
    library/                   temporary bundled capability source until V2 removal
    docs/                      Studio-specific rehabilitation notes
  documentation/
    version 2 rehabilitation/  V2 planning and audit trail
  temp/opencode/               external reference/fork workspace for Studio CLI
```

Backend Cloud should not be physically folded into `STUDIO/`. Studio Desktop can
consume cloud contracts, but the cloud workers remain backend products.

Studio CLI should also not be folded into `STUDIO/src`. If it remains based on
OpenCode, it should live as an adjacent product/package or external workspace,
then Desktop integrates through a defined CLI protocol.

## Proposed `STUDIO/src` Shape

Current `STUDIO/src` has `app`, `cliBridges`, `core`, `design`, `features`,
`lib`, `runtime`, `types`, and `ui`. V2 should move toward this responsibility
model:

```text
src/
  app/
    entry/                     React entry helpers and app bootstrap
    routes/                    route-level composition
    shell/                     window/shell chrome, navigation, layout, topbar
    providers/                 app-level provider composition and lifetimes

  platform/
    tauri/                     invoke wrappers and native capability detection
    windows/                   overlay/conversation/native window orchestration
    storage/                   app storage abstractions
    network/                   API manager and cloud endpoint clients
    updates/                   updater and release metadata

  cloud/
    chat/                      cloud conversation/run client
    workspace/                 cloud workspace/data client
    tools/                     cloud tool/event descriptors
    models/                    model registry client/snapshot handling
    connectors/                connector-facing client UI adapters

  studio-cli/
    client/                    headless CLI process/protocol client
    sessions/                  local session list/read/send/cancel API
    events/                    normalized CLI event stream
    approvals/                 local approval request bridge
    review/                    CLI-backed diff/review adapters
    capabilities/              CLI availability/version/config detection

  features/
    chat/
    workspace/
    review/
    artifacts/
    settings/
    auth/
    voice/
    transcription/
    tts/
    activity/
    permissions/
    extensions/                only if extensions remain a product surface

  design-system/
    tokens/
    typography/
    syntax/
    components/
    icons/

  shared/
    components/                reusable feature-neutral components
    hooks/
    utils/
    types/
```

This is not a request to move everything immediately. It is the organizing
target used to classify future changes.

## Current Folder Mapping

| Current area | V2 target | Action |
| --- | --- | --- |
| `src/app` | `src/app` | Keep, but split entry/bootstrap/providers/shell/routes more clearly. |
| `src/core/network` | `src/platform/network` or `src/cloud/*` | Split API infrastructure from cloud product clients. |
| `src/core/platform` | `src/platform/windows` and `src/platform/tauri` | Keep native shell/window services, rename by responsibility. |
| `src/core/storage` | `src/platform/storage` | Keep storage abstraction, but separate cloud conversation storage from app-local storage. |
| `src/core/permissions` | `src/features/permissions` plus `studio-cli/approvals` | Split UI/domain permission display from local CLI approval protocol. |
| `src/runtime` | `src/cloud/chat`, `src/studio-cli/*`, `src/features/chat/run-events` | Retire Desktop-local runtime as a subsystem; migrate reusable display/event pieces. |
| `src/cliBridges` | `src/studio-cli` | Replace generic/Claude bridge with native Studio CLI bridge. |
| `src/design` | `src/design-system` | Rename only after CSS authority and imports are stable. |
| `src/ui` | `src/design-system/components` or `src/shared/components` | Split branding/icons/feedback/primitives by real ownership. |
| `src/lib` | `src/shared/utils` or owner folders | Move large domain utilities to owners; keep only tiny generic utilities shared by many areas. |
| `src/types` | `src/shared/types` plus feature-local `types.ts` | Avoid global type dumping; keep cross-boundary DTOs explicit. |
| `src/features/workspace/browser` | undecided | Remove, keep, or rebuild depending on browser product decision. |
| `src/features/workspace/terminal` | `src/studio-cli/client` or advanced terminal feature | Studio CLI host should not be mixed with generic terminal tabs. |
| `src/features/workspace/rightWorkspace` | `features/review`, `features/artifacts`, `features/side-chat`, shell panel components | Split by product surface after right-panel taxonomy is settled. |

## Cloud And Local Separation

Do not organize the app around a raw `cloud/` vs `local/` toggle in the UI.
Organize code around authority:

- Cloud authority:
  - cloud conversation/run state
  - Studio Data
  - hosted tools/connectors/agents
  - model gateway
  - cloud memory and cloud artifacts
- Studio CLI authority:
  - local workspace sessions
  - local repo/files/terminal/git
  - local tool execution
  - local transcript/session storage
  - local approvals for machine-affecting actions
- Desktop authority:
  - native shell
  - navigation
  - visibility/review UI
  - account/settings
  - bridge orchestration between user, CLI, and cloud

In code, this means `cloud/*` and `studio-cli/*` should be service/client
boundaries, while `features/*` should render product workflows.

## Monolith Split Strategy

Split by responsibility, not by line count alone.

Priority monoliths from the current map and V2 audit:

| File | Split direction |
| --- | --- |
| `src/features/workspace/pages/WorkspacePage.tsx` | Extract workspace controller/state, then page sections, then source-specific adapters. |
| `src/features/workspace/life/workspaceService.ts` | Split cloud client, local fallback, seed data, mutations, context preview, and AI organize actions. |
| `src/features/artifacts/components/ArtifactLabPanel.tsx` | Decide lab/demo/product role; split catalog data, filters, preview, and action handlers. |
| `src/features/chat/context/ChatProvider.tsx` | Separate cloud run state, local Studio CLI state, conversation metadata, transient turn state, and UI-only state. |
| `src/features/chat/context/useSendPipeline.ts` | Split cloud send, Studio CLI send, retry/continuation, and persistence. |
| `src/features/workspace/rightWorkspace/RightWorkspacePanel.tsx` | Split shell panel geometry from product tab/surface rendering. |
| `src-tauri/src/commands.rs` | Create command inventory first; split by command family only after frontend callers are mapped. |

Preferred shape for large features:

```text
features/<feature>/
  pages/
  components/
  hooks/
  services/
  state/
  types.ts
  index.ts
```

Use `services/` only for feature-owned side effects. Shared infrastructure moves
to `platform`, `cloud`, or `studio-cli`.

## Import And Barrel Rules

The future structure should make imports explain ownership.

Rules:

1. Feature code may import from `platform`, `cloud`, `studio-cli`,
   `design-system`, and `shared`.
2. `cloud` and `studio-cli` should not import feature UI.
3. `platform` should not import feature UI.
4. Cross-feature imports require a public `index.ts` or a move to `shared`.
5. Avoid deep imports into another feature's private folders.
6. Barrels should be small public surfaces, not re-export-everything dumps.
7. Inline helper blocks inside page files should move to feature-local modules
   once they are reused or obscure the page responsibility.

## Renaming Candidates

These are candidates, not immediate moves:

| Current name | Issue | Candidate |
| --- | --- | --- |
| `runtime` | Ambiguous with cloud runtime and no longer future local authority. | `cloud-chat-client`, `run-events`, `studio-cli`, or delete by slice. |
| `cliBridges` | Generic name hides Claude-specific implementation. | `studio-cli` after replacement; `claude-bridge` only as temporary legacy folder. |
| `core` | Mixed platform/network/storage/permissions/errors/models. | Split into `platform`, `cloud`, feature-owned services, and `shared`. |
| `design` | Acceptable, but less explicit as a system authority. | `design-system`. |
| `ui` | Too broad. | Split into `design-system/components`, `shared/components`, and `brand`. |
| `library` under root | Bundled capability source, not app library. | Keep as temporary `library` until V2 removal; future CLI/native-tool packages should move out. |
| `workspace/rightWorkspace` | Describes placement, not product responsibility. | Split into `review`, `side-chat`, `artifacts`, `shell/panels`, or `workspace/surfaces`. |

## Physical Reorganization Order

Do not start by moving folders. Start by removing superseded systems and defining
new boundaries.

1. Finish caller inventory and dependency blockers for removal candidates.
2. Define Studio CLI Desktop protocol.
3. Migrate local chat/workspace authority to Studio CLI.
4. Remove Claude/local-runtime/MCP execution paths in safe slices.
5. Create `src/studio-cli` and `src/cloud` boundaries.
6. Move surviving runtime UI/event-display pieces into feature or shared
   locations.
7. Split workspace and chat monoliths by source authority and UI surface.
8. Rename `core`, `design`, `ui`, and right-workspace folders only after their
   contents are reduced and classified.
9. Finalize imports/barrels and run typecheck/build gates.

## Next Document

The final V2 plan should merge:

- `STUDIO/docs/studio-rehabilitation-map.md`
- `documentation/version 2 rehabilitation/01-removal-audit.md`
- this target-structure audit

The final plan should be the only implementation checklist. It should include
checkboxes, slice order, verification commands, and stop conditions.
