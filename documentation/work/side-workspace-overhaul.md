# Conversation workspace overhaul

## Ownership and lifecycle

The former rail held a global entry list and selection, evicted entries after
twelve items, and was rendered outside chat routes. Its background agent list
was global as well. Poll responses could outlive their conversation; accepted
cancellation was displayed as confirmed termination.

`RailProvider` now partitions resources, task history and selection by conversation.
The main application supplies the current chat ID, or null outside chat routes.
The shell mounts the rail only on chat routes and keys it by conversation. Detached
chat windows use the same surface. Manual collapse is a serialized preference in
the existing preferences store (localStorage in the browser). Passive publications
never change that preference. An explicit artifact open or expand can change it.

Tasks are projections of canonical, persisted transcript submissions, retaining
submission and tool-call IDs. Reload/replay rebuilds the same groups rather than
creating a second execution database. Existing plan/job/task APIs remain their
sources of truth. Open resource selections are window state, not a new persistent
journal; artifacts remain inspectable through their recorded task results after
reload. Transcript history has a separate context so text streaming does not
notify the shell's visibility consumers.

## Presentation and interactions

The single surface switches between overview and one focused inspection. Active
tasks have capability icons, small monochrome execution rings and a short visual
tool trail. Resources use compact neutral tiles; browser/computer previews use
actual recorded frames. Completed work becomes compact history, revealed thirty
rows at a time. Agent lists progressively reveal twenty rows. Raw inputs and logs
stay in inspection. No new success-green palette or full-width progress bar is
used; existing diff addition/deletion tokens retain their established meaning.

Task inspection reuses transcript renderers and exposes recorded changes with
syntax-highlighted diffs. Registered worker inspection subscribes read-only to
the existing worker stream, with explicit reconnect and cleanup. Cancel controls
use existing backend support and distinguish request acceptance from settlement.
Escape returns to overview, then collapses. Width/opacity transitions share
entrance/exit settings, retain content until exit finishes, and disable motion
for reduced-motion users. Narrow windows use an overlay.

## Verification and review

- Harness: `pnpm -C "STUDIO HARNESS" check` passed: 205 test files passed,
  2 skipped; 2,662 tests passed, 28 skipped.
- Final client: `pnpm -C STUDIO check` passed (exit 0): typecheck, lint,
  193 test files and 1,669 tests. The full run logged a fork-shutdown timeout
  for `running-mark.test.tsx`; its isolated rerun passed all five tests without
  the warning. jsdom also reported its unsupported `scrollTo` implementation.
- `pnpm -C STUDIO build` passed (exit 0). Vite reported a bundle over its
  500 kB warning threshold; this change does not claim bundle-size optimization.
- `git diff --check` passed. Unrelated existing working-tree edits were preserved.
- First full client run found a cancellation-feedback race (a successful list
  refresh erased a failed Stop message). Separate operation/read errors fixed it;
  the focused regression passed afterward.
- Negative control: temporarily removing conversation filtering and ignoring
  manual collapse caused both corresponding lifecycle tests to fail. Both
  mutations were restored before final verification.
- Projection fixtures cover submission grouping, replay, interrupted/failed
  histories, meaningful labels and 1,000 tasks. UI fixtures verify progressive
  disclosure, selection, Escape/back/collapse/reopen and reduced-motion exit.
- Polling fixtures reject late responses and foreign agent cancellation, and
  preserve running/stopping until backend evidence confirms settlement.
- Worker transport fixture verifies the worker instance URL, parent observation
  scope and read-only behavior. It does not execute a real worker.
- Browser inspection used the production components in the dev showcase in light
  and dark themes at a narrow viewport. It found clipped resource labels, which
  were corrected. Completed-task inspection was exercised. The showcase is fixture
  data and is not evidence of live backend execution.
- Separate regression trace found and removed a misleading origin link: the
  backend's originSubmissionId identifies the worker's own submission, not a
  parent transcript row. It also found detached windows lacked a rail; those now
  mount the same conversation-scoped surface.

## Limits and unverified behavior

Inline delegates without an addressable HTTP stream retain their recorded tool
results rather than a simulated live transcript. Persisted worker attachments
are not fetched through the parent's attachment route; generic worker tool
inspection is used instead. A nested parent-task link is not invented where the
index only identifies the parent conversation. Primary-turn cancellation remains
the chat's existing Stop control, preserving its cleanup path. Token totals are
shown only when recorded; no resource estimates are invented.

No native host code changed. Live concurrent provider workers, real desktop
control, native window resizing and frame-by-frame animation timing have not been
exercised end-to-end here. Progressive disclosure limits rendered history, but
there is no browser performance benchmark for thousands of active workers.
