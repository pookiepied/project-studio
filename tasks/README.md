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

## Rules

1. Number files in order: `001-`, `002-`. Never renumber.
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

**Do not keep working on a branch after merging it.** This has already gone
wrong once: review finished on `task/003-5-destination-guard`, three unrelated
commits followed on the same branch, and the branch name went on claiming to be
about the destination guard while it held the extend spine. Nothing was lost and
the name lied, which is the whole failure. Check out `main` the moment a review
ends.
