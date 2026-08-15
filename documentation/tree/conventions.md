# Tree conventions

The rules for how work is recorded. They are short on purpose: a convention
nobody can remember is a convention nobody follows.

## 1. Everything is a node, and every node has a parent

A node is one meaningful unit of work or knowledge. Six kinds:

| Kind | Id | Lives in | Answers |
|---|---|---|---|
| Phase | `P-NN` | `phases/<product>/` | What was this stage of the product meant to deliver? |
| Task | `T-NNN` | `tasks/` | What was built, and is it verified? |
| Audit | `A-NNN` | `audits/` | Does the built thing actually hold up? |
| Decision | `D-NNN` | `decisions/` | Why is it this way and not another way? |
| Blocker | `B-NNN` | `blockers/` | What is stopping work, and what would unstop it? |
| Follow-up | `F-NNN` | `follow-ups/` | What did we deliberately postpone? |

Ids are permanent. A node is never renumbered and never deleted — it is
resolved, superseded, or abandoned, each of which is a status, not an erasure.

**Every node names its parent.** That is what makes it a tree rather than six
folders. A task without a parent is work nobody asked for.

## 2. The tree branches from where work actually came from

Work does not arrive in a straight line. When an audit spanning phases 1–11
finds eight problems, those problems are children of *the audit*, not
retrofitted into whichever phase they happen to touch:

```
Phase 1 .. Phase 11
        │
        └── Audit A-002
              │
              └── Task T-003  (remediation)
                    ├── fix 1
                    └── fix 2
```

Forcing a finding into a phase it half-belongs to is how provenance gets lost.
If work came from an audit, its parent is the audit.

## 3. Status means the same thing everywhere

| Status | Meaning |
|---|---|
| `Planned` | Written down, not started. |
| `In progress` | Being worked on now. |
| `Implemented` | Code exists and is believed correct. **Not** complete. |
| `Verified` | Implemented, plus proof — see rule 4. |
| `Blocked` | Cannot proceed; names the blocker node. |
| `Deferred` | Deliberately postponed; names the follow-up node. |
| `Abandoned` | Will not be done; says why. |
| `Superseded` | Replaced; names the node that replaced it. |

`Implemented` and `Verified` are different words because they are different
states, and the gap between them is where this project has previously lost
track of itself.

## 4. Verified requires proof, and "the file exists" is not proof

A node reaches `Verified` only with:

- a **named test** that fails if the work regresses, or a recorded manual
  procedure and its result;
- the **verification command actually run**, with its outcome recorded;
- the **commit** that carries it.

Source existing, a checkbox ticked, or a summary asserting success are not
proof. Neither is a test written to assert the current behaviour whatever it
is — see rule 5.

## 5. A test that passes while the defect is present is worse than no test

If a check cannot yet be satisfied, the honest form is a failing or skipped
test naming the reason, or an entry in `follow-ups/`. It is never a test
inverted to assert the violation.

> This rule exists because it was broken. The 008.3 architecture tests were
> written as `expect(offenders.length).toBeGreaterThan(0)` — green *because*
> the violation was present, and destined to fail once it was fixed. See
> `audits/A-002-sanitary-check-008-3-008-8.md`.

## 6. Git carries what changed; nodes carry what and why

Do not paste diffs or narrate edits into a node. Record the commit hash and
let `git show` answer "what changed". A node answers what the work was, why it
existed, what was decided, and whether it is proven.

Commit subjects reference their node: `fix(harness): ... (T-004)`.

## 7. Nothing is postponed in someone's head

A thing consciously not done becomes a node before the session ends —
`follow-ups/` if optional, `blockers/` if it stops something. "We should come
back to this" said aloud and written nowhere is how the project drifts.

## 8. The map and the tree are updated last, and always

After the source node is correct, update `tree/project-tree.md` and, if the
shape of the project changed, `PROJECT-MAP.md`. They are derived views: they
must never be the only place a fact lives.

## 9. Documentation and code are checked against each other

Neither is automatically right. When they disagree, the disagreement itself is
a finding — record it, then fix the wrong one. A doc describing behaviour the
code does not have is a defect in the doc.

## Node template

```markdown
# <ID> — <title>

**Parent:** <node id, or the phases this came from>
**Status:** <status>
**Owner:** <who>
**Opened:** YYYY-MM-DD · **Closed:** YYYY-MM-DD or —

## What and why
One paragraph. What this is, and what made it necessary.

## Requirement
What must be true for this to be done.

## What was implemented
Where it lives in the codebase. Paths, not prose.

## Verification
Command run, result, test names, commit.

## Notes
Deviations, trade-offs, things the next reader needs.

## Links
Related nodes.
```
