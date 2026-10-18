# Consolidate completed Studio work on main

The user explicitly requested publishing all completed work to GitHub, keeping
one main branch, removing stray branches, and resolving unfinished work. This
overrides the earlier house-rule instruction to leave feature branches unmerged.
No Git history will be rewritten or force-pushed.

Audit:

- The working tree was clean at the start. There are no stashes, extra
  worktrees, open GitHub pull requests, or open GitHub issues.
- `main` and `origin/main` start at `9b1d06be`. The browser branch contains the
  two completed browser commits `22f32765` and `af00599a`.
- The backup, Inspector and continuity branch tips are already ancestors of
  the browser branch. Their work is already represented in the current tree.
- The custom `refs/snapshots/ui-dock-experiment` holds one additional July
  commit, `19b6bc99`. Its old chat-header/dropdown/page files were subsequently
  replaced. Preserve that snapshot as a historical merge parent while keeping
  the current verified tree, then remove the redundant snapshot ref.
- Preserve the existing `pre-phase5-snapshot` tag as a version marker.

The remaining validation issue was Windows `EBUSY` removing an isolated test
workspace during observability teardown. Changes:

- `tests/helpers/remove-test-directory.ts`: use Node's bounded removal retries
  for temporary directory locks, up to 11 seconds of scheduled waiting.
- `tests/integration/observability.test.ts`: use that helper during teardown
  and allow 25 seconds for process shutdown plus bounded cleanup. All eight
  behavioral assertions remain unchanged.
- `tests/unit/remove-test-directory.test.ts`: hold a real Windows working
  directory open in an isolated Node child. Verify ordinary removal fails,
  release the handle during cleanup, and verify the directory is removed.
  Release is explicitly controlled so the precondition cannot expire under load.

Negative control: removing `maxRetries`/`retryDelay` made the new test fail with
`EBUSY`; restoring them passed. The observability file and cleanup test passed
all nine tests. No production behavior, permission or observation boundary changed.

Sequential full validation passed on 2026-10-18:

- Harness `pnpm check --reporter=verbose`: 2,468 passed, 28 platform skips;
  typecheck, lint and build passed. Duration: 1,323 seconds.
- Client `pnpm check`: 1,556 passed, typecheck and lint passed.
- Client production build passed with Vite's large-chunk warning.
- Native `cargo test`: 150 passed. Clippy passed with all targets and warnings
  denied. No native implementation changed.
- Inspector `pnpm check`: 24 passed. No Inspector implementation changed.

Logs are retained in each product's ignored `node_modules/.cache/` under
`studio-main-{harness,client,client-build,native,clippy,inspector}.log`.
The preceding browser task had 2,465 Harness tests passed, 28 skipped and two
cleanup failures; the new full gate resolves both and adds one regression test.
No production rule or dependency was added and no assertion was weakened.

Publication follows validation: fast-forward main, preserve the superseded UI
snapshot with no tree changes, push main normally, verify the remote, and only
then remove merged local/remote branches and the redundant snapshot ref. Keep
the version tag. Final local/remote branch and ancestry checks verify the result.
