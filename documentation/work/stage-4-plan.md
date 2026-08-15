# Stage 4 implementation plan — repository and documentation truth

Child of `phases-1-11-remediation.md`. Covers #36–#40, #42, #80, #81, plus the
answered decisions #12, #17, #18 and the optional #78. Retires when the stage
verifies.

**Baseline, measured 2026-08-15 at `924fd43`:** `CI=true vitest run` →
**73 files · 1147 passed · 2 skipped · 0 failed**; `tsc --noEmit` clean;
`flue build --target node` clean. Measured on Node `v22.18.0` against a
`.node-version` pin of `24.14.0` — see #79; every figure here carries that
asterisk.

---

## 1. What the register claimed, and what the docs actually show

Reading first changed four of the eight items. One of them is the whole point
of the stage.

| # | Register said | Reality | Net |
|---|---|---|---|
| 36 | "**Resolved in this change**: ADRs, roadmap, known-issues and status moved to `documentation/`; `STUDIO HARNESS/docs/` deleted. Verify no path references broke." | **Not resolved. The verification step *was* the item, and it was never done.** Eight live references to the deleted `STUDIO HARNESS/docs/` path survive in current architecture docs: `directory-map.md:5,44`, `domain-ownership.md:294`, `mental-model.md:9,10,11,12`. A reader following any of them lands nowhere. | **Reopened** |
| 37 | "Empty root `patches/` directory. Delete." | **Nothing to delete, and there never was.** Git does not track empty directories, so an empty `patches/` folder could only ever have existed on one machine's disk. It is absent now. The issue was filed against a local artifact, not against the repository. | **Withdrawn** |
| 38 | "`domain-ownership.md:30` says `bootstrap.ts:149` will be moved in 008.3-04. It was not; the item is marked Done." | **Larger than "not yet moved".** The sentence describes `new ProviderSettingsStore(getDatabase())` as "the **last** allowed direct call". `getDatabase()` was **deleted** under #24 (`f25d715`) — the only surviving mention in `src/` is its own tombstone comment. So the rule does not describe a pending move; it describes a function that no longer exists, guarding a call that no longer happens. | **Reclassified** |
| 39 | "`api-inventory.md:3` says 3/5 Done; task 008 says 5/5." | Confirmed, and the two "Open" items are now identified precisely: they are the missing grant routes (**#73**) and the missing version header (**#40**). The status line is not merely inconsistent — it is the only place the repository admits those two gaps exist. | **Confirmed + sharpened** |
| 40 | "Promises `X-Project-Studio-API-Version: 1`. `create-app.ts` has no such logic. Implement or stop documenting." | Confirmed by grep across `src/` and the patch. Genuinely an either/or; see §3. | **Confirmed** |
| 80 | Five stale citations found by the audit. | **Six.** The audit found `decisions/README.md` saying "34 ADRs" against 38 actual. There is a *third* count: `mental-model.md:9` says **31**. Three documents, three different numbers, none of them right. | **Larger** |
| 81 | `schema_migration` write-only. | Confirmed: created at `migrations.ts:421`, inserted at `:439`, no `SELECT` in `src/`. One test reads it. | **Confirmed** |
| 17 | Delete five broken `refs/codex/*`. | Confirmed present and broken (`git for-each-ref` warns on each). Destructive, and answered. | **Confirmed** |

---

## 2. #36 is the finding, not the chore

The register recorded #36 as resolved with a trailing instruction — *verify no
path references broke*. That instruction was the entire risk of the change, and
it is the part that did not happen. Moving a documentation tree is safe; moving
it and leaving pointers behind is how a reader ends up trusting a file that no
longer exists.

What survives, and where a reader lands:

| Pointer | Points at | Now |
|---|---|---|
| `mental-model.md:9` | `STUDIO HARNESS/docs/decisions/` — "31 ADRs" | Deleted path, and the count was wrong even then |
| `mental-model.md:10` | `STUDIO HARNESS/docs/STATUS.md` | Deleted, and superseded by the register |
| `mental-model.md:11` | `STUDIO HARNESS/docs/ROADMAP.md` | Deleted, moved to `documentation/` |
| `mental-model.md:12` | `STUDIO HARNESS/docs/KNOWN-ISSUES.md` | Deleted, archived, superseded |
| `mental-model.md:13` | `documentation/check-later.md` | Never existed at that path |
| `directory-map.md:5,44` | `STUDIO HARNESS/docs/decisions/` | Deleted |
| `domain-ownership.md:294` | `STUDIO HARNESS/docs/decisions/0028-*` | Deleted |
| `redaction-rules.ts:17` | `check-later.md` C-12 | Never existed |

`mental-model.md` is the worst of these: it is titled as the orientation
document, and **every one of its five "where to start" pointers is dead.** The
first thing a new reader is handed is a list of five files that are not there.

---

## 3. The one genuine either/or — #40

`api-inventory.md:34` specifies a version header: client sends
`X-Project-Studio-API-Version: 1`, server echoes it, and an unsupported version
gets `410 Gone`. None of it exists.

| | Option | Consequence |
|---|---|---|
| (a) | Implement it | ~30 lines in the admission middleware plus tests. But **there is one client, shipped in the same repository, at the same version, over loopback only.** A version negotiation between two halves of one binary negotiates nothing. It would be ceremony that passes its own tests and protects against a situation that cannot arise while the client is bundled. |
| (b) | **Delete the promise, and record why** | The inventory stops describing a contract nobody implements. The rule that replaces it is honest and shorter: the Harness and its client ship together, so compatibility is a build-time fact, not a runtime negotiation. |
| (c) | Leave it | The state that produced the issue. |

**Recommendation: (b)**, with one condition — the deletion has to say what
*would* bring it back, or the next person re-adds it from first principles. The
condition is a client that ships separately from the Harness: a third-party
client, a remote Harness, or a client updated independently of the binary. None
of those exist today; the first one that does makes this real work rather than
ceremony.

---

## 4. What must not be "fixed" — ADRs are records, not documentation

Two references to superseded files live inside ADR **Context** sections:

- `0015-approval-scope.md:117` — "`T-01` in `KNOWN-ISSUES.md` — the gap this
  closes."
- `0019-running-a-chosen-program.md:20` — "Meanwhile `STATUS.md` and the …"

**These stay.** An ADR records what was true and what was believed at the moment
a decision was taken. Rewriting its Context to match today's file layout would
make the record say something that was not said, which is a worse failure than
a stale path — it is the same instinct that produced the over-claimed statuses
this stage exists to correct. The archive location is added once, at the top of
`documentation/decisions/README.md`, so a reader can find the referenced
material without any ADR being edited.

The distinction that decides each case: **is this pointer something a reader is
meant to follow now, or a description of the past?** The first gets fixed. The
second gets left alone.

---

## 5. Order of work

| Step | Issue | Files | Verify |
|---|---|---|---|
| 1 | #36 | `mental-model.md`, `directory-map.md`, `domain-ownership.md`, `redaction-rules.ts` | zero live references to `STUDIO HARNESS/docs/` outside `archive/` |
| 2 | #80 | `decisions/README.md`, `mental-model.md`, `api-inventory.md`, ADR 0033, ADR 0028 | counts agree with `ls`; no citation resolves to a deleted file |
| 3 | #38 | `domain-ownership.md:30` | the rule describes what the code does now |
| 4 | #39, #40 | `api-inventory.md` | status line true; version header decided per §3 |
| 5 | #42 | `archive/phase-11-mcp/008-*.md` | corrections recorded **as corrections**, not silently re-ticked |
| 6 | #81 | `migrations.ts` or ADR 0010 | the claim and the code agree |
| 7 | #12 | `patches/@flue__cli`, `pnpm-workspace.yaml` | redundant `hostname` hunk gone; suite still green |
| 8 | #17 | git refs | `git for-each-ref refs/codex` silent |
| 9 | #78 (optional) | new test | policy and classify lists asserted equal |
| 10 | #18 | root `README.md` | claims match the register |

After each documentation step: re-grep for the pattern just fixed. After steps
7 and 9: `pnpm typecheck`, `CI=true vitest run`, `flue build --target node`.

---

## 6. Blockers

**None.** Every item here is either answered (#12, #17, #18), a documentation
correction, or a recommendation inside this document (#40, §3).

The three open decisions — #72 eviction policy, #74 desktop environment, #79
Node version — block **Stage 4b and Stage 5**, not this stage. #41 was moved
out of Stage 4 for the same reason: it corrects containment text, and the
containment changes in 4b.

---

## 7. Outcome

*Filled in on completion.*
