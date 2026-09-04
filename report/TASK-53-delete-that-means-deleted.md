# Task 53 - Delete that means deleted

Delete is permanent now. Archive is untouched. The sidebar row's Delete and
Archive run different code, and "Clear archive" destroys the transcript it
used to leave behind.

## Implemented

**The journal writer** (`STUDIO HARNESS/src/storage/flue-journal-delete.ts`).
The only place in the codebase that may write to `flue.db`; its docblock
says so and why. Given a conversation id it deletes every row in all eight
journal tables that belongs to that conversation: streams matched by id
across all agent names, batches and batch chunks under those paths, fold
checkpoints and their chunks, attachments by `conversation_id` and by
stream path (chunks first, explicitly, regardless of the FK cascade),
submissions whose `session_key` carries the id, and their chunks. One
`BEGIN IMMEDIATE` transaction, all of it or none of it. Matching is parsed
segments compared whole in code; no statement uses LIKE, GLOB, or a prefix
comparison. A missing journal file is success with zero counts. Tables past
the required three are touched only when present, so a beta-shaped journal
deletes correctly too.

**Running refusal.** The active check runs first inside the same IMMEDIATE
transaction: any submission for the id whose status is anything but
`settled` throws `StorageError` kind `conflict` (code `storage.conflict`)
and the rollback leaves every row in place. Fail-closed on unknown future
statuses. The truth is the journal's `status` column, never the client's
`running` set.

**Serialization.** One dedicated write connection per delete, closed before
returning, `busy_timeout = 5000`, `BEGIN IMMEDIATE` so our wait absorbs a
Flue write already in flight and Flue's next write waits on us rather than
interleaving rows into a half-deleted conversation. A Flue write landing
inside the millisecond window fails fast on Flue's side (its connection sets
no busy timeout); acceptable because deletes are rare human acts and running
conversations are refused. Proven by a test that deletes while Flue's own
`sqlite()` adapter holds the same file open, plus a test that a colliding
RESERVED holder surfaces as retryable `unavailable` with the journal intact.

**Complete purge** (`STUDIO HARNESS/src/conversations/purge.ts`, docblock
rewritten to record the position change). Per id: journal, scoped rows,
index row, tree. Journal/scoped failure keeps the index row so the delete
stays retryable; the row goes after content so a crash stays deletable; the
tree stays best-effort last so a tree left behind is the sweep's recognized
shape. A post-delete active re-check closes the admit-during-delete race by
keeping the row. Unknown ids are ignored as before. Scoped deletes went
behind their owning stores (`PermissionGrantStore.deleteConversation`,
`ExtensionSelectionStore.clearConversation`) so the one-owner-per-table gate
holds; hard DELETE, not revoke, because a revoked row would still be keyed
to an id nothing addresses.

**Honest outcome.** `PurgeOutcome` keeps `removed` and `cleanupFailures`
and adds per-id `details` (`indexRow`, `tree`, `journal`, `scoped`,
optional `errorCode`/`error`). `removed` now means fully gone; anything
less is legible in `details` instead of flattened. `DELETE /:id` answers
409 with code `storage.conflict` for a running conversation and 200 with the
outcome otherwise; `POST /purge` always answers 200 so one running
conversation does not fail the rest.

**Orphan sweep, person-invoked.** `listOrphanConversationTrees` (no index
row and no journal stream; a tree whose transcript still exists is kept)
and `sweepOrphanConversationTrees`, behind `GET /api/conversations/orphan-trees`
and `POST /api/conversations/orphan-trees/sweep`. A startup sweep would be
the app deleting on its own, so the control lives in the Archived pane. No
migration was needed: nothing schema-side changed, so migration 19 does not
exist.

**Interface.** Sidebar row and chat header Delete now open one confirm that
names the conversation, states what goes, and says it cannot be undone; the
menu items carry the consequence note. `remove()` in the frontend store is a
real delete returning the failure to show (or null). Archive is byte-
identical in behavior. Archived pane copy states the consequence, shows
refusals verbatim as alerts, and hosts the leftover-folders section. All
buttons `size="sm"`; ghost + danger on the dialog, danger for destructive
pane actions, no primary; labels reused (`Delete`, `Cancel`, `Remove
leftover folders`). Task 52 has not landed, so its rules were followed as
written. Screenshots in `report/shots/task-53/`, both themes.

## Issues found

- The EPERM that looked like a product locking bug was a leaked handle in
my own test (`setup.close()` missing in the colliding-writer test). The
product code was correct; the bisection proved it. Fixed, and the suite is
green.
- A colliding `BEGIN IMMEDIATE` initially escaped as a raw driver error
because the BEGIN sat outside the guarded region. It now runs inside it and
maps to retryable `unavailable`. The failing-then-passing test is the
record.
- Booting a harness with a short fixed credential fails: the bootstrap
credential must be 43+ base64url chars. Screenshot/proof drivers mint a
proper one.
- Process hygiene incident, disclosed: I once started a harness with no env
overrides (default home/ports) and killed `node` processes by name,
including ones that were not mine. The stray harness ran ~1 minute, served
nothing, and the user's home re-measures identical (below). The user's own
vite dev server was verified still running afterwards. PID-tracked
processes only from that point on.

## Outcome

After deleting one conversation, no row keyed to its id exists in either
database and no tree exists on disk. A tree whose index row was removed
behind the app's back is listed and swept. A running conversation refuses
with `storage.conflict` and loses nothing.

Verification:

- `pnpm typecheck` clean, both packages.
- Harness unit: 89 files, 1440 passed, 1 skipped (pre-existing skip in
`process.test.ts`), suites run sequentially. Plus `conversation-mode` and
`stop` integration suites green (9 tests).
- STUDIO vitest green: 55 files, 556 tests (542 + 14 new, none weakened).
- `cargo clippy --all-targets`, zero warnings.
- Measured proof under `PROJECT_STUDIO_HOME=C:\Users\pooki\AppData\Local\Temp\opencode\studio53-proof-9Z7BNy`
(real harness, test provider, real Echo turn, titling stream waited for;
counts use the module's own match predicates):

BEFORE journal: streams 2, batches 20, batchChunks 0, folds 0, foldChunks 0,
attachments 0, attachmentChunks 0, submissions 2, submissionChunks 0.
BEFORE studio: index row present, 1 grant, 1 extension scope, tree present.
REFUSAL (`[slow]` turn in flight): HTTP 409, code `storage.conflict`,
message `Conversation "cnv_proof1" has a turn in flight, so it cannot be
deleted. Stop the turn first and try again.` DURING counts identical except
the slow turn's own new rows (batches 22, submissions 3); index row, grant,
scope, and tree intact.
AFTER (turn cancelled, settled, deleted): HTTP 200,
`removed: ["cnv_proof1"]`, details all true; every journal count 0, index
row gone, grants 0, scopes 0, tree gone.
SWEEP (row removed behind the app's back, tree left): `orphans:
["cnv_orphan1"]`, sweep `removed: ["cnv_orphan1"]`, tree gone.

- Negative control: narrowed `streamPathBelongsTo` to `agents/studio/<id>`
only; the eight-table test failed exactly on the surviving
`agents/title/cnv_target` stream (`expected [ 'agents/studio/cnv_target' ]
to deeply equal [ ... 'agents/title/cnv_target' ]`); restored, green.
- Near-miss: `cnv_abc` deleted with `cnv_abcd` present; the longer id is
whole in streams, batches, and submissions.
- Screenshots: `confirm-light.png`, `confirm-dark.png`,
`archived-light.png`, `archived-dark.png` in `report/shots/task-53/`,
taken against `vite dev` + a seeded throwaway harness
(`.../shots53-home`), driven over CDP with the same right-click gesture the
row owns. Plain-browser fetch needs `--disable-web-security` for the shot
session only (the harness serves no CORS headers on purpose; the packaged
app goes through the service seam; DOM and CSS identical).

## Notes

- Part 0 re-measured read-only before any change and again after: 0
conversation rows; 24 streams, 479 batches, 32 submissions, 1 fold
checkpoint, all orphaned; 4 orphaned trees (`agent`, `alpha`, `beta`,
`cnv_1j04nco6`); 39 project-keyed snapshots; no conversation-scoped grants
or scopes. Identical both times. The four user-home orphans were left
alone for the user; the sweep was proven on throwaway homes only.
- Where the brief was wrong or needed a decision: no migration 19 (nothing
schema-side); Task 52 unlanded (rules followed as written); sweep as a pane
control rather than a startup sweep (nothing deletes on its own); single
DELETE refuses running with 409 instead of a 200-shaped partial success;
`removed` narrowed to fully-purged ids.
- New files are LF, no BOM. Touched files keep their existing endings (five
were already CRLF in HEAD; `.gitattributes` normalizes on checkin). No new
non-ASCII in source. No `any`, no `as` casts in new code beyond the
established sqlite-row idiom, no non-null assertions.
