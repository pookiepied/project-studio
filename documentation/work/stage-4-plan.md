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
| 7 | #12 | ~~`patches/@flue__cli`~~ `patches/@flue__runtime`, `patches/@flue__sdk`, `pnpm-workspace.yaml` | ~~redundant `hostname` hunk gone~~ — **retracted, see §7.** The CLI patch is load-bearing; the step is the two idempotency patches, and it is taken **after** this stage because it changes behaviour |
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

**Closed: #12, #17, #18, #36, #37, #38, #39, #40, #42, #78, #80, #81.**
**Carried out: #41** (to Stage 4b, blocked on #15). Suite at close: **74 files,
1150 passed, 2 skipped, 0 failed**; `tsc --noEmit` clean in the Harness and
`tsc -b --force` clean in the desktop client; `flue build --target node` clean.

### #12, taken last and on its own

It was the only item here that changes behaviour rather than text, so it was
separated from the documentation commit deliberately. Three patches went, not
two: the register had listed `@flue/runtime` and the Harness `@flue/sdk`, and
the desktop client held a third — the same hunks with `index 0000000..0000000`,
meaning `git apply` matched on surrounding context alone and a version bump
whose context still lined up would have applied silently instead of failing
loudly. #44 had already found that; the deletion is where it mattered.

Two things were removed that the plan had not anticipated. `AcceptedRun.requestId`
had no consumer except its own return statement once the key stopped going on
the wire, and the `requestId` parameter threaded through both clients and three
tests with it. Leaving either would have been a hook that reaches nothing —
which is the shape of dead code this cycle exists to delete, not a placeholder
for the future. The future here is Flue admitting a key upstream, and that is a
request to make of Flue rather than a diff to reapply.

The replaced test is the substance of the change. Asserting that an identical
resend produces **two** submissions and **two** turns is a hazard record, not an
endorsement: it makes reintroducing deduplication an argument instead of an
absorption, and it states in the file itself that while this holds, nothing may
retry a send automatically. Mutation-checked non-vacuous — asserting three turns
fails with "got 2", so it is reading real history.

Verifying the desktop client required installing its `node_modules`, which had
never been installed in this cycle. Worth recording: **the client's typecheck
had not been run at any point during Stages 1-4**, so any breakage there would
have gone unnoticed. It is clean, but that was luck rather than coverage.

### What the plan got wrong

Three of this document's own statements did not survive measurement, and they
are worth more than the eleven that did.

**Step 7 was a security regression waiting to happen.** The plan, the register
and the independent audit all said the `@flue/cli` patch's `hostname` plumbing
was redundant because `options.hostname` is native at `flue.js:1254`. All three
read the same grep hit and none checked which side of the call it sat on.
`:1254` *consumes* the option inside `startFlueNodeServer`; our hunk is the call
site that *supplies* it, and it is the only thing that reads
`PROJECT_STUDIO_HARNESS_HOSTNAME`. With no hostname, `flue.js:2221` binds every
interface. Deleting the hunk would have taken the Harness from loopback-only to
network-exposed, against ADR 0028 — and the suite would have stayed green,
because nothing tests the bind address. Three independent readers reaching the
same wrong answer from the same evidence is the argument for measurement over
consensus.

**#17's premise was false and its conclusion was right.** The register said the
five `refs/codex/*` refs "point at nothing reachable". They pointed at intact
tree objects holding an obsolete `Backend/` `Discord Bot/` `api/` `auth/`
layout. Deleting them was still correct — for a different reason, confirmed
before acting rather than after.

**#37 was never a repository issue.** Git cannot track an empty directory, so
an empty root `patches/` could only have existed on one machine's disk.
Withdrawn.

### What the register got wrong, found while closing #42

Two of #42's own shorthands failed the same test. "B-01 against a build that
never worked" — `harness.test.ts:419` is live, unskipped and passing; B-01 fails
for the reason its own Residual column already gave, not because it never
worked. "008.6 no migration" was true when the box was ticked and had since been
closed as #16. Both are corrected in the archived file rather than repeated.

Two defects the register had not recorded at all turned up in the same pass:
008.8 cites **ADR 0034** for a decision that lives in **ADR 0019**, and 008.5
proves credential compensation with `src/application/ports.ts`
`withCompensation` — neither file nor symbol exists.

### The counting habit earned its place again

Recounting the register rather than trusting its headings recovered **#43**,
answered back in Stage 1-2 and folded into #25's row without keeping its number.
Every number 1-81 now appears in exactly one section, verified by script.

### One judgement call worth naming

**#81 was resolved by naming the reader, not by adding one.** `schema_migration`
looked write-only because ADR 0010 said "auditability" without saying whose. Its
reader is a person opening a user's `studio.db` during a support case, which
needs rows and no code; migration control flow correctly uses `user_version`.
Adding an in-product `SELECT` with no consumer would have been exactly the dead
code this cycle exists to delete. Checked before concluding it: the record is
guarded — `storage.test.ts:53` asserts one row per migration, in order, by name.
