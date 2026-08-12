# ADR 0014: Where Things Live On The Machine

Status: Accepted

## Context

The harness runs with **the user's project as its working directory**. That one
fact invalidates every relative path, and it had already produced two real bugs
before this was written down:

- The vendor lookup resolved against the working directory, so a repository
  containing `vendor/win32-x64/rg.exe` would have had its own binary executed.
- The database defaulted to `./data/studio.db`, so opening a project would have
  created our database inside the user's repository — in their `git status`,
  duplicated per project, and lost when they switched.

Both are the same mistake. A third was coming with git: a downloaded binary has
nowhere obvious to go, and "next to the application" is wrong because a packaged
installation is read-only.

## Decision

### Three locations, and they are not interchangeable

| Location | Contains | Writable |
|---|---|---|
| Installation | application code, shipped binaries | no |
| `~/.studio` | database, downloaded binaries, snapshots, logs, caches | yes |
| The project | the user's own files | yes, theirs |

The installation is resolved from the module's own location, the Studio home
from `homedir()`, and neither from `process.cwd()`. `src/platform/paths.ts` is
the only place any of it is decided, so a future subsystem cannot quietly invent
a fourth convention.

### `~/.studio`, following what the ecosystem settled on

`~/.claude` and `~/.codex` both use a dotted per-product directory in the user's
home, subdivided by concern. There is no reason to be different, and there is a
real cost to being different: users already know where to look, and so do the
agents operating on their own configuration.

Inside the home, directories are grouped by **what happens if you delete them**.
Every other property follows from that one question: what to back up, what to
sync, what a "clear caches" button may remove, and what support can safely tell
a user to throw away.

```
~/.studio/
  config/   settings.json                    user-authored — losing it loses preferences
  data/     studio.db  snapshots/            durable — losing it loses work
            projects/  sessions/
  tools/    bin/<platform>/<name>/current    re-downloadable
  logs/                                      disposable, but findable
  cache/                                     disposable
  tmp/                                       cleared between runs
```

A flat home does not survive contact with a real product: `~/.codex` has over
forty entries at its top level and nothing about it says which of them matter.

The rule is that a new directory must belong to one of these six. If it
genuinely fits none, the category set is wrong and should be changed
deliberately — the failure mode to avoid is a seventh sibling quietly appearing
at the top level, then an eighth.

`durableDirectories()` derives the backup set from the same accessors everything
else uses, so a new durable directory cannot be added and then forgotten by the
backup.

`PROJECT_STUDIO_HOME` relocates the whole tree, which is what tests use and what
lets a user move state to another drive.

### Snapshots live outside the project

A shadow git repository inside the project would appear in the user's own
`git status`, and would be destroyed by the same `rm -rf` it exists to recover
from. It goes in `~/.studio/snapshots/`, which is also where OpenCode puts its
equivalent.

### Shipped and downloaded binaries are kept apart

Different lifetimes and different trust. One was reviewed and committed; the
other arrived over the network at runtime. Keeping them in separate roots means
"what did we ship" stays an answerable question, and it is forced anyway by the
installation being read-only.

Downloaded programs install under a version-stamped directory with a `current`
pointer, so an upgrade is a new directory rather than an overwrite of a file
that may be running — the same shape as `~/.codex/.sandbox-bin`'s versioned
executables.

### Source order is declared per binary, not globally

- **ripgrep: shipped only.** Search results that vary with whatever version a
  machine happens to have cannot be reproduced.
- **git: system, then managed.** The user's own copy is the one they maintain
  and patch. Ours is the fallback for a machine without it, and it is a ~50 MB
  GPLv2 program with its own security-update cadence — a poor thing to ship in
  every installer for the majority who already have it.

## Consequences

- Directories are created when first needed, not at startup. A new user should
  not find a dozen empty folders describing features they have never used.
- Nothing yet writes to `logs/`, `sessions/`, or `projects/`. They are named
  here so the layout is decided once rather than negotiated per subsystem.
- The git installer must verify a hash before running what it downloaded. That
  is recorded as V-01 and is a precondition for shipping the installer, not a
  follow-up to it.
- A per-project `.studio/` directory for shared, committed project settings is
  deliberately not decided yet. It is a different question — team-shared
  configuration — and needs a real consumer first.
