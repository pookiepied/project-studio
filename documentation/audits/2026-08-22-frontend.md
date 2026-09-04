# STUDIO frontend audit - 2026-08-22

Read-only audit of `STUDIO/`. The harness (`STUDIO HARNESS/`) was consulted
only as a reference for what the frontend could be talking to. No file other
than this one was changed.

## 1. Inventory

155 files under `src/` (152 in the eight directories below, plus `App.tsx`,
`main.tsx`, `index.css` at the root).

| Directory | Files | What it actually contains | Status |
| --- | --- | --- | --- |
| `components/` | 19 | Icon system (two renderers, a registry, provider brand marks), two brand marks, and nine UI primitives (Button, Dialog, TextField/TextArea, IconButton, Popover + MenuItem/MenuLabel/MenuSeparator, Segmented, StepSlider, Tooltip). | Real, well built. |
| `design/` | 8 | The design system: `RULES.md` (a 300-line rationale), `tokens/` (typography, geometry, motion as TS constants), `theme/` (appearance model, provider, persistence). | Real, coherent, actively used. |
| `domain/` | 14 | Type "contracts" and data: session/project/artifact types, the permission-mode list, the model catalog, and the demo content (`demo.ts`, `longThread.ts`, `gallery/`). | Real types; the data in them is fixture data by design. |
| `features/` | 78 | Eight feature areas: chat (33 files: composer, transcript, markdown, streaming, paging, scroll), artifacts (15), settings (11), voice (10), projects (3), rail (3), palette (2), home (2). | Real components throughout. Data comes from fixtures. |
| `lib/` | 3 | `cn()` (tailwind-merge taught the type roles), `newId()`, `copyText()`. | Real, tiny, all used. |
| `platform/` | 3 | The only Tauri boundary: `window.ts` (window chrome, two invoke calls), `nativeMenus.ts` (context-menu/devtools suppression), `index.ts` (barrel). | Real. Deliberately the sole Tauri seam. |
| `shell/` | 16 | The window: AppShell, splash, detached shell, sidebar (4), chrome (5), actions/selection menus, compact-layout hook. | Real. |
| `stores/` | 11 | Three context providers (navigation, rail, workspace) and workspace helpers (demo turn runner, gallery turn runner, detach, handoff, title derivation). | Real. Workspace is seeded from fixtures. |

Entry points:

- `main.tsx` mounts `App` on `#root` after a top-level `await loadAppearance()`
  (preferences read from the Tauri store before first paint). `assertScaleDefaults()`
  runs first as a dev guard.
- `App.tsx` reads `?conversation=<id>` from the URL; if present it renders
  `DetachedShell` for that one conversation, otherwise `StudioApp` (splash then
  `AppShell`). The provider stack is shared by both: AppearanceProvider,
  WorkspaceProvider, RailProvider, NavigationProvider, all under
  `MotionConfig reducedMotion="user"`.
- `shell/AppShell.tsx` lays out one rounded window: Sidebar on the left, the
  routed page in the centre (`Surface()` switches on route: Settings / Project /
  Chat / Home), SideRail on the right, plus TopStrip, CommandPalette,
  NewProjectDialog, ActionsMenu, SelectionMenu, and a VoiceModeProvider wrapping
  everything. Cmd/Ctrl+K, B, N, Comma shortcuts live here. Sidebar and rail are
  mutually exclusive; the folded rail leaves a restore pill on the right edge.

## 2. State management

All state is hand-rolled React context. No Redux, Zustand, Jotai, or query
library. `package.json` has no state library beyond framer-motion.

- `stores/navigation/NavigationProvider.tsx` - holds the route (tagged union:
  home / chat / project / settings), sidebarOpen, paletteOpen, sidebar
  organize/sort. Not persisted; a restart returns to Home. Read by AppShell,
  Sidebar, SettingsPage, CommandPalette, chrome components. React context,
  hand-rolled.
- `stores/rail/RailProvider.tsx` - holds rail entries (artifacts opened out of
  the transcript, capped at 12), activeId, width, and the new collapsed flag.
  Not persisted. Read by AppShell, SideRail, RailTabs.
- `stores/workspace/WorkspaceProvider.tsx` - the data store: projects,
  conversations, messages, session status, the running set, and turn settings
  (model / effort / permission). Seeded from `DEMO_PROJECTS` /
  `DEMO_CONVERSATIONS`, or from a one-shot handoff snapshot in a detached
  window. Not persisted anywhere; every restart resets to the demo seed.
  Contains all mutations (send, retry, editMessage, fork, rename, pin, archive,
  remove, createProject, removeProject, setBranch).
- `design/theme/AppearanceProvider.tsx` - theme, uiSize, codeOffset,
  pointerCursor. The one store that persists: a JSON file
  (`preferences.json`) via tauri-plugin-store in the OS config dir, with
  localStorage as the browser-dev fallback and a one-time migration off legacy
  localStorage. Only deviations from defaults are stored; reset clears the entry.
- `features/voice/VoiceModeProvider.tsx` - a boolean (voice stage open) plus
  the overlay itself. Not persisted.
- `components/icons/Icon.tsx` - `IconStateContext` publishes hover/press/on
  from IconButton down to glyphs. Presentation only.

Two localStorage keys exist in the whole app: `studio.appearance` (legacy
fallback only) and `studio:workspace-handoff` (a one-shot snapshot written
before a detached window opens and now removed on read - see section 6).

Is there a single source of truth? Yes, with a deliberate split: navigation
("where the user is looking") is intentionally separate from workspace ("what
exists"), documented in WorkspaceProvider's docblock. No two stores hold the
same data and no competing sources were found. The weakness is not duplication
but ephemerality: nothing about the workspace survives a restart.

## 3. Data layer - THE CENTRAL QUESTION

Premise check: the grep for `fetch(`, `invoke(`, `localhost`, `127.0.0.1`
across `src/` returns two hits, not one - both `invoke(`, both in
`platform/tauri/window.ts` (line 74 `app_ready`, line 103
`open_conversation_window`), both about window chrome. (The only `localhost`
in the project is `devUrl` in `src-tauri/tauri.conf.json`, the Vite dev
server.) No `fetch(`, no `XMLHttpRequest`, no `WebSocket`, no `EventSource`,
no axios anywhere in `src/`. The premise's substance is correct: there is no
data layer.

- Is there any HTTP client, API module, or service layer? No. There is no
  module in `src/` that issues a network request of any kind. The only I/O
  boundaries are: the Tauri window API and the two invoke calls
  (`platform/tauri/window.ts`), the Tauri store plugin
  (`design/theme/appearance.ts`), `navigator.clipboard` (`lib/clipboard.ts`),
  and the microphone (`features/voice/useMicInput.ts`).
- Every `#[tauri::command]` in `src-tauri/src/`: exactly two, both in
  `lib.rs` - `app_ready` (lib.rs:14) and `open_conversation_window`
  (lib.rs:32). Both are called from TS (`window.ts:74`, `window.ts:103`).
  That is the entire Rust command surface.
- Does `src-tauri/src/lib.rs` spawn a sidecar or reference the harness? No.
  It registers three plugins (window-state, store, log-in-debug), applies DWM
  rounded corners, and exposes the two window commands. No `spawn`, no
  `shell`, no path or process name related to the harness anywhere in
  `src-tauri/`.
- Where does the rendered data come from? Hardcoded arrays, all fixture files:
  - `domain/session/demo.ts` - `DEMO_PROJECTS` (2), `DEMO_CONVERSATIONS` (7),
    `demoThinking()`, `demoReply()` (its own text says "There is no runtime
    behind this build yet, so this reply is fixed").
  - `domain/session/longThread.ts` - a 320-message thread fixture.
  - `domain/session/gallery/` - the artifact-gallery conversation fixture.
  - `domain/models/catalog.ts` - `PROVIDERS` (6) and `MODELS` (10), hardcoded.
  - `domain/permissions/modes.ts` - the 3 execution modes, hardcoded.
  - `stores/workspace/useDemoTurn.ts` - the fake transport: setTimeout-based
    streaming of the canned reply.
  - `stores/workspace/useGalleryTurn.ts` - staged artifact playback.
  - `features/voice/useVoiceMode.ts` - 3 canned spoken replies.
  - `features/voice/transcribe.ts` - a stub that returns a bracketed
    placeholder after simulated latency.
  No Faker, no JSON fixtures, no MSW - the data is inline in TS files.
- Are `domain/models`, `domain/session`, `domain/permissions` stubbed? They
  are deliberate "mocks with a real shape". `catalog.ts` says it outright:
  "Demo data with a real shape... Replacing this file with a fetch is the
  whole migration." `modes.ts` says the same ("replacing it with a fetched
  policy changes no component"). `session/context.ts` marks where real usage
  arrives. These are honest seams, not abandoned stubs - but they are still
  mocks, and their types are the frontend's own invention (see FE-05).

Verdict: this frontend is currently a self-contained mock. It does not
communicate with the STUDIO HARNESS at all, in either direction, and nothing
in `src-tauri/` launches or references the harness. The harness side, for
reference, already serves the API a Connections page would want: a full
provider-connection surface at `/api/providers` (GET/POST/PATCH/DELETE
`/connections`, `POST /connections/:id/probe`, `GET /models`, manual models
per connection, defaults per capability slot) in
`STUDIO HARNESS/src/transport/http/routes/providers.ts`, mounted by
`create-app.ts:42`. It is launched by a host process
(`src/host/harness-launcher.ts`) that emits a readiness frame (host 127.0.0.1,
port, clientId, sessionId, bearer credential) and requires an admission scope
(PROVIDER_MANAGEMENT) on every provider route.

## 4. The Providers pane

`src/features/settings/panes/ProvidersPane.tsx` (143 lines), plus everything
it imports: `Pane` (panes/Pane.tsx), `Button`, `Dialog`, `TextField`,
`Popover`, `MenuItem` (components/primitives), `PROVIDERS`/`MODELS`
(domain/models/catalog.ts), `COMPATIBILITIES`/`Compatibility`
(domain/models/types.ts), `Icons`/`ProviderMark` (components/icons).

What it renders today: a read-only list of the six hardcoded providers, each
row a brand mark, the name, and a model count derived from the hardcoded
`MODELS` array. The hardcoded shape it reads (catalog.ts:11):

```ts
PROVIDERS: readonly Provider[] = [
  { id: 'anthropic', name: 'Anthropic', compatibility: 'anthropic', custom: false },
  { id: 'openai',    name: 'OpenAI',    compatibility: 'openai-responses', custom: false },
  { id: 'google',    name: 'Google',    compatibility: 'google', custom: false },
  { id: 'meta',      name: 'Meta',      compatibility: 'openai-chat', custom: false },
  { id: 'deepseek',  name: 'DeepSeek',  compatibility: 'openai-chat', custom: false },
  { id: 'mistral',   name: 'Mistral',   compatibility: 'openai-chat', custom: false },
]
```

Below the list is an "Add provider" button opening `AddProviderDialog`:
display name (TextField), base URL (TextField), and "Speaks" (a hand-built
Popover menu over the closed `COMPATIBILITIES` list of four wire formats).
The dialog's confirm button is enabled when name and base URL are non-empty,
and its `onClick` is literally `close` (ProvidersPane.tsx:83) - the three
values are discarded. No provider is created, nothing is persisted, the
dialog state resets on close.

- Add/edit/delete gestures: "Add" exists as a gesture but goes nowhere. There
  is no edit and no delete; rows have no affordances at all. Display-only
  plus a dead form.
- API key input: there is none, anywhere in the app. The pane documents this
  as deliberate (ProvidersPane.tsx:19-22: "The API key is deliberately not
  asked for here. Keys belong in the OS credential store, which is the
  harness's job"), and the dialog repeats it as user-facing copy
  (ProvidersPane.tsx:136-139). A grep for apiKey/secret/token/credential/
  password across `src/` finds no field, no state, no storage, and no log
  holding such a value. So there is no security finding here today - but note
  that the AddProviderDialog is the natural place one will appear, and the
  rule for it is already stated in the harness contract: `ProviderConnection`
  "NEVER carries an API key, in either direction"
  (STUDIO HARNESS/src/contracts/providers.ts:169-174); a key travels only in
  the POST/PATCH body and is stripped into the credential store before the
  record exists (routes/providers.ts:36-60). When the dialog is wired up,
  the key must go into the request body only, never into component state
  that outlives the submit, never into localStorage, never into the
  tauri-plugin-store file (which is plaintext JSON), and never into a log.
- What would have to change for it to be backed by the harness's real
  provider connections:
  1. A transport: a client module holding the harness baseUrl and bearer
     credential (from the launcher readiness frame), which today does not
     exist in any form (see section 3).
  2. Wire types for `ProviderConnection` / `ProviderModel` mirroring the
     harness contract - the current `Provider` type in
     `domain/models/types.ts` is a different shape and will not map
     (see FE-05).
  3. The list: replace `PROVIDERS.map(...)` with `GET /api/providers/
     connections`, render displayName, enabled, credential status, and
     per-connection models from `GET /api/providers/models?connectionId=`.
  4. The dialog: POST `/connections` with the three fields it already
     collects (plus optional apiKey), then re-fetch or merge the returned
     connection. The fields it asks for are already close to the draft
     shape (displayName, baseUrl, protocol) - only the compatibility
     vocabulary needs renaming to the harness protocol union.
  5. New gestures: enable/disable (PATCH enabled), edit (PATCH
     displayName/baseUrl), delete (DELETE), probe (POST `/connections/:id/
     probe`) for a status badge, and credential-present/absent display.
  6. Loading, error, and empty states, which no settings pane has yet
     because none of them fetches anything.

Pane registration: `registry.tsx` holds `BUILT`, a section-id-to-component
map (general, appearance, archive, providers). `paneFor(sectionId)` returns
the built pane if registered, else a `PlaceholderPane` from
`placeholders.ts`, else falls back to GeneralPane for unknown ids. Adding a
pane is one entry in `BUILT` plus one in `sections.ts`; the page and nav
never change. Real panes: General (wired to workspace settings), Appearance
(wired to the persisted appearance store), Archive (wired to workspace
conversations), Providers (fixture-backed). Placeholders (12): account,
voice, personalization, shortcuts, mcp, connectors, browser-use, skills,
hooks, git, worktrees, environments - each renders a title, a description,
and a "This section will hold:" list, with the honest line "Waiting on the
harness. The layout is settled; the values are not wired."

## 5. Design system

Styling approach: Tailwind CSS v4 (`@tailwindcss/vite` plugin, declared in
package.json and confirmed in `vite.config.ts` and `index.css`), configured
through a single global stylesheet - `src/index.css`, 1057 lines, importing
`tailwindcss` and both font families, defining a `@custom-variant dark` on
the `.dark` class, and layering tokens, roles, and component classes. No CSS
modules, no CSS-in-JS. Framer Motion for animation. A few inline styles
where a value must come from a TS token (radii in AppShell, voice orb
colors). `design/tokens/*.ts` mirrors the numbers TS/Framer needs (radii,
control steps, springs, durations) so CSS and JS cannot drift;
`assertScaleDefaults()` enforces the one unavoidable duplication at boot.

Is there a coherent token system, and is it used? Yes, unusually so.
`design/RULES.md` states the rules and the tokens implement them:

- Type: six roles (`text-micro/caption/ui/body/title/display`) all derived
  from `--ui-size`; nothing writes a raw font size. `cn()` teaches
  tailwind-merge the roles so they survive merging.
- Control geometry: `--control-sm/md/lg/xl` derived from the same variable;
  `IconButton` reads them instead of fixed sizes.
- Radius: `RADIUS` scale with the concentric rule; the window corner is set
  in Rust (DWM) and mirrored in CSS.
- Motion: three durations and three springs in `tokens/motion.ts`, mirrored
  as CSS variables; reduced motion handled once at the root.
- Color: monochrome oklch (chroma 0) with translucent tint/selected states;
  the only hue is `--danger` and the new voice-state colors, both documented
  exceptions.
- Elevation: five shadow steps plus panel; dark-mode-aware.

Components do occasionally hardcode values, but almost always as deliberate,
commented exceptions (e.g. `h-[120px]` on the voice orb, `blur(22px)` on its
halo). The system is enforced by convention and dev guards, not lint rules.

Reusing it for a new settings pane with a list, a form, a modal, and a
status badge:

- List: `Pane` + `Row` (`features/settings/panes/Pane.tsx`) - the exact
  layout every pane uses; `divide-y` rows are the established list idiom
  (see ProvidersPane, ArchivePane). ArchivePane is the best model for a
  row-with-selection list.
- Form fields: `TextField`, `TextArea`
  (`components/primitives/Field/TextField.tsx`).
- Modal: `Dialog` (`components/primitives/Dialog/Dialog.tsx`) - title,
  body, footer slot, Escape, scrim click, spring entrance. The
  AddProviderDialog and NewProjectDialog are working examples.
- Menu/select: `Popover` + `MenuItem`/`MenuLabel`/`MenuSeparator`
  (`components/primitives/Popover/`). There is no standalone select field;
  the idiom is a bordered trigger button opening a Popover, hand-built in
  both ProvidersPane and GeneralPane.
- Buttons: `Button` (primary/secondary/ghost/danger, sizes, busy spinner).
- Status badge: `StatusDot` (`features/artifacts/sections/StatusDot.tsx`)
  exists but is typed to the five `ArtifactStatus` values and draws a plain
  dot, not a labelled badge. For a connection status (connected /
  credential present / disabled / probe failed) you would either generalize
  it or build a small Badge; there is no generic badge/pill primitive.
- Also reusable: `Segmented` (binary/tertiary choices), `StepSlider`
  (ordered dial), `Tooltip`, `IconButton`, `cn`, `Icons` (incl.
  `ProviderMark` for brand marks).

Would have to be built: a generic status badge/pill; a toggle/switch (none
exists - AppearancePane uses Segmented for binaries); a select-field
primitive (currently re-assembled per call site); and the whole
loading/error/empty data-state vocabulary, which no existing pane needs
because none of them fetches.

## 6. Uncommitted work

`git status` shows 25 modified files (the brief said roughly 24) plus two
untracked directories (`Backend/`, `docs/`). `git diff --stat`: 25 files,
690 insertions(+), 134 deletions(-). Grouped by feature:

1. Appearance persistence onto the Tauri store (the largest group, and it
   contains the new Tauri dependency). Files: `package.json`,
   `pnpm-lock.yaml`, `src-tauri/Cargo.toml`, `Cargo.lock`,
   `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json`,
   `design/theme/appearance.ts`, `AppearanceProvider.tsx`,
   `AppearancePane.tsx`, `main.tsx`, `App.tsx`. What it does: preferences
   move out of localStorage into `preferences.json`, a real file in the OS
   config directory, via the tauri-plugin-store plugin. `main.tsx` now
   awaits `loadAppearance()` at the top level so the first paint is already
   at the right size and theme; `AppearanceProvider` takes the initial
   value as a prop, gains `reset`/`isDefault`, and stores only deviations
   from the shipped defaults (matching defaults deletes the entry). A
   one-time migration adopts whatever legacy localStorage held, then
   removes the old key. AppearancePane adds a "Defaults" row with a reset
   button that is honest about which state you are in.
2. The Tauri dependency itself. Crate: `tauri-plugin-store` (Rust,
   Cargo.toml:30) plus `@tauri-apps/plugin-store` ^2.4.4 (JS). Capability
   granted: `store:default` (capabilities/default.json:20). The same diff
   also widens `windows` from `["main"]` to `["main", "conversation-*"]`.
   Assessment: the window widening is correct and appropriately narrow - it
   fixes detached conversation windows, which previously had no window
   permissions at all, and the pattern matches only conversation labels.
   `store:default`, however, is broader than the feature needs: per the
   generated ACL manifest it grants all fourteen store operations (load,
   get-store, set, get, has, delete, clear, reset, keys, values, entries,
   length, reload, save) with no path scope, while the appearance code uses
   exactly five of them (load/get/set/delete/save) against one file. See
   FE-02. It matters more than it looks: the store file is plaintext JSON
   in the app config dir, and it is the one persistent writable surface the
   webview now has - a Connections page must never put a key in it.
3. Voice mode. Files: `VoiceModeOverlay.tsx`, `DictationBar.tsx`,
   `waveform.ts`, plus voice tokens in `index.css`. What it does: replaces
   the waveform "ridge" (a horizontal SVG line) with a state orb - a core
   disc and blurred halo whose colour is per stage (connecting/listening/
   thinking/speaking/blocked) and whose scale/opacity are driven by the
   same real level and envelope functions, written straight to the DOM in a
   frame loop. Adds `idleBreath()`, four muted-hue `--voice-*` tokens (the
   app's only colour outside danger, documented as a deliberate exception),
   and a `--control-xl` step for the transport button. The dictation bar is
   fixed to exactly one line of composer text tall (it used to grow the
   composer by 13px) and its bar count rises 22 to 64 with right-anchored
   clipping.
4. Rail collapse and shell geometry. Files: `RailProvider.tsx`,
   `AppShell.tsx`, `SideRail.tsx`. What it does: the rail gains a collapsed
   state that folds it away while keeping its entries, so the sidebar and
   rail can be made mutually exclusive (opening one folds the other) without
   losing artifacts; a restore pill on the right edge shows the count. The
   rail panel itself goes flush, square-cornered, and sunken, mirroring the
   sidebar, and its resize handle becomes a short centred grip rather than
   a full-height hairline.
5. Chrome, menus, and scrolling refinements. Files: `TurnMenu.tsx` (drops
   the permission-mode mark from the trigger - one fact, one place),
   `IdentityLine.tsx` (drops the project-reassignment submenu; filing stays
   in the sidebar), `Dialog.tsx` / `CommandPalette.tsx` (adopt
   `studio-scroll-bounded`: stable scrollbar gutter, corner-aware track),
   `index.css` (splits the scroll inset into asymmetric top/bottom values
   derived from what is actually painted over the scroller), `handoff.ts`
   (the detach snapshot is now removed from localStorage on read instead of
   lingering forever), `tauri.conf.json` (min window 620x480 to 600x440).
6. `.claude/launch.json` adds a `console-preview` launch entry running
   `node Backend/.preview/mock-server.mjs` on port 5199. This serves the
   built console UI of the untracked `Backend/` project (a separate
   Cloudflare-workers effort: auth worker, console worker, telemetry
   worker, a core package). It is not part of STUDIO and the STUDIO
   frontend does not reference it.

The three expected groups (appearance/theming, voice mode, a new Tauri
dependency) are all confirmed - with the correction that the Tauri
dependency is in service of the appearance work (the store plugin exists to
persist preferences), arriving with a separate, justified window-permission
widening.

Half-finished work: nothing breaks the build. Two pieces of dead code are
left behind: the ridge geometry in `waveform.ts` (FE-03) and the now-unused
`setProject` store API (FE-04). Build results, exact commands and output:

- `pnpm typecheck` - there is no such script. Exact error:
  `Command "typecheck" not found` /
  `[ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL]`. The package scripts are `dev`,
  `build`, `preview`, `tauri`.
- Equivalent type check, `pnpm exec tsc -b` (what `pnpm build` runs first):
  clean, no output, success.
- `pnpm build` (`tsc -b && vite build`): success, 3289 modules, built in
  14.06s. Two warnings: (1) `[TOLERATED_TRANSFORM] Top-level await is not
  available in the configured target environment` at `src/main.tsx`
  (`const appearance = await loadAppearance()`, line 23) - the Windows
  target is chrome105 which supports it, but the macOS target is safari13
  (vite.config.ts:32), which does not (FE-08); (2) chunk size - a single
  1,411 kB minified / 422 kB gzip JS chunk (FE-09).
- `pnpm test` - not run; no test script exists in `STUDIO/package.json`.

## 7. Findings

- FE-01 - serious. `src-tauri/tauri.conf.json:32` (`"csp": null`). Content
  Security Policy is disabled for the production webview. Today, with no
  network code, the blast radius is small; the moment the Connections page
  adds outbound HTTP, any injected script gets unrestricted fetch to any
  origin. Fix: set a CSP before the first networked feature (e.g.
  `default-src 'self'; connect-src http://127.0.0.1:*; img-src 'self'
  data:`), and verify the webview fonts/KaTeX still load under it.
- FE-02 - untidy (serious once keys exist). `src-tauri/capabilities/
  default.json:20` grants `store:default`, which per the generated ACL
  manifest enables all fourteen store operations with no path scope; the
  feature uses five against one file. The store is plaintext JSON in the
  app config dir. Fix: replace with an explicit allow-list (allow-load,
  allow-get, allow-set, allow-delete, allow-save) plus a scoped `store`
  entry pinning `preferences.json`, and adopt a standing rule that no
  credential ever enters this store.
- FE-03 - untidy. `src/features/voice/waveform.ts:21` (`LevelHistory`),
  `:47` (`smoothed`), `:63` (`ridgePath`): dead since the orb change - no
  importer remains, and the module docblock still describes "the stage's
  ridge". Fix: delete the three exports and update the docblock, or restore
  a consumer if the ridge is planned elsewhere.
- FE-04 - untidy. `src/stores/workspace/WorkspaceProvider.tsx:355`:
  `setProject` is still defined and exported on the context, but its last
  consumer (IdentityLine's project submenu) was removed in the uncommitted
  work. Fix: remove the API, or reintroduce filing in the sidebar where the
  comment now says it belongs.
- FE-05 - serious for the next task (untidy today). The frontend's provider
  and model types are a private mirror of a harness contract that already
  exists, and the two differ: `Provider` in
  `src/domain/models/types.ts:29` is `{id, name, compatibility, baseUrl?,
  custom}` while the harness `ProviderConnection`
  (STUDIO HARNESS/src/contracts/providers.ts:210) is `{id, displayName,
  kind, source, baseUrl?, enabled, catalogProvider?, credential, protocol}`;
  `COMPATIBILITIES` re-lists the harness protocol union; and
  `ProviderId` (`src/components/icons/ProviderMark.tsx:38`) is a closed
  seven-value union that cannot name a user-added connection's vendor -
  the harness deliberately separates connection id from `catalogProvider`
  for exactly that case. Fix: when wiring the Connections page, define the
  wire types once in a new module (ideally generated from or checked
  against the harness schemas) and map to view types at the boundary;
  make `ProviderMark` take a catalog-provider string with a `custom`
  fallback instead of the closed union.
- FE-06 - untidy. `src/features/artifacts/kinds/MediaArtifact.tsx:28`:
  `(artifact.data ?? {}) as MediaData` - an unvalidated cast of opaque
  artifact data. Harmless while all artifacts are fixtures; a malformed
  real tool payload renders undefined-derived values instead of failing
  the boundary. Fix: a small guard at the artifact parse boundary
  (`domain/artifacts/parse.ts` is the natural place).
- FE-07 - untidy. `src/features/rail/RailTabs.tsx:106`:
  `;(existing.entries as RailEntry[]).push(entry)` - casts away a readonly
  array type to mutate a local group. Fix: type the local `Group.entries`
  as a mutable `RailEntry[]`.
- FE-08 - untidy. `src/main.tsx:23` uses top-level await; the macOS build
  target in `vite.config.ts:32` is `safari13`, which does not support it.
  Rolldown currently tolerates the transform, so the Windows build (chrome105)
  works, but a macOS build would ship code its target cannot run. Fix:
  either raise the macOS target to safari15+, or move the await inside a
  bootstrap function.
- FE-09 - untidy. Single 1.4 MB JS chunk (build warning). Mostly
  react-syntax-highlighter, katex, and markdown machinery. Fix: dynamic
  import for the transcript's markdown/code path when bundle size starts
  to matter; not urgent for a desktop app.

Counts requested: `any` - 0 occurrences in `src/` (the single grep hit is
the English word in a comment). Non-null `!` assertions - exactly 1
(`features/voice/useVoiceMode.ts:96`, indexing a modulo'd constant array).
Type assertions - roughly 40 `as const` (idiomatic, benign) and 14 non-const
`as` casts across 10 files; the worst offenders by count are
`stores/workspace/handoff.ts` (3, each immediately guarded by runtime
checks), `components/icons/registry.tsx` (2), `shell/SelectionMenu.tsx` (2),
`shell/ActionsMenu.tsx` (2), and the single unvalidated data cast in
MediaArtifact.tsx (FE-06). Secrets: nothing found - no API-key field, no
secret in state, none in either localStorage key, none logged; the only
`console.*` in the app is a dev-only guard (`design/tokens/
typography.ts:155`). Dead code: the two items above (FE-03, FE-04);
every primitive, and every other export checked, has a consumer.
Permissions in `src-tauri/`: covered by FE-01 and FE-02; the window
permissions are minimal and the `conversation-*` widening is justified.

## 8. Verdict

This frontend is a mock with no data layer, and it is a good one. There is
no HTTP client, no service module, no Tauri bridge beyond two window-chrome
commands, and every value on screen comes from fixtures in `domain/` - but
the seams are real and documented in the code itself: the workspace's turn
runner is explicitly "the single seam a real transport replaces", the model
catalog says "replacing this file with a fetch is the whole migration",
`transcribe.ts` is "the seam", and `context.ts` marks where real usage
arrives. The parts around those seams are in genuinely sound shape: strict
TypeScript (zero `any`, one non-null assertion in 155 files), a coherent
and enforced design system, well-factored primitives, and a build that
passes clean. Nothing has to be fixed before a Connections page can be
built - with two exceptions that should be done first because the page will
amplify them: set a CSP (FE-01) and narrow the store capability (FE-02),
and do not reuse the `domain/models` types as wire types (FE-05) - they
already disagree with the harness contract.

The shortest honest path: first, decide the transport, because it gates
everything - the harness is a separate process that a host launches and
authenticates (readiness frame on fd 3 with a 127.0.0.1 port and a bearer
credential, `STUDIO HARNESS/src/host/`), and STUDIO's Rust side currently
does none of that, so the minimum is either a Rust command that spawns the
harness and hands the webview its baseUrl and credential, or, for a first
cut, a fixed URL and token from configuration with the harness started by
hand. Second, build a small client module (baseUrl + bearer header + typed
wire types from the harness `contracts/providers.ts`) in `src/platform/`,
next to the Tauri boundary. Third, wire the Providers pane: list from
`GET /api/providers/connections` (displayName, enabled, credential status,
models from `GET /api/providers/models`), keeping the hardcoded catalog as
the offline fallback. Fourth, make the existing dialog real: POST
`/connections` with the three fields it already collects plus an optional
API key that is submitted once, held only in dialog state, and never
persisted or logged; then add enable/disable and delete (PATCH/DELETE) and
a probe button (POST `/connections/:id/probe`) for the status badge. That
order - transport, client, list, mutations - is the whole page, and the
pane registration system means it lands without touching anything outside
`features/settings/panes/`.
