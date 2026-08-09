# Task 001 — Fix Everything The Cross-Reference Audit Found

**Opened:** 2026-08-09
**State:** closed — 20 of 20 done, commit `d4b2a03`
**Baseline commit:** `423999e`
**Closes when:** every box is ticked, `pnpm check` is green, and each item is
recorded in `KNOWN-ISSUES.md`.

## What this task is

Five reviewers read all 21,274 lines of the harness — 11,736 source, 6,804
test, 2,734 documentation. They raised 22 complaints. I verified each one
against the code. **20 were valid. 2 were rejected.**

Nothing here is a regression. Every item shipped while we believed otherwise.

Two of the twenty let a model run any program on the machine. Those go first.

## How to use this file

Tick a box only when the code is changed **and** a test covers it. Add the
commit hash next to the box. If an item turns out to be wrong after all, do not
delete it — change it to `[~]` and write why.

---

## Group 1 — A model can run any program (do these first)

### [x] 1. `git` long options can be shortened past the blocklist · `T-23` · `2c7bdc0`

**Where:** `STUDIO HARNESS/src/tools/git/argv.ts:105-112`

**What is wrong:** Git accepts a shortened long option when the short form is
unambiguous. `BLOCKED_OPTIONS` is a `Set` and `optionName()` returns the option
verbatim, so the check is an exact string match. `--upload-pac` is not in the
set. Git expands it to `--upload-pack` and runs the named program.

**Proven by running:**
```
git fetch --upload-pac=cmdthatdoesnotexist999 origin
  → cmdthatdoesnotexist999 'origin': command not found      it RAN
git fetch --zzzznope=1 origin
  → error: unknown option `zzzznope=1'                      control
```

**Why it is the worst item here:** `GIT_DESCRIPTOR` declares `read`/`write`, so
this is not gated as execution. It needs no sandbox permission. Under Auto Edit
it would need no prompt.

**Fix:** Stop matching whole names. Refuse any option that is a prefix of a
blocked option, and refuse any blocked option that is a prefix of the argument.
Cover `--exec`, which is itself a prefix of `--exec-path`. Add a test for every
blocked option truncated to each length that is still unambiguous.

**Done.** `reachesBlockedOption()` in `argv.ts` matches in both directions: the
argument is refused if it is a prefix of a blocked option or if a blocked option
is a prefix of it. `--` alone is excluded, because it is the end-of-options
marker and an abbreviation of nothing.

This over-refuses some abbreviations of harmless options — `--wo` is turned down
because it could reach `--work-tree`. That is the intended trade. The caller can
spell the harmless option in full, and we never have to track which
abbreviations a given subcommand happens to find unambiguous.

**Tested by:** three cases in `tests/unit/tools/git.test.ts`, one of them
exhaustive — every blocked option truncated to every length above `--`.
Reverting the check to the old exact match fails 2 of them.

---

### [x] 2. A chained git alias defeats the shell-alias check · `T-24` · `2c7bdc0`

**Where:** `STUDIO HARNESS/src/tools/git/index.ts:60-79`

**What is wrong:** `assertNotShellAlias` reads `alias.<subcommand>` once and
refuses only if the value starts with `!`. Git follows an alias that names
another alias.

**Proven by running:**
```
alias.y = !echo PWNED_BY_CHAINED_ALIAS
alias.x = y
git config --get alias.x   →  y            our check sees this, allows it
git x                      →  PWNED_BY_CHAINED_ALIAS
```

**Fix:** Follow the chain. Read `alias.<name>`; if the value does not start with
`!`, take its first word and read that alias too. Stop at a depth limit — git
itself stops at 10 — and refuse a loop. Test two levels and a cycle.

**Done.** `assertNotShellAlias` now loops to `MAX_ALIAS_DEPTH` (10), keeps a
`seen` set, and refuses a cycle by name. It stops at the first known subcommand
or at a name that is not an alias.

**One thing the audit did not name, fixed with it:** the expansion's own
arguments are now put through `buildGitArgs` as well. `alias.a = log
--upload-pack=sh` reaches a blocked option by a route that never passes the
normal check, because the caller only ever typed `a`.

**Tested by:** four cases — a two-level chain ending in `!sh`, a cycle, an alias
reaching a blocked option, and a two-level chain that must still work. Cutting
the depth back to one fails 4 tests.

---

## Group 2 — A security boundary that does not hold

### [x] 3. The migration guard runs once, then never again · `D-01` · `516aead`

**Where:** `STUDIO HARNESS/src/storage/migrations.ts:205-207` and `:237`

**What is wrong:** `assertNoSecretColumns` is called after the migration loop.
`migrate()` returns early at line 205 when `current === latest`. Each migration
commits and bumps `user_version` on its own (line 229-230). So a migration that
adds a credential column commits first, the guard throws once, and the column
and the new version are both on disk. On the next start `current === latest`,
the function returns at line 205, and the guard never runs again. The
application starts normally, forever, with the column present.

**Fix:** Call `assertNoSecretColumns` before the early return as well — on every
open, not only after a migration. Better: call it inside each migration's
transaction, so a bad migration rolls back instead of committing. Test that a
second `openDatabase` on a poisoned file still fails.

**Done.** Both, as the item suggested. The guard now runs inside each
migration's transaction, so a bad migration rolls back instead of committing,
and again at the top of `migrate()` on every open, before the early return.

**One thing found while fixing it:** the catch block wrapped our refusal in
`storageErrorFrom`, which replaced the message naming the column with the
generic "schema could not be prepared". A `StorageError` is now rethrown
untouched. The guard was reporting the one thing the reader cannot act on.

**Tested by:** a migration that adds `api_key` must leave `user_version` at 0
and the table absent, and a second `migrate()` on an already-poisoned database
must still throw. Reverting the placement fails both.

---

### [x] 4. The secret-column pattern misses obvious names · `D-02` · `516aead`

**Where:** `STUDIO HARNESS/src/storage/migrations.ts:161-162`

**Proven by running the real regex:**
```
CAUGHT   api_key  refresh_token  access_token  password  client_secret
MISSED   secret_key  encryption_key  signing_key  api_key_hash
MISSED   private_key_pem  auth_token_value
```

`max_tokens` and `tokens` are also missed, and that is correct — they are
counts, and the comment says so.

**What is wrong:** The pattern anchors the keyword at the end. Any suffix after
it escapes, and bare `_key` is not a keyword at all.

**Fix:** Add `key` as a word anywhere in the name, not only as `api_key` or
`private_key`. Allow a suffix after the keyword. Keep `max_tokens` passing —
that exclusion is deliberate and a guard that cries wolf gets deleted. Test
every name in the list above, in both directions.

**Done.** The regex is replaced by word matching. A column name is split on
`_`, `-`, and camel-case boundaries, and any word in `SECRET_WORDS` refuses it —
so a suffix no longer escapes and bare `key` is a keyword now.

Two deliberate exceptions, both written down in code rather than hidden in a
pattern:

- `NOT_SECRET_COLUMNS` — an allowlist holding `key` and `capability_key`, the
  two columns we ship that contain the word. `key` is too common to refuse on
  sight and too dangerous to ignore, so the default is refuse and each exception
  is argued once.
- `MEASUREMENT_WORDS` — `token` beside `count`, `total`, `usage`, `limit`,
  `max`, or `used` is accounting, not a credential. This excuse belongs to
  `token` alone, so `token_secret_count` is still refused.

**Tested by:** 14 names that must be refused and 6 that must pass. Restoring the
old regex fails the first group.

---

### [x] 5. An Anthropic API key is not redacted · `O-01` · `afcc448`

**Where:** `STUDIO HARNESS/src/observability/redaction.ts:4`

**Proven by running the real regex:**
```
REDACTED  sk-abcdefghijklmnopqrst
LEAKED    sk-ant-api03-AbCdEfGh1234567890abcdefXYZ
LEAKED    sk-proj-AbCdEfGh1234567890
```

**What is wrong:** `/\bsk-[A-Za-z0-9]{10,}\b/g` allows no hyphen after `sk-`.
Real keys have several.

**Why it matters here more than elsewhere:** This is a Claude product. The key
format most likely to reach these logs is the one the redactor cannot see.

**Fix:** Allow hyphens inside the body. Test the Anthropic and project-key
shapes, and keep a test proving an ordinary hyphenated word is not redacted.

**Done.** The body allows hyphens: `/sk-[A-Za-z0-9-]{10,}/g`. Prose is not
at risk, because `` before `sk-` means the word has to start there —
`task-manager` and `ask-me-anything` do not match.

**Tested by:** the Anthropic, project, and plain shapes are all redacted, and a
sentence of hyphenated words comes back unchanged. Restoring the old pattern
fails the first test.

---

### [x] 6. A writable root is checked with a string prefix · `S-03` · `afcc448`

**Where:** `STUDIO HARNESS/src/sandbox/policy.ts:92`

**What is wrong:** `root === readable || root.startsWith(readable)`. This is the
exact anti-pattern `sandbox/paths.ts:14-16` documents and solves — it says in
so many words that `/work` is a prefix of `/work-secrets`. `isInsideRoot`
already exists, ten lines away, and does this correctly.

**Failure:** `createSandboxPolicy({ workspaceRoot: "/home/u/work", writeRoots:
["/home/u/work-secrets"] })` is accepted. A writable root sits outside every
readable root, which the function's own comment says must never happen.

**Fix:** Use `isInsideRoot`. Test the sibling-with-shared-prefix case, which the
current test misses because it only uses a sibling with an unrelated name.

**Done.** `createSandboxPolicy` now calls `isInsideRoot`, the primitive written
for exactly this ten lines away.

**Tested by:** `…/work` with a writable `…/work-secrets` must be refused, and a
writable `…/work/src` must still be accepted. Restoring the prefix form fails
the first.

---

## Group 3 — Wrong behaviour

### [x] 7. A cancelled call kills every other caller's token refresh · `A-01` · `ebb2a9b`

**Where:** `STUDIO HARNESS/src/auth/session-token-provider.ts:66-70`

**What is wrong:** `#refreshing` is shared, but the fetch inside it uses the
signal of whichever caller arrived first. Callers 2..N join a promise governed
by a signal that is not theirs.

**Failure:** Calls A and B both need a token. A starts the refresh. The user
cancels A. B — never cancelled — fails with `aborted` instead of getting a
token.

**Fix:** Do not pass any caller's signal into the shared refresh. Let each
caller race the shared promise against its own signal, so cancelling A affects
only A. Test with two callers and one signal.

**Done.** `#refresh` takes no signal at all. Each caller wraps the shared
promise in `untilAborted`, which rejects on that caller's own signal and leaves
the shared work running.

**Deliberate consequence:** if every caller cancels, the refresh still finishes
and saves the renewed session. The work is nearly done and the next call needs
it, so ending it would waste a rotated refresh token.

**Tested by:** two callers and one signal — the cancelled one rejects, the other
gets a token, and only one refresh happens. Restoring the signal fails it.

---

### [x] 8. A capability with no effects is treated as safe · `K-05` · `ebb2a9b`

**Where:** `STUDIO HARNESS/src/contracts/effects.ts:166-178`

**What is wrong:** `isReadOnly` and `allowedWhileUntrusted` use `every()`, which
is `true` for an empty array. So `effects: []` is read-only, allowed in an
untrusted folder, and auto-allowed by `defaultVerdict`. The most permissive path
belongs to the capability that declared nothing.

**Fix:** Refuse `effects: []` at registration in `PermissionKernel.register`. A
capability that does nothing does not need to exist, and one that does something
must say so. Test that registration throws.

**Done.** `PermissionKernel.register` refuses `effects: []`.

Refused at the door rather than defended against in each reader, which is the
same principle as the one effect table: one place decides and nobody else has to
remember.

**Tested by:** registration throws a `PermissionError` naming the problem.
Removing the guard fails it.

---

### [x] 9. A grant is stored with a project and never matched on it · `K-06` · `9d3bc99`

**Where:** `STUDIO HARNESS/src/permissions/grant-store.ts:93-98` (query),
`:144` (write)

**What is wrong:** `project_id` is written on every grant. The `find` query
filters on `capability_key`, `agent_id`, `revoked_at` and `conversation_id`
only. The column is written and never read.

**Failure:** "Always allow `git:push`" approved in project A also applies in
project B. Path grants hide this because the stored pattern is an absolute path
under the old root. Command grants have no such boundary.

**Fix:** Decide whether a grant is project-scoped. If yes, add `project_id` to
the `WHERE`. If no, stop writing the column. Do not leave it written and unread.
Test an "always" command grant across two project ids.

**Decided: project-scoped (option A), by the user.** Written up as ADR 0021.
The scope ladder never offers a rung above the workspace root and trust is per
folder, so a grant that applies above the workspace root undoes both at storage
time.

**Done.** `find` matches `project_id`. A row with no project applies anywhere,
mirroring conversation handling, and a project-tied grant outranks one without.

**This forced a migration, which the audit did not predict.** The unique index
did not include `project_id`. With the query narrowed and the index unchanged,
the second project's approval collides with the first row, the insert fails, and
the approval the user just gave is thrown as a storage error. Migration 5
rebuilds the index. No data changes.

**Tested by:** an always-grant for `git:push` in project 1 must read as `ask` in
project 2, and the same approval must be storable twice. Reverting the query
fails both — the second one is what catches the index.

---

### [x] 10. An SSE frame splits when a chunk ends in `\r` · `M-01` · `b446250`

**Where:** `STUDIO HARNESS/src/models/studio-cloud/sse-parser.ts:35`

**What is wrong:** The line rewrites a trailing lone `\r` to `\n` before the
next chunk arrives. If the `\n` of a `\r\n` pair is in the next chunk, one line
break becomes two, so one frame becomes two. The first has no `data:` line and
is dropped, taking the `event:` name with it.

**Fix:** Hold a trailing `\r` back until the next chunk arrives, or the stream
ends. Test a CRLF frame split exactly on the `\r`.

**Done.** A trailing `\r` is held back until the next chunk arrives. At the end
of a chunk it is ambiguous — a CR line break, or half of a `\r\n` — and
normalising it immediately resolves that the wrong way.

**Two things this turned up:**

1. My hand-picked split position **passed without the fix**. Only the test that
   cuts at *every* position in the stream caught it. One chosen cut is a guess
   about where the network splits; every cut is not.
2. Holding the `\r` back created a new bug: a stream whose last bytes are `…\r`
   lost its final frame, because the boundary it completes never reached the
   buffer. The end-of-stream case now flushes it. My own test caught that, not a
   later audit.

**Tested by:** 11 cases in a new `tests/unit/sse-parser.test.ts`, including
every cut position and a multi-byte character split across chunks. Reverting the
hold-back fails the exhaustive one.

---

### [x] 11. Flue's database defaults to the working directory · `H-02` · `b446250`

**Where:** `STUDIO HARNESS/src/db.ts:3`

**What is wrong:** `sqlite(process.env.PROJECT_STUDIO_DB_PATH ?? "./data/flue.db")`.
`platform/paths.ts:21-25` names the database path as one of two bugs that "have
already happened once". This is that bug, still present, for Flue's own
canonical journal.

**Failure:** Start the harness in `~/repo-a` and again in `~/repo-b`. Two
separate databases, each inside the user's project, each visible in their
`git status`.

**Fix:** Default to the Studio home through `platform/paths.ts`. Keep the
environment variable as an override.

**Done.** `flueDatabasePath()` in `platform/paths.ts`, next to `databasePath()`
and deliberately a separate file — Flue's schema is not ours to migrate.
`PROJECT_STUDIO_DB_PATH` still overrides, and now goes through
`resolveConfigured`, so a relative override means "inside the Studio home"
rather than "wherever this process started". `db.ts` creates the directory,
because Flue opens the file and does not build the tree.

**Tested by:** the journal resolves inside the Studio home and is not the same
file as ours. Restoring the relative default fails it.

---

### [x] 12. A configured relative path can leave the Studio home · `H-03` · `b446250`

**Where:** `STUDIO HARNESS/src/platform/paths.ts:169-171`

**Proven by running:** `PROJECT_STUDIO_STORE_PATH=../../elsewhere/studio.db`
resolves to `C:\Users\elsewhere\studio.db`. `join()` normalises `..` away
instead of refusing it.

**Fix:** After joining, check the result is inside the home and refuse if it is
not. Test a `..` value.

**Done.** `resolveConfigured` resolves, then checks containment by path segment
and refuses. Nobody is being defended against here — a user may write an
absolute path and is entitled to. The point is that "relative to the Studio
home" and "somewhere else entirely" must not be the same expression.

**One thing this turned up:** my first version threw a raw `Error`, and the
architecture test refused it — every throw in `src` belongs to a domain. It is a
`StorageError("invalid")` now. The rule caught me the same way it would catch
anyone.

**Tested by:** `../../elsewhere/studio.db` and `data/../../escape.db` are both
refused, while `data/../cache/thing.db` still resolves. Restoring `join` fails
the first.

---

### [x] 13. `shell` cannot run a program named with its extension · `T-25` · `035da0a`

**Where:** `STUDIO HARNESS/src/tools/shell/resolve.ts:84` and `:116-118`

**What is wrong:** Line 84 strips the extension into `name`, but the search loop
appends an extension to the raw `program`. `command: "node.exe"` searches for
`node.exe.exe`.

**Failure:** A caller who spells the extension out — reasonable, since the tool
talks about `.exe` — is told the program is not installed.

**Fix:** Search using the stripped `name`, and accept an exact match when the
caller already supplied a runnable extension. Test `node` and `node.exe` both
resolving to the same path. Fold in the `T-21` note that the program is resolved
three times per call: resolve once in `parse` and carry the path through.

**Done.** Both halves.

The search now uses the stripped `name`, and a caller who already supplied a
runnable extension is looked up verbatim. `node` and `node.exe` resolve to the
same file and to the same permission resource, `shell:node` — otherwise one
approval would not have covered the next call.

**One more found while there:** a shim named in full — `npm.cmd` — was searched
for as `npm.cmd.exe` and reported missing. That is the exact thing a user types
after being told `npm` is a shim, so it now gets the shim message.

`T-21`, folded in: `parse`, `resource`, and `execute` each called
`resolveProgram`, which walks `PATH` and stats every candidate. Three times per
call for an answer that cannot change between them — and worse than the cost, it
could disagree with itself if `PATH` changed mid-call, so the program authorized
would not be the program run. `ShellInput` now carries the resolution.

**Tested by:** `node` and `node.exe` give the same path, name, and resource, and
`faketool.cmd` gets the shim message. Restoring the raw-program search fails the
first.

---

## Group 4 — Small and real

### [x] 14. `glob` promises an order it does not always give · `T-26` · `87f1179`

**Where:** `STUDIO HARNESS/src/tools/search/glob.ts:54` and `:1`

Two things. Above 1,000 results it sorts alphabetically while its description
tells the model "most recently modified first", with no signal that the order
changed. And its `stat` is imported straight from `node:fs/promises`, so it
reads the modification time of a symlink target outside the workspace instead of
going through the sandbox like every other filesystem call.

**Fix:** Say in the result when the order is alphabetical. Route `stat` through
`context.sandbox`.

**Done.** `byRecency` returns the order it actually used, and the result says so
only when it is not what the description promised — saying "sorted by recency"
on every ordinary result would be a token cost paid for nothing. `stat` goes
through `context.sandbox`, which resolves the real path, so a symlink can no
longer report the modification time of a target outside the workspace.

**Tested by:** newest-first ordering with modification times set explicitly, a
1,001-file directory that must say "sorted by name", and an ordinary result that
must stay quiet. Reverting the reported order fails the middle one.

---

### [x] 15. `FileAccessLog` separates its key with a space · `T-27` · `87f1179`

**Where:** `STUDIO HARNESS/src/tools/filesystem/access-log.ts:29-32`

Conversation `"a"` with path `"b c"` and conversation `"a b"` with path `"c"`
produce the same key. The class exists to keep one conversation's read record
away from another's.

**Fix:** Use a separator that cannot appear in either part — a null character.

**Done** — but not as expected, and this is worth recording.

The null separator was **already on disk**, written as a *literal NUL byte
inside the source file*. Every viewer renders it as a space, which is why the
audit read it as one, and `git` and `grep` treat the whole file as binary. It is
now a two-character escape in a named `SEPARATOR` constant, so the runtime
string is unchanged and the file is plain text again.

**The lesson:** a fix that is invisible in the source is not a fix anyone can
review. The audit was right about the file and wrong about the cause, and both
halves came from the same invisible byte.

Also deleted `Observation.existed`, the dead field from the rejected-items list.
All three call sites passed `true`, so the branch guarded by it never varied.

**Tested by:** conversation `a` with path `b c` must not collide with
conversation `a b` with path `c`, and `forget("a")` must not sweep away
conversation `a b`. Restoring the space fails both.

---

### [x] 16. `capabilityKey` joins with an unescaped `/` · `K-07`

**Where:** `STUDIO HARNESS/src/contracts/capabilities.ts:51-53`

`{namespace: "mcp:a", name: "b/c"}` and `{namespace: "mcp:a/b", name: "c"}` make
the same key. A tool name from a connected server is untrusted input, and this
key is what every grant, rule and registry lookup uses.

**Fix:** Reject `/` in a namespace or a name at registration. Do this before
Phase 11, when server-supplied names become real.

**Done.** `capabilityIdProblem` in `contracts/capabilities.ts` refuses a `/` in
either half, and an empty half with it. Enforced in `PermissionKernel.register`,
the one door capabilities come through, so nothing downstream re-checks it.

It returns the problem rather than throwing: `contracts/` sits below every
subsystem and cannot reach `PermissionError` without a cycle, and a raw `Error`
from `src/` is what the taxonomy rule forbids.

Refused rather than escaped — escaping keeps the ids distinct but makes the key
unreadable in every log and every grant row, to permit a name nobody wants.

2 tests fail without it.

---

### [x] 17. A failed stream leaves a content block open · `M-02`

**Where:** `STUDIO HARNESS/src/models/studio-cloud/event-mapper.ts:167-180`

`complete()` closes the open block first. `fail()` does not, so a consumer that
tracks block start and end sees a block that never closes.

**Fix:** Call `#closeOpenBlock()` in `fail()` too.

**Done.** Called before `#settled` is set, because closing emits an event and a
settled mapper is closed for writing. `complete()` closes first and then
delegates to `fail()`, so the second close is a no-op — asserted, because two
ends for one start is the same defect facing the other way.

New file `tests/unit/event-mapper.test.ts`, 5 tests. 2 fail without the fix.

---

### [x] 18. No test stops a tool bypassing the gate · part of `T-19`

**Where:** `STUDIO HARNESS/tests/unit/architecture.test.ts`

That file exists because "the previous convention lasted exactly as long as
someone remembered it". Tool gating is now exactly that kind of convention, and
`src/agents/studio.ts:13` already breaks it.

**Fix:** Add a rule asserting every tool reachable from an agent came from a
`CallGate` registration. This does not fix `T-19`; it stops it spreading.

**Done.** Three rules in `tests/unit/architecture.test.ts`:

1. Every exported `create*Tool` factory is passed to `gate.register`.
2. Nothing outside `src/tools/` imports a tool module. Only `gate`, `types`,
   `errors` and `bounds` are importable.
3. Registering all four tool groups leaves the kernel knowing every key the gate
   will answer for.

Rule 2 found the existing bypass on its first run: `src/agents/studio.ts` imports
`workspace-summary.js`. It is named in an **exact list** of known bypasses rather
than skipped, so a second one fails the test. Removing the fixture is its own
change — seven integration tests use it — and belongs with the Phase 11 wiring.

Both static rules were proven by breaking them: deleting one `gate.register`
call fails rule 1, and the real import failed rule 2 before it was listed.

---

## Group 5 — Documents

### [x] 19. The provider count — the audit was wrong, and so was my correction

**The audit said** `providers: 35`, `models: 1072`, and concluded that my last
change (35 → 36 in `STATUS.md`) had been an error of trusting documents over
code.

**Re-run against the running collection:** `providers: 36`, `models: 1072`.

So the three documents are right, `36` stands, and no document changes. The
audit's 35 was a miscount, and the confession attached to it was a correction of
something that was never wrong.

**The lesson survives the reversal, pointing the other way:** the number was
argued about three times without anyone executing the code that produces it.
`createModelsCollection({}).getProviders().length` settles it in one run.

**Still worth doing:** nothing in our code asserts the count, so a dependency
bump changes it silently. Recorded against `C-04`.

---

### [x] 20. `mental-model.md` §3.4 and §4 read as built, and are not

**Where:** `documentation/mental-model.md:161-189` and `:220-228`

`expandedTools` and `tool_discover` appear nowhere in `src/` or `tests/`. Both
sections are written in the present tense as current behaviour. §3.5 right
below them says "**Not implemented.**" for the same kind of gap, so the contrast
makes these two read as built.

**Fix:** Mark both as landing with Phase 11.

**Done.** Both now carry a `**Not implemented.**` paragraph in the same style as
§3.5 below them. Confirmed first: `expandedTools`, `tool_discover` and
`discoverable` appear nowhere in `src/`. §4 also states what *is* true today —
seven native tools, all always-loaded, all registered through the `CallGate`.

§3.4 keeps a reason for being written before it is built: the rule has to be in
place before the first `prompt()` call, because retrofitting it means paying the
cache invalidation once in every session already running.

---

## Rejected, with the reason

**A 404 from the gateway is reported as a model error.**
`src/models/studio-cloud/errors.ts:93-103`. The reviewer marked this low
confidence itself and noted the gateway sends its own error code, which takes
precedence over the status fallback. It only misleads when the error body is
already malformed. Not worth a change.

**`Observation.existed` has a dead branch.**
`src/tools/filesystem/access-log.ts:21-26`. Correct that nothing ever writes
`existed: false`. But it is defensive code, not a defect — it does not misbehave,
it simply never runs. Handle it by deleting the unused field during item 15,
not as a bug in its own right.

---

## Verification standard for this task

The last round proved this is worth writing down. A test that passes against
fixed code proves nothing on its own. For every item:

1. Write the test.
2. Revert the fix.
3. Confirm the test fails.
4. Restore the fix.

Items 1 and 2 are already proven against real git. Items 3, 4, 5, 12 and 19 are
proven by running the real pattern or path logic. The rest need step 2 before
their box is ticked.
