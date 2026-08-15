# Tasks

A task is a unit of work with a beginning and an end, written down before it
starts and ticked off while it runs.

This is not a second issue tracker. The three documents keep their jobs:

| Document | Its job |
|---|---|
| `STUDIO HARNESS/docs/ROADMAP.md` | What order to build in |
| `STUDIO HARNESS/docs/KNOWN-ISSUES.md` | What is currently untrue about the system |
| `documentation/check-later.md` | Questions we chose not to answer yet |
| `tasks/` | A batch of work in progress, with a checklist |

A task file exists while the work is open. When every box is ticked, the file
stays as the record of what was done and why — the same way an ADR stays after
the decision is made.

## Structure

Files are grouped by what kind of thing they are, not left flat. Two folders:

| Folder | Holds | Numbered? |
|---|---|---|
| `phase-11-mcp/` | Phase 11 progression plus the ordered Phase 1-11 completion checklist | Yes, within the phase: `002-design.md`, `003-work-plan.md`, `005-loose-ends.md`, `008-phase-1-11-completion.md` |
| `delegation/` | `HOUSE-RULES.md` — the standing rules for any delegated work, live regardless of phase | No |

A finished delegated task's own record — what was sent, what came back, what
review changed — is not kept as a separate file once the work is merged. That
narrative still exists in git history, on the commits and the merged branch;
it is deliberately not duplicated into a living document once the work it
describes is done. What matters going forward — a defect fixed, a rule
decided — is recorded permanently in `KNOWN-ISSUES.md` or an ADR regardless.

A future phase gets its own sibling folder, e.g. `phase-12-skills/`, with the
same `NNN-` numbering restarted inside it — the number is scoped to the
folder, not to `tasks/` as a whole. That is why `phase-11-mcp/` skips straight
from `002` to `003` to `005`: those numbers were assigned before the folder
existed and are kept for continuity with everything that already cites them by
number; a new phase starts its own folder at `001` if it wants to.

**A closed task file is removable once nothing still points at it.** The bar
is not "is this history worth having" — git already has it — it is "does a
current document still name this file." Fix every link before removing a
file, not after.

**One file per phase may be a loose-ends file, and a phase is not finished while
its loose-ends file has an open item.** `phase-11-mcp/005-loose-ends.md` is the
first. It exists because a work plan records *why* each piece was built, which
makes it a poor place to see what is missing: a long entry about a finished piece
reads exactly like a long entry about a half-finished one. The loose-ends file
asks the shorter, harsher question and answers it in a few lines each.

The bar there is stricter than "the code exists": something in `src/` calls it, a
test proves the rule it enforces, and the documentation says why. Two of three is
still a loose end.

See `documentation/DOC-MAP.md` for how this folder fits the rest of the repo,
and for where a new fact should go before you consider adding a new file here.

## Rules

1. Within a phase's own folder, number files in order: `001-`, `002-`. Never
   renumber.
2. One checkbox per item. An item is one commit-sized piece of work.
3. Every item says what is wrong, where, how it was proven, and what the fix is.
4. **"How it was proven" is required.** An item nobody verified is a guess, and
   a guess in a checklist looks exactly like a fact.
5. Tick a box only when the code is changed AND a test covers it.
6. When the task closes, move each item to `KNOWN-ISSUES.md` as Fixed, or record
   why it was dropped.

## Branches

There is one long-lived branch, `main`, and it is always green. Everything else
is a short branch named after the task that opened it.

| Who | Where they work |
|---|---|
| Delegated model | `task/<name>`, always. Never `main` |
| Reviewer, integrating | `main` directly |

**The delegate never merges its own work.** It commits to its branch and stops.
The reviewer reads the diff, applies corrections on top of that branch, runs
`pnpm check`, merges, and deletes the branch. A branch that merged itself is a
review that did not happen.

**Fast-forward when the history allows it.** These branches are short and
`main` rarely moves underneath them, so a merge commit would add a node that
records nothing. If `main` has moved, rebase the branch onto it and then
fast-forward — the branch is one commit, so there is nothing to untangle.

**Delete the branch on merge.** The commits are on `main`; the branch name is
now a second, ageing answer to where the work is.

**One working tree, so branches do not isolate anyone.** The delegate and the
reviewer check out branches in the same folder. A branch protects the *history*;
it does nothing about the files on disk, and switching a branch under someone
else's uncommitted work is how a file ends up in the wrong commit.

This has already happened once: a delegate left the tree on its own branch, work
continued on top of it, and a delegate's in-progress file was swept into a
reviewer commit by a directory-wide `git add`. Caught by reading
`git show --stat` and amended out.

Three rules follow, and the third is the one that actually prevents it:

1. **Check `git branch --show-current` before committing.** Every time.
2. **Read `git show --stat` after committing.** A commit is not done until you
   have seen its file list.
3. **Never `git add` a directory.** Name the files. A directory grows between
   the moment you decide to commit and the moment you type it.

If the two of you start overlapping often, the real fix is `git worktree` — a
second folder for the delegate, sharing one history. Not needed while tasks are
handed out one at a time.

**Do not keep working on a branch after merging it.** This has already gone
wrong once: review finished on `task/003-5-destination-guard`, three unrelated
commits followed on the same branch, and the branch name went on claiming to be
about the destination guard while it held the extend spine. Nothing was lost and
the name lied, which is the whole failure. Check out `main` the moment a review
ends.
