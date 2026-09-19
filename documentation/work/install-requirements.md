# What installing Studio has to do

Requirements the packaged installer must satisfy that the running application
cannot do for itself. Written 30 August 2026, from a failure on a development
machine rather than from theory.

## Windows: nothing to prepare

There was a section here requiring one elevated step at install time: traverse
entries for `ALL APPLICATION PACKAGES` on the ancestors of every directory
Studio would contain work in, so that the AppContainer sandbox could resolve a
path at all. It described the mechanism, its exact grant, and the day the
per-workspace fallback filled a directory's permission list to the Windows
hard limit. ADR 0057 removed that sandbox, and with it the requirement: on
Windows the permission gate is the boundary, no permission entry is written
anywhere, and there is nothing for an installer or an uninstaller to do. The
old section is kept, with the measurements, in
`archive/install-requirements-windows-containment.md`.

## Linux: one privileged step, and two packages

The AppArmor profile that containment needs is installed once with root
(`sudo pnpm sandbox:prepare`, `--undo` to remove it), and `bwrap` and `pasta`
must be present. Packaging should declare those dependencies and install the
profile: it is a one-time privileged step, and a person running a command by
hand is not an install experience. Containment on Linux is opt-in (ADR 0057),
so a machine without the profile runs gate-only rather than refusing; the
step is what turns the extra fence on.

## What the bundle carries, and what it still does not

Added 2026-09-19. `bundle.resources` in `STUDIO/src-tauri/tauri.conf.json`
lays the harness out as one installation under `harness/` in Tauri's
resource directory: `package.json`, the built `dist/` files flattened beside
it as `server.mjs` and its chunks, and the three directories the running
harness reads relative to its installation root - `vendor/` (the binaries it
ships), `skills/` (the system skills), `catalog/` (the provider curation).
`installationRoot()` in `src/platform/paths.ts` walks up from `server.mjs`
to the nearest `package.json`, so the flattened layout and the development
layout (`dist/server.mjs` one level down) resolve to the same root without
a second code path. The supervisor looks for `harness/server.mjs` at the
resource directory of each platform, from the executable, because the eager
start runs before a Tauri application handle exists - and takes it only when
`node_modules/` sits beside it, because `tauri dev` copies the resources
under `target/debug/` too, dependency-less, and that copy answering first is
a harness that dies at its first import.

Two things a packaged build still needs that no line here provides, stated
so nobody reads the resource map as "packaging is done":

- **A Node runtime.** The harness is a Node program; the supervisor spawns
  `node` from the machine. A packaged app must either ship one or declare it
  a prerequisite, and the check should happen at install time, not as a
  "harness is not running" screen.
- **`node_modules`.** `dist/server.mjs` imports its dependencies by bare
  specifier (`@earendil-works/pi-ai`, `hono`, `@napi-rs/keyring` and the
  rest), so it runs only beside an installed `node_modules`. Either the
  bundle carries a production install of the harness's dependencies under
  `harness/node_modules/`, or the build changes to bundle them in. The
  keyring module is native and platform-specific, which is the one entry
  that decides which of the two is right.
