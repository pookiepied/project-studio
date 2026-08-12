# Meta instructions — how to work on Project STUDIO

Terse, operational, checkable. If you want the readable version instead, see
`documentation/PHASE-11-OVERVIEW.md`. This file is the one to follow while
working; that one is the one to read to understand.

---

## 1. What to read, and in what order

See `documentation/DOC-MAP.md` for the full tree and where a new fact goes.
The short version, almost always the whole of it:

1. `tasks/delegation/HOUSE-RULES.md` — the constraints.
2. `tasks/phase-11-mcp/003-work-plan.md` — newest section only, what was just built.
3. `tasks/phase-11-mcp/005-loose-ends.md` — what to do next.
4. `STUDIO HARNESS/docs/STATUS.md` — the current snapshot, to sanity-check 2 and 3.

Everything else — ADRs, `check-later.md`, `KNOWN-ISSUES.md`, `mental-model.md`,
`architecture.md` — is reference, opened only when one of the four above names
it. `DOC-MAP.md` has the full tree and the routing table; this file does not
repeat it.

## 2. How Phase 11 is organized

Phase 11 is "MCP" and is broken into numbered sub-items, `003.1` through
`003.8`, tracked in `tasks/phase-11-mcp/003-work-plan.md`. Loose ends within it
are `L-01` through `L-11` in `tasks/phase-11-mcp/005-loose-ends.md`.

**The rule for calling something done**, from the loose-ends file header:
something in `src/` calls it, a test proves the rule it exists to enforce, and
the documentation says why. Two of three is still a loose end.

Current state, checked against the file directly (not memory) as of this
session:

| Item | State |
|---|---|
| `L-01` registerOwnPort had no caller | done |
| `L-02` direct HTTP client | done |
| `L-03` Streamable HTTP transport | done |
| `L-04` the launcher | done |
| `L-05` supervisor keyed on launch, not id | done |
| `L-06` tool-definition hash not on a grant | open |
| `L-07` revoke has no caller | open |
| `L-08` honest silence (003.7) | open, not started |
| `L-09` nothing is wired (003.8) | open, not started — the largest item |
| `L-10` `E-02` harness test times out intermittently | open, instrumented, cause unknown |
| `L-11` `E-03` raw errors in setup CLI | open, small |

Verify this table yourself before trusting it — read
`tasks/phase-11-mcp/005-loose-ends.md` directly. This table is a snapshot and
will go stale the moment another item closes.

## 3. What "done" requires, every time, no exceptions

1. Write the test first (or alongside), matching a neighbouring test file's
   style exactly.
2. **Break the code the test covers** — delete the line, invert the condition.
3. Run it and confirm it actually fails.
4. Restore the code.
5. Run the full suite (`CI=true pnpm check` from `STUDIO HARNESS/`) and
   confirm it is green before calling anything finished.

A test that never failed against broken code proves nothing. This is not
optional and is checked, not assumed.

## 4. What happens to a defect found along the way

**Found defects get fixed in the same pass, or explicitly filed — never
silently carried.** Three outcomes, and only three:

- **Fixed.** Changed and tested in the same commit as the work that found it.
  Recorded in `KNOWN-ISSUES.md` as Fixed, with what it was and why it happened.
- **Filed as Open**, in `KNOWN-ISSUES.md`, when fixing it is a different piece
  of work than what is currently in flight. Says why it is waiting.
- **Filed as Accepted**, when it is a real limitation being knowingly lived
  with. Says why, so it is a decision and not neglect.

Never: found, mentioned once, and left with no entry anywhere. If you find
something and are not fixing it now, it must exist in `KNOWN-ISSUES.md` before
you move to the next task, or it did not happen as far as the next person is
concerned.

## 5. How an issue, block, or open question gets routed

Same table as `documentation/DOC-MAP.md`, with the id-series detail that table
leaves out. Ask these in order:

1. **Is it a defect in existing, already-shipped code?** →
   `STUDIO HARNESS/docs/KNOWN-ISSUES.md`. Give it the next id in its letter
   series (`A-`, `T-`, `P-`, `K-`, `S-`, `E-`, `V-`, `D-`, `H-`, `M-`, `O-`).
   State: Open, Fixed, Accepted, or Contained.
2. **Is it a design question with no answer yet, blocking nothing right
   now?** → `documentation/check-later.md` as the next `C-NN`. Gate it against
   whatever has to happen before it can be answered.
3. **Is it a known-incomplete piece of Phase 11 work?** →
   `tasks/phase-11-mcp/005-loose-ends.md` as the next `L-NN`, or fold into an
   existing one if it is the same item.
4. **Is it a decision that changes how a rule works, once made?** → a new
   numbered ADR in `STUDIO HARNESS/docs/decisions/`, stating what it amends.
5. **Does the current snapshot need updating because of any of the above?** →
   update `STUDIO HARNESS/docs/STATUS.md` last, after the source-of-truth file
   is correct. Never the other way around.

If genuinely blocked — a decision only the project owner can make, not a
technical unknown — say so plainly and stop rather than guessing and writing
it down as settled.

## 6. Commit discipline for this repository

- One commit per closed item, imperative subject, body says **why** not what.
- Update the loose-ends file, the work-plan file, `check-later.md` (if it
  touches an open `C-NN`), `KNOWN-ISSUES.md` (if a defect was found), and
  `STATUS.md` — in the same commit as the code, not a follow-up.
- `MCP/studio-web-mcp/src/validation/url.ts` has uncommitted changes that are
  not this work's — leave unstaged, always.
- No new dependency, ever, for this project. Node's standard library and what
  is already in `package.json`.
- ASCII only in source. No scripted search-and-replace across files — edit by
  hand. This has been stated as a hard constraint by the project owner more
  than once.

## 7. Before reporting anything "done" to the project owner

- Re-open `tasks/phase-11-mcp/005-loose-ends.md` and confirm the item's own entry
  says done, with the reasoning, not just that you believe it.
- Re-run the full suite once more, fresh, and quote the pass count.
- State plainly which defects were found and fixed in the same breath, so
  "did you fix it or just report it" never has to be asked twice.
