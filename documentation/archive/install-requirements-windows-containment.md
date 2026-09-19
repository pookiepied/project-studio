# Install requirements: the Windows containment sections

**Archived 2026-09-19.** These sections were part of
`work/install-requirements.md` while the Windows AppContainer sandbox existed
(ADR 0041). ADR 0057 removed that sandbox; nothing below applies to a build
after it. Kept because the measurements - the 1,362 entries, the 65,568-byte
descriptor against a 65,535-byte limit - are the evidence the decision rests
on, and the mechanism is described here more exactly than anywhere else.

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

