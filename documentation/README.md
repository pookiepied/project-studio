# documentation/

How Project Studio is managed. The code lives in `STUDIO HARNESS/`, `STUDIO/`,
and `STUDIO Gateway/`; this folder is how we keep track of it.

## Start here

1. **`tree/conventions.md`** — how work is recorded. Six node kinds, eight
   statuses, nine rules. Read once.
2. **`tree/project-tree.md`** — what is done, what is not, what is blocked.
3. **`PROJECT-MAP.md`** — where everything lives, if you need to find something.

Then open the node you are working on. Everything else is reference.

## The idea in one paragraph

Every significant piece of work is a node with a permanent id and a named
parent. Phases produce tasks; audits check them; findings become new tasks whose
parent is the audit that found them, not the phase they happen to touch. A node
is `Verified` only with a named test, a command actually run, and a commit —
`Implemented` and `Verified` are deliberately different words. Git records what
changed; nodes record what the work was and why. The tree is what lets us answer
"why does this exist" without guessing from old code.

## The folders

| Folder | What it holds |
|---|---|
| `tree/` | The conventions and the current tree. |
| `phases/` | What each stage of a product was meant to deliver. |
| `tasks/` | Work: planned, in progress, done. Includes the preserved `phase-11-mcp/` task files. |
| `audits/` | Checks on work already done. |
| `decisions/` | Choices with alternatives, at project level. Harness-internal rules stay as ADRs in `STUDIO HARNESS/docs/decisions/`. |
| `blockers/` | What is stopping progress and what would unstop it. |
| `follow-ups/` | Deliberately postponed. Includes the `C-NN` open-questions register. |
| `architecture/` | How the system is shaped — mental model, directory map, domain ownership, API inventory. |
| `archive/` | Superseded. Kept for provenance, not for reading. |

`HOUSE-RULES.md` sits at the top level because it applies to all work and fails
it outright if broken.

## Adding to it

`PROJECT-MAP.md` has the table for where a new fact goes. If nothing fits, the
structure is wrong — fix the structure rather than adding a seventh place to
look.

Two things the conventions are strict about, both because they were broken:

- **A test must fail when the thing it names is broken.** Not the reverse.
- **Anything postponed gets written down before the session ends.**
