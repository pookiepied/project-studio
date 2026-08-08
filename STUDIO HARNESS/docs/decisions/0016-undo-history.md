# ADR 0016 — Undo History

**Status:** accepted
**Supersedes:** nothing. **Unblocks:** trust and execution modes (T-03), and
through them `shell`.

## Context

`write` replaces a file whole and `edit` rewrites one in place. Until now the
only protections were the read-before-modify rule and a person approving every
call. That is adequate while a person is watching, and it stops being adequate
the moment an unattended mode ships — because the safety story for Full Auto is
"you can undo it", and there was nothing to undo with (`T-04`).

So undo is a prerequisite for modes, not a companion feature, and it is built
first.

## Decision

**A shadow git repository per project, kept outside the project.**

The git directory lives at `~/.studio/data/snapshots/<name>-<hash>/` and the
work tree is the user's project. The project gains a complete history without
gaining a second `.git`.

### Why outside

Three reasons, and each is on its own sufficient:

1. A store inside the project appears in the user's own `git status`.
2. A store inside the project is destroyed by the `rm -rf` it exists to recover
   from.
3. A project with no git at all still gets undo.

The directory name is the folder name plus twelve hex characters of the SHA-256
of the absolute path. The name alone would collide — everyone has more than one
`app` — and the hash alone would make the directory unbrowsable.

### Why git rather than copying files

Content-addressed storage, delta compression, `.gitignore` already implemented,
and a `restore` that is correct on paths containing newlines. Reimplementing
that is weeks of work to arrive somewhere worse. Git is already vendored for
the `git` tool, so this adds no dependency.

### When a snapshot is taken

**Per user turn, lazily, immediately before that turn's first write.**

- *Per write* produces a history nobody can navigate — twenty entries for one
  instruction, and no single one of them is "before you asked for this".
- *Per turn, eagerly* commits on turns that only read, filling the history with
  points where nothing happened.

"Undo what the agent just did" is the unit people think in, and a turn is that
unit. A turn that writes nothing leaves no trace at all.

Empty commits are allowed. Skipping a commit when nothing changed would make
the history disagree with the trigger, so "the point before turn 12" would
sometimes not exist and every caller would have to reason about why.

### What a snapshot contains

> The project minus ignored files, plus everything the agent touched.

`.gitignore` is honoured, or the first snapshot swallows `node_modules`. But
every path a write tool actually touched is force-added past it, or an
agent-created ignored file is not restorable. The tools already know what they
wrote.

The touched set only has to bridge one gap. Once a path is committed, git
updates it on every `add --all` regardless of ignore rules — so the set covers
the window between "the agent created an ignored file" and "the next snapshot
recorded it", and the shadow index carries it from then on, including across a
restart. That is why it is in memory and not persisted.

A small hard floor of exclusions (`node_modules/`, `.venv/`, `target/`, …) is
written to the repository's `info/exclude`. It is not a replacement for
`.gitignore`; it exists for the project that has none, where the first snapshot
would otherwise hash every dependency on disk. Force-added paths override it
exactly as they override `.gitignore`, so nothing the agent touches is lost to
it.

### Where the trigger lives

**In the call gate, keyed on the declared `write` effect.** Not in each tool.

A tool that writes is a tool that must be undoable, and that follows from the
effect it declares rather than from every author remembering. It runs *after*
authorization, so a refused call leaves no snapshot behind, and *before*
execution, because a snapshot taken afterwards records the damage instead of the
state to return to.

Two concurrent tool calls share one capture — the pending capture is held as a
promise, not a boolean, so they cannot race into two.

### Settings imposed on the repository

Each is a case where the user's own configuration would otherwise reach in and
break a mechanism that is meant to be invisible:

| Setting | Why |
|---|---|
| `user.name` / `user.email` | Git refuses to commit without an identity, and inheriting theirs attributes our bookkeeping to them |
| `commit.gpgsign=false` | A user with signing on globally would have every snapshot block on a passphrase prompt with no terminal to appear in |
| `core.autocrlf=false` | Byte-exact restore; line-ending translation rewrites files we must return unchanged |
| `core.hooksPath` | Hooks live in the git directory, so the project's own are already out of reach — but a global `core.hooksPath` would pull them back in |
| `core.bare=false` | `git init` against a bare `GIT_DIR` can land on `core.bare=true`, after which every `--work-tree` command refuses to run |

Applied on every open, not only at creation. A repository made by an older
build would otherwise keep that build's defaults, and the failure would surface
much later as a snapshot that hangs on a signing prompt.

### Restore

1. Snapshot the current state first, **always**. Undo that cannot itself be
   undone is a second way to lose work, and a user reaching for undo is already
   in the situation where that matters.
2. `git restore --source=<id> --worktree` rewrites and recreates.
3. Files that exist now and did not then are removed explicitly — `restore` has
   nothing to say about a file the target commit never contained.

That list comes from git but drives a delete, so each path is re-checked
against the workspace root before it is acted on.

### No table for this

The shadow repository's log **is** the record. A database row could exist
without the commit, or the reverse, and reconciling that would mean reconciling
a recovery mechanism — the one place a disagreement is least affordable.

### `--git-dir` and `--work-tree`

`tools/git/argv.ts` refuses both options from a caller, and that stays true.
From the model they are an escape from the project. Here they are the
mechanism, set by us, from values the model cannot influence — so this module
builds its argument vector directly rather than through `buildGitArgs`.

## Consequences

**A failed snapshot does not block the write. Today.**

Every write is currently approved by a person in front of the screen, so undo
is a safety net rather than the safety story, and refusing to work because the
net is unavailable turns a degraded feature into an outage. The failure is
reported, not swallowed.

**This must be flipped for any unattended mode.** `TurnSnapshots` takes a
`required` flag for exactly that, and Full Auto sets it. A Full Auto write with
no snapshot behind it is precisely the situation Full Auto's argument rules
out. Tracked as `T-09`.

**Git becomes required for undo, not just for the `git` tool.** A machine
without git gets a reported `snapshots.unavailable` and keeps working without
history. `V-01` — verifying a downloaded git by hash — matters more now, since
undo is a second reason to fetch it.

**Snapshot storage grows.** One commit per writing turn, delta-compressed and
content-addressed, so the cost is small — but nothing prunes it yet. Left
deliberately: a retention policy that discards the snapshot someone needed is
worse than a directory that grows, and the right cutoff is not knowable before
the feature has been used.
