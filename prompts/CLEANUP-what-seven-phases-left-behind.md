# Cleanup - What seven phases left behind

Seven phases of a runtime migration landed. Each one was verified, but a
migration is a series of local decisions, and the residue only becomes
visible when you stop and look at the whole tree at once.

This is that stop. It is not a feature task. Nothing here should change what
the product does, and if you find yourself designing something, you have
left the brief.

Read `documentation/work/flue-2-migration.md` and the seven reports in
`report/` for context. They are secondhand - verify everything against real
code.

---

## Part 0 - Measured, so you do not have to re-derive it

All measured on 2026-09-03 against the real tree.

1. **`opencode/` is not ours.** 6,631 files, 218 MB, untracked, sitting in
   the repo root. It is a third-party project. **Do not commit it, do not
   modify it, do not delete it** - it is the user's, and they may have put it
   there on purpose. Part 1 says what to do.
2. **The settings store has one authority already.** `preferences.json` in
   the OS config directory wins. `localStorage` is consulted in exactly two
   places: a one-time migration on an install that predates the file, and the
   non-Tauri dev fallback. This is correct and is NOT to be redesigned.
3. **MCP is entirely our own code**, both transports, zero `@flue` imports in
   `src/extend/mcp/`. Nothing in this task changes that.
4. **The suite floor is ten**, all in `harness`, all the Phase 8 retry
   regression. `mcp-flue > runs a real selected tool through approval and
   removes it after disable` is a known intermittent above it - it has failed
   in four of seven observed full runs and passes alone. Report per failure,
   never as a total, and never raise a deadline to make it pass.

## Part 1 - The repo root

`opencode/` is untracked and enormous, and it makes `git status` useless -
which is how 18,000 lines of apparent uncommitted work turned out to be
somebody else's repository.

Add it to `.gitignore` with a comment saying what it is and that it is not
ours. That is the whole change. Do not remove the directory.

While you are in `.gitignore`, check whether anything else large and foreign
is untracked, and say what you found even if you leave it alone.

## Part 2 - The double read

`STUDIO/src/design/theme/appearance.ts`, the non-Tauri branch of
`loadAppearance`:

```ts
return readLegacy() ? coerce(readLegacy()) : DEFAULT_APPEARANCE
```

It reads and parses the same value twice, once to test it and once to use
it. Read it once into a local and branch on that.

This is the only thing wrong with the settings store. Resist the urge to
find more. The authority rule is correct, the file location is correct, and
the migration is correct - Part 0.2 is not an invitation to re-litigate any
of them.

## Part 3 - The doors with no rooms

`STUDIO/src/features/settings/sections.ts` lists sixteen sections. Three
panes exist: General, Appearance, Archive. Every other section is a nav
entry that leads somewhere empty.

Find out what actually happens when a person clicks one. There is a
`placeholders.ts` beside the panes, so this may already be handled
deliberately - if it is, say so and change nothing.

If it is NOT handled - if a click leads to a blank region, a crash, or a
console error - then the honest fix is the smallest one: a placeholder that
says the section is not built yet. Not a pane. Not a feature.

Say which of the sixteen are real and which are not, as a list. That list is
the input to the next several tasks and it is worth more than the fix.

## Part 4 - The debris

Two kinds, and they are different.

**Test debris.** The `mcp-flue` intermittent leaves `studio-mcp-flue-*`
directories in the user's temp folder when it fails, because the harness
child still holds the database when `afterEach` deletes the directory. Count
what is there now and remove it.

Then look at the teardown itself. The debris is a symptom of a cleanup that
cannot fail loudly - if `afterEach` swallows an unlink error, that is worth
naming even if you do not change it. **Do not attempt to fix the underlying
intermittent.** It is not this task and it has resisted two phases.

**Dead code.** Look for what seven phases of renaming left: exports nothing
imports, types nothing constructs, comments describing the 1.0 mechanism
that no longer exists. The identity rename in Phase 7 is the likeliest
source, because `runId` became two different things and the old vocabulary
may still be sitting in files nobody reopened.

For each one, say whether it is dead or whether you simply could not find
the caller. Those are different findings and only the first is safe to
delete. Convention-loaded files are the trap here: `src/db.ts` has no
importer anywhere in the source and is loaded by the `@flue/vite` scan - a
grep for its name proves nothing.

## Part 5 - Line endings

Phase 7 found three files that had been silently converted to CRLF and
normalised them back. The repo standard is LF.

Check every source file in both `STUDIO HARNESS/` and `STUDIO/` - TypeScript,
Rust, JSON, Markdown, config. Report the count you checked and the count you
found. If the number is not zero, that is a finding about tooling and not
just about those files: something on this machine is converting them, and
`.gitattributes` is where the answer should live.

## Verification

- `pnpm typecheck` (harness) and `tsc -b` (frontend), both clean.
- Frontend suite green (47 files, 456 tests).
- `pnpm test` (harness, builds first), suites one at a time. Ten failures
  are the floor. Attribute anything above ten per failure.
- `cargo clippy --all-targets` zero warnings; Rust suite 65/65.

Every number here should be identical before and after your changes, except
where you deleted a test that was testing nothing. If a count moves and you
did not intend it, that is the finding.

## Not this task

- **Do not implement the system tray, single instance, or launch at
  startup.** Those are the next task and they share a config surface this
  one must not pre-empt.
- **Do not build the MCP settings pane**, or any other missing pane.
- Do not re-derive the runtime patch hunks - Phase 8, and ten tests stay red.
- Do not implement delete, archive, or parallel tool calling.
- Do not redesign the settings store.
- Do not delete `opencode/`, the exports in the user's home folder, the
  `*.beta9-journal` files, or anything under `~/.studio/`.

## Report

`report/CLEANUP-what-seven-phases-left-behind.md`: the sixteen settings
sections classified real or empty, everything you deleted with the evidence
it was dead, everything you suspected and did NOT delete with the reason,
the temp debris count, the line-ending counts, the suite numbers with
per-failure attribution, and every place this brief was wrong.

A cleanup task that reports only deletions is hiding the interesting half.
What you found and left alone is the more valuable list.

## Rules

`Backend/`, `docs/`, `prompts/`, `report/` and `opencode/` are read-only
context, except the one report file you write. Never `git checkout`,
`switch`, `stash`, `reset`, `clean`, `commit` or `rebase`.

No `any`, no non-const `as`, no non-null `!`. UTF-8, no BOM, LF. No
en-dashes, smart quotes, curly apostrophes, ellipsis characters or emoji in
source. Edit by hand, never with a script - and that rule is sharper here
than usual, because a bulk deletion is exactly the shape that over-reaches.

No green placeholder tests, and never a test that stopped checking anything.
Deleting a test is a finding that needs its own justification in the report.

Applied migrations are never rewritten. Secrets never enter a log, a
fixture, a report, or an error.

Verify against real code and real runs, not this brief. Briefs in this
series have been wrong in every phase so far.
