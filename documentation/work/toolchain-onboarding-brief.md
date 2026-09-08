# The toolchain, the sandbox, and the onboarding nobody has written

**Opened 2026-09-08**, after a conversation failed to run `git` with a Windows
`error 5` and the model was left to guess why. Two separate things are in
here: a contradiction inside our own sandbox code, which is a bug, and the
absence of an onboarding, which is a product gap.

## 1. What actually happened

The `shell` tool resolves every program a command line names, the way the
interpreter would, and passes each program's directory as a **read** program
root (`tools/shell/resolve.ts`, then `index.ts` at the two `programRoots:
granted.directories` call sites). For `git` on Windows that directory is
`C:\Program Files\Git\cmd`.

The AppContainer backend then tries to add a read entry for the workspace's
SID to that directory. Windows refuses with `ERROR_ACCESS_DENIED`, because
adding an ACE under `C:\Program Files` needs elevation. The backend fails
closed and says so, with the remedy in the message: run
`pnpm sandbox:prepare --read "<path>"` from an elevated terminal.

**Failing closed is correct and is not the bug.** A containment that cannot be
established must refuse rather than run uncontained.

## 2. The contradiction, which is the bug

`sandbox/isolation/program-roots.ts` states the rule in its own words:

> **Not the executable's own directory.** It is not needed - the image is
> already open - and asking for it would mean writing an access-control entry
> into `C:\Program Files`, which needs elevation this feature must never want.

The MCP launcher honours that: it derives roots from the server's *arguments*,
so it grants the script's tree and never the interpreter's install directory.

The `shell` tool does the opposite. It grants the directory of **every program
on the line**, which for any program installed under `C:\Program Files` is
exactly the entry the doctrine says never to ask for. Two parts of the same
subsystem disagree, and only one of them has written down why.

## 3. What has to be measured before it is fixed

Do not simply delete the grant. The doctrine says the *image* opens with the
launcher's own rights, which is why a program runs without a grant on its own
directory. It says nothing about what a program reads **after** it starts, and
`git` is precisely the awkward case: `C:\Program Files\Git\cmd\git.exe` is a
shim, and git reads its own `libexec`, its templates and its config from the
installation at runtime.

So there are two possible truths and they need an experiment, not an opinion:

- **If contained `git --version` and a real `git status` both work with no
  grant**, then `shell` is over-granting, the fix is to stop passing the
  program's own directory, and the whole `error 5` class disappears for every
  program in `C:\Program Files`.
- **If git genuinely needs to read its installation**, then the grant is right,
  the refusal is right, and the remedy has to become something a user can
  actually perform - which is section 4.

The experiment is cheap: contain a command with and without the root and
compare. `studio-contain probe` already exists for asking the kernel directly
rather than trusting a tool's error text.

## 4. The onboarding that does not exist

Even when the refusal is correct, the way a person meets it is wrong. Today it
arrives mid-conversation, as an error, with a remedy (`pnpm sandbox:prepare`)
that only works in a checked-out repository with a package manager installed.
For the packaged application this is aimed at, that command does not exist.

What it should be instead, as a first-run experience:

1. **Detect the toolchain.** Which of git, node, python, the package managers
   and the shells are installed, and where. The resolver that finds a program
   for a grant already knows how to do this.
2. **Work out what needs elevation**, before anything is asked for. That is
   knowable up front: it is the set of program directories under protected
   roots.
3. **Ask once, with the whole list**, explaining what the entry is and that
   it is additive and removable. One elevation prompt at setup, never one per
   conversation.
4. **Record what was granted**, so a later run knows it is done, and so a
   person can see and revoke it.
5. **Say what was skipped.** A person who declines should be told which
   commands will refuse, rather than discovering it later inside a task.

The principle: **the person should never learn what a program root is.** By
the time they are in a conversation, everything their machine has should
already work, and every remaining refusal should be a permission question they
are asked, not a wall they hit.

## 5. Where this sits

Not on the roadmap's critical path - discovery, MCP, browser, providers come
first. But it is the difference between something that works on the machine it
was built on and something a person can install. It should land before anyone
other than the author runs Studio.
