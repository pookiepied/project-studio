# Task 64 - The toolchain that actually runs

A conversation cannot run `git` without meeting a Windows error 5, and the
shell tool dies on its first command on this machine. The model is told it
has bash, writes for bash, and gets cmd - after one failure it never sees
explained. Nothing about this is a guess: the failures below were measured
on the machine you are working on, through the real launcher, and are
reproducible - re-take them rather than trusting them.

---

## Part 0 - What is actually true, measured

1. **The corridor fix is live.** `C:\` and `C:\Users` carry the machine-wide
   traverse+LIST entry, Git's tree carries the machine-wide read entry, and
   contained native programs run: `node -e` and the script form, `git
   --version`, `python -V`, `dotnet --version`, `npm --version` through the
   shell's own join for cmd. The getcwd wall from the findings doc is gone.

2. **Contained git dies on its configuration.** With the production grants
   and nothing else, `git init`, `git status` and `git log` all exit 128:
   three warnings (`unable to access 'C:/Users/pooki/.gitconfig':
   Permission denied`) and then `fatal: unknown error occurred while
   reading the configuration files`. Granting read on the home flips all of
   them to 0 - and revoking it takes minutes, past the launcher's own
   timeout, so the home as a read root is not a fix.

3. **Git's bash cannot start in a container, deterministically.** `bash -c
   "exit 0"` dies at `STATUS_DLL_INIT_FAILED` on every SID, with or without
   a console, under every environment and every CYGWIN knob tried. The
   stderr names the cause: `NtCreateDirectoryObject` on the msys2 session
   directory answers `0xC0000022`. Node runs 3/3 beside it. This is the
   "different disease" the findings doc left unverified, now diagnosed.

4. **The model is told the wrong shell.** The tool registers under the
   interpreter the machine resolved (bash here), the first contained line
   dies, the process demotes to cmd silently, and the description keeps
   saying bash. `a ; b` approved under bash is then refused under cmd - or
   worse, read as one command with a stray argument.

## Part 1 - The two fixes

1. **Say which shell died and which one the session uses now.** When a
   demotion happens, the result carries the dead attempt's own fatal line
   and the new interpreter's statement - the same lines the environment
   block carries, so the two cannot disagree. The background branch proves
   the interpreter before the job exists, because a background bash dies
   where there is no retry point.

2. **Owe the contained git its configuration.** The user's `.gitconfig`
   and `.config/git/{config,ignore}`, when they exist, join every policy
   as read roots - file-scoped, so no home-wide reach and no tree-walk
   cost, with ancestors already corridor-covered and nothing needing
   elevation. `release` takes them back with the policy's other roots,
   including from a fresh process (`sandbox:release`, `--stale`).

What is deliberately not done: the msys2 object-directory grant (kernel
object ACL work, elevation for nothing - the demotion already routes around
it); the home as a read root (measured too slow to grant and revoke);
dropping the program's own directory from the shell's grants (load-bearing
for runtime reads like Python's stdlib - the elevation class it caused is
gone through AAP inheritance).

## Part 2 - The verification this task owes

For every default preset (git, rust, node-caches, python, java,
android-flutter, go, dotnet): detected here or not, and one contained
command through the harness's own `LocalSandbox` where the preset names a
program. Both policy shapes - a plain conversation's and a project
folder's. The custom-add path: a scope row outside the workspace, contained
write, read back. The matrix goes in the report, with what was measured
and what remains open.

## Part 3 - Land it

Docs are part of the task: this brief's standing questions get their
answers in the report, and the report names everything left open. When the
gates are green, merge to `main` and delete the branch - the branch is the
workshop, `main` is the product.
