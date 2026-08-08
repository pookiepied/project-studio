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
