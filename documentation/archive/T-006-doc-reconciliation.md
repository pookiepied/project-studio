> **Superseded — archived 2026-08-15.** Kept for provenance, not as current
> guidance. The live source of truth is
> `documentation/work/phases-1-11-remediation.md`.

# T-006 — Documentation reconciliation

**Parent:** `A-002` (SF-08), `A-003`
**Status:** Planned
**Opened:** 2026-08-15 · **Closed:** —

## What and why

Documents describe behaviour the code does not have, and task 008 records items
Done that later checks did not support. Per `tree/conventions.md` rule 9,
neither side is automatically right — but these are cases where the code is
right and the document is wrong.

## Requirement — correct the false claims

- `architecture/domain-ownership.md:30` — says `bootstrap.ts:149` "will be moved
  in 008.3-04". It was not, and that item is marked Done.
- `architecture/api-inventory.md:3` — says 3/5 Done; task 008 says 5/5.
- `architecture/api-inventory.md:30` — promises an
  `X-Project-Studio-API-Version: 1` response header. `create-app.ts` has no such
  logic. Either implement it or stop documenting it.
- Stale containment claims in `README`, `STATUS.md`, ADRs 0019/0022/0024, and
  `KNOWN-ISSUES.md` — `008.8` decided uncontained-by-policy, so text describing
  connected MCP code as contained is now false.

## Requirement — re-state the over-claimed statuses

In task 008, with the reason and a link to the node that found it:

| Item | Recorded | Actual |
|---|---|---|
| `008.3` | Done 13/13 | Exception, not fix; tests inverted (`A-002`) |
| `008.4` | Done 5/5 | 3/5; version header absent from code |
| `008.4` B-01 | Done | Path never worked (`A-003` AF-01a); back to Blocked |
| `008.6` | Done 14/14 | `pending_approval` promised, no migration |
| `008.8` | Done 3/3 | Decision done, implementation 0% |

**Then** update `STATUS.md` — last, once the sources above are correct.

## Requirement — the two documentation systems

Point current readers at `documentation/tree/project-tree.md`. Historical audit
evidence stays; it just stops being the current answer. `archive/DOC-MAP.md` is
superseded by `PROJECT-MAP.md` and should say so at the top rather than reading
as live guidance.

## Notes

Do not quietly re-tick a box after fixing the thing. The record that it was
over-claimed is the useful part — it is what tells the next reader which
checkmarks to distrust.

## Links

- `A-002` SF-08, `A-003`, task 008 `008.22`.
