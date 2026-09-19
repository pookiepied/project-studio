# The toolchain, the sandbox, and the onboarding nobody has written

**Opened 2026-09-08**, after a conversation failed to run `git` with a Windows
`error 5` and the model was left to guess why. Two separate things are in
here: a contradiction inside our own sandbox code, which is a bug, and the
absence of an onboarding, which is a product gap.

> **2026-09-19.** The sandbox half is closed by
> [ADR 0057](../decisions/0057-the-gate-is-the-boundary.md): the Windows
> container it describes no longer ships, so its `error 5`, its corridor
> fix and the installer's ACL duties in §7 are gone with it. The onboarding
> half - a first-run setup so a missing toolchain is met before a
> conversation meets it - is still open and is what this brief is now
> about.

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

## 3. The experiment, run 2026-09-08

Measured on the author's Windows machine, containing real commands through
`containCommand` and comparing arms.

**The doctrine is right; `shell` is over-granting.** Contained `git --version`
runs with **no** program root granted at all, exit 0, correct output. The image
really is opened with the launcher's own rights, exactly as `program-roots.ts`
says. Passing the program's own directory is not needed to run the program.

**On this machine git would never have been the failure.** Every Git directory
already carries `ALL APPLICATION PACKAGES:(RX)` by inheritance, and
`grantProgramRoots` skips a root that already holds read - so no entry is
attempted and no elevation is asked for. The `error 5` the user met came from
somewhere else on the line, or from an ancestor traverse, not from Git's own
directory.

**And there is a worse bug underneath.** Contained `git status` and `git init`
fail in every workspace tried - under the temp directory and under the user's
home alike:

```
fatal: unable to get current working directory: Permission denied
```

Contained `node` in the *same workspace under the same policy* lists that
directory happily. So the containment is fine and the workspace grant is fine:
**git specifically cannot resolve its own working directory inside an
AppContainer.** Node reads `.` relatively; git resolves the absolute path,
which walks the ancestor chain, and a traverse-only grant is evidently not
enough for what it asks of each ancestor.

Granting read on the ancestors instead is refused - the user's home needs
elevation, and the backend's own advice is a machine-wide setup run.

**So the two fixes are separate, and the small one is not the important one:**

1. Stop passing the program's own directory from `shell`. It matches the
   doctrine, removes a whole class of elevation prompts, and cannot break
   running a program.
2. Work out what git needs on the ancestor chain, because until that is
   answered **git does not work in a contained conversation on Windows at
   all** - a far larger hole than the grant that was being blamed for it.

## 4. What still has to be measured

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
  actually perform - which is section 5.

The experiment is cheap: contain a command with and without the root and
compare. `studio-contain probe` already exists for asking the kernel directly
rather than trusting a tool's error text.

## 5. The onboarding that does not exist

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

## 6. Where this sits

Not on the roadmap's critical path - discovery, MCP, browser, providers come
first. But it is the difference between something that works on the machine it
was built on and something a person can install. It should land before anyone
other than the author runs Studio.

## 7. The installer's job, written down while it is fresh (2026-09-08)

The corridor fix landed (ADR 0041's amendment,
[the findings](../archive/git-sandbox-findings.md)), and landing it produced the concrete
list this brief was missing. **The installer must do this**, because in a
packaged `.exe` there is no pnpm, no `package.json` and no checkout, so the
remedy the runtime currently names does not exist on the machine at all.

**What has to happen once, elevated.** The corridor entry -
traverse + read-attributes + `FILE_LIST_DIRECTORY`, non-inheriting - granted to
`ALL APPLICATION PACKAGES` on the system-owned ancestors of everywhere Studio
will stand: the volume root, the users directory, and the root of any drive the
person keeps projects on. Today that is
`pnpm sandbox:prepare "<home>" "<projects root>"` from an administrator
terminal. An installer already runs elevated - the person is already answering
a UAC prompt to install the software - so this costs one line inside a consent
they are giving anyway, instead of a permission refusal in the middle of their
first conversation.

**What must NOT move into the installer.** Everything below the user's own
folders. `ensureTraversable` grants those per workspace, automatically,
unelevated, on first use, and `release` takes them back. An installer that
tried to pre-grant them would be guessing at directories that do not exist yet
and leaving entries nothing removes.

**A toolchain installed later needs nothing, and this was measured.** The
corridor entries are about the path chain to a workspace; no program is named
in them. Git installed a year after Studio still finds them in place. And a
program's own directory is already readable when it lives under
`C:\Program Files`, which carries an inheritable
`ALL APPLICATION PACKAGES:(RX)` entry by default - so Git, Node and Python are
readable the moment they are installed, with no grant from us. The only case
left is a toolchain somewhere unusual (a portable unzip, `D:\tools`, a per-user
install), which cannot be predicted at install time and therefore belongs to
the runtime: it must ask, in a dialog that names the directory and elevates
itself if it must, never in a message telling someone to run a package-manager
command.

**The test that says this is done.** A person installs Studio on a machine
that has never seen it, opens a conversation, and asks the model to run
`git status` in a project. It works, and they were never told what a program
root or a traverse entry is.
