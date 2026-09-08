# Research task: why git cannot read its working directory inside our sandbox

**This is a research task. Change no source file, write no fix, open no
branch.** Another agent is editing the harness right now. Your entire output is
one new document, `documentation/work/git-sandbox-findings.md`. If you finish
early, measure more; do not start implementing.

## What is already known, so you do not re-measure it

All of this was measured on Windows 11 on 2026-09-08, by containing real
commands through `containCommand` and comparing arms. Trust it, but say so if
you contradict it.

1. **A contained `git --version` works with no program root granted.** Exit 0,
   correct output. The image is opened with the launcher's own rights, exactly
   as `src/sandbox/isolation/program-roots.ts` says in its own doc comment.
2. **A contained `git status` and `git init` both fail**, in a workspace under
   the temp directory and in one under the user's home alike, with
   `fatal: unable to get current working directory: Permission denied`.
3. **Contained `node` in the same workspace, under the same policy, reads that
   directory happily** - it lists the workspace contents and exits 0. So the
   containment, the workspace grant and the ancestor traversal are all working
   for at least one program.
4. **Granting read on the ancestors is refused**: the user's home directory
   needs elevation, and the backend's own advice is a machine-wide setup run.
5. Every `C:\Program Files\Git\...` directory on this machine already carries
   `ALL APPLICATION PACKAGES:(RX)` by inheritance, so `grantProgramRoots` skips
   them and no elevation is ever attempted for Git itself.

**The question:** what does git ask of the filesystem that node does not, and
what is the smallest grant that satisfies it?

## What to find out

Answer these in order. Each is a measurement, not an opinion.

1. **What call fails.** Git's message comes from its own `getcwd` path. Find
   out what it actually issues - `GetCurrentDirectoryW`, then what? A path
   resolution that walks ancestors, a `GetFinalPathNameByHandle`, a volume
   query, a short-name lookup. Process Monitor or an equivalent trace is the
   honest instrument here; reasoning from the message is what produced the
   wrong answer last time.
2. **Which object is denied, and which right.** Name the exact path and the
   exact desired access that comes back denied. "The ancestor chain" is not an
   answer; `C:\Users` wanting `FILE_READ_ATTRIBUTES` is.
3. **Whether traverse is the gap.** The backend grants *traverse* on ancestors
   and *read* on the workspace. Establish whether git needs something on the
   ancestors that traverse does not include, and if so exactly what.
4. **The smallest grant that makes `git status` work.** Test candidates
   individually rather than granting everything and declaring victory. Say
   whether each one needs elevation.
5. **Whether this is git-only.** Try python, a compiled binary, and one more
   msys-based program if one is installed. If every msys program fails, that is
   a different and more useful finding than "git is special".
6. **What other harnesses do.** Claude Code, Codex and OpenCode all run git on
   Windows. If they do not use AppContainer at all, say so plainly - that is a
   legitimate finding and it bears on whether our approach is worth keeping.

## Where to look

- `src/sandbox/isolation/windows/appcontainer.ts` - the backend, the grants,
  the ledger, and `grantProgramRoots`.
- `src/sandbox/isolation/windows/traversal.ts` - `holdsRead`, `grantTraverse`,
  and the launcher invocations. The launcher binary is what actually writes
  entries; find it and read what modes it supports.
- `src/sandbox/isolation/program-roots.ts` - the doctrine, including the
  paragraph that says never to grant a program's own directory.
- `src/tools/shell/resolve.ts` and `src/tools/shell/index.ts` - where the
  over-grant enters, at the two `programRoots: granted.directories` sites.
- `documentation/work/toolchain-onboarding-brief.md` - the write-up this
  continues, including the experiment already run.
- ADR 0041 for what the design permits itself to do to a user's disk.

`studio-contain probe` exists for asking the kernel directly rather than
trusting a tool's error text. Use it. The doc comment at the top of
`appcontainer.ts` records a previous investigation that reached a wrong
conclusion by believing `cmd /c dir` - read that story before you start.

## How to answer

**Recommend, do not decide.** Where a fix needs a judgement about how much of
a user's disk we are willing to touch, lay out the options with their costs and
say which you would choose and why. The person reading this decides.

**Separate measured from inferred, in every claim.** The previous round of this
investigation produced a confident, wrong answer by reasoning from an error
message. If you did not run it, say "unverified" in those words.

**Report contradictions.** If something in the five known facts above turns out
to be wrong, say so first and show the measurement that overturns it.

**Cite what you ran.** Every finding should carry the command or trace that
produced it, so the next person can repeat it rather than trust it.

## What not to do

- Do not edit any file under `STUDIO HARNESS/src` or `STUDIO/src`.
- Do not run `pnpm sandbox:prepare` or anything else that permanently changes
  permissions on this machine without saying so first in your report - and
  never anything requiring elevation.
- Do not run the test suites. They rebuild `dist/`, and another agent is
  working in this tree.
- Do not commit anything except your one findings document, and only if you are
  asked to commit at all.
