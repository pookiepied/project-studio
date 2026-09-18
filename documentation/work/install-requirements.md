# What installing Studio has to do

Requirements the packaged installer must satisfy that the running application
cannot do for itself. Written 30 August 2026, from a failure on a development
machine rather than from theory.

## Windows: containment needs one elevated step

**The requirement.** At install time, with the elevation the installer already
has, grant *traverse* to `ALL APPLICATION PACKAGES` on the ancestors of every
directory Studio will contain work in - the drive root, `C:\Users`, the user's
profile directory, and the Studio home (`~/.studio`). This is what
`pnpm sandbox:prepare <path...>` does today, and the installer should perform
the same work rather than asking a person to run it.

**Why the application cannot do it.** These are system-owned directories. An
unelevated process cannot change their permissions, and Studio must not
elevate itself at runtime. Without the grant, a contained program dies
resolving its own path: `realpath` stats every component, and a component it
cannot traverse fails. On a machine that has not had this step, the `shell`
tool and every stdio MCP server refuse with `sandbox.unavailable`.

**What the grant is, exactly.** Traverse and read-attributes. Not
`FILE_LIST_DIRECTORY` - the holder can walk through the directory and confirm
it exists, and cannot learn what is in it. Non-inheriting, so it reaches
nothing below. Keep it this narrow. See
`src/sandbox/isolation/windows/traversal.ts`.

**Why it is not merely convenience.** Without the machine-wide entry, Studio
falls back to granting one entry *per workspace* on each ancestor, and those
entries are not currently revoked. On the machine this was written from, that
reached 1,362 entries and a 65,568-byte descriptor against a Windows hard
limit of 65,535 - at which point `SetEntriesInAclW` returns error 87,
containment stops working entirely, and even the elevated setup command
fails because the list is physically full. Recovery took manual permission
surgery on four directories.

The revocation defect is briefed separately as Task 50. Both fixes are wanted:
the installer entry means no per-workspace entry is ever written on those
paths, and the revocation fix means the ones that are written elsewhere come
back.

**Uninstall.** `pnpm sandbox:release` removes what containment left for a
workspace. An uninstaller should remove the machine-wide entries it added, and
must never remove an access-control entry the installer did not create.

## Linux: the same shape, a different mechanism

The AppArmor profile that containment needs is installed once with root
(`sandbox:prepare` on Linux, `--undo` to remove it), and `bwrap` and `pasta`
must be present. Packaging should declare those dependencies and install the
profile, for the same reason as above: it is a one-time privileged step, and a
person running a command by hand is not an install experience.

## Verifying an install worked

Not "the command exited zero". Measure:

- the descriptor size on each prepared path, which should be a few hundred
  bytes, and
- the presence of one `ALL APPLICATION PACKAGES` entry on each.

A count of `S-1-15-2-*` entries above a handful means the per-workspace
fallback is being taken and something above did not get prepared.

**Measure from a shell you have confirmed is unsandboxed.** An agent shell in
this project reads a redirected private copy of the user's `AppData`, where
the same path returned 188 bytes to an ordinary elevated shell and 57,140
bytes to an agent shell. The profile root is not redirected, which makes the
discrepancy easy to miss.

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
