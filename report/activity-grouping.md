# Activity grouping

Activity between visible assistant messages now has one collapsed disclosure. Its expanded body is a flat chronological list, including repeated calls. Reasoning remains inspectable in place. The live header names current or parallel activity; the resting header counts calls without inferring successful file effects. Failures and unanswered calls remain visible in the header. Reader expansion choices survive updates.

## Changes

- `ActivityBlock.tsx` owns visible-text boundaries, the disclosure and factual summaries. `activityItems.ts` joins adjacent provider messages of one submission without crossing user messages, compaction markers or failed/stopped attempts. Weak caches preserve memo boundaries for unchanged history.
- `AssistantTurn.tsx` and `LiveTranscript.tsx` render those sections, preserve the latest underlying message for branching, and distinguish a live tool from a provider message that has already completed.
- `ToolGroups.tsx` renders individual calls in order, including browser and research calls, using the existing result views. Removed nested file-run rendering and cross-family lifting.
- Projection `segments.ts` and `seed.ts` retain each call at its original position. Removed open-file-run bookkeeping from `draft.ts` and `apply.ts`; updated `rows.ts`, `shapes.ts` and the module description. Same-file edits previously moved ahead of intervening reads or narration.
- `apply.ts` also fixes late outputs for appended assistant messages: their call sites previously pointed at transcript item zero instead of the appended item.
- Activity, live-transcript, tool-row, research and projection tests assert the new boundaries, flat order, parallel state, late-result routing, expansion persistence and replay behavior. Old file-run/combined-research expectations were replaced with chronological-call assertions.
- `Composer.tsx` includes the earlier removal of the thin Stop-button ring. Its square icon and action are retained.

## Verification

- Client type checking, lint and production build passed. Harness type checking, lint and production build passed. `git diff --check` passed.
- The final full serial client run completed: **1,446 passed, 1 failed, 151 files**. The sole failure was the existing Library listing test waiting for `Edit Bruno`. No grouping test failed. A separate Library run with `--retry=2` passed all 9 tests; an untouched `56cb852e` checkout also passed all 9. Library source and assertions were not changed. This is not a clean full-suite verdict.
- The previous main commit recorded 1,433 client tests; this change adds 14. The full unchanged baseline was not rerun. The earlier Stop change passed all 35 composer tests in this session.
- Three negative-control runs deliberately broke text boundaries, parallel counts, submission matching, result indexes, rendered order, live-tool state and memo reuse. They produced 8, 4 and 1 expected failures respectively. All deliberate breakages were restored.
- The full harness test suite was attempted twice but did not produce a verdict here. The supervised retry remained active without results for over seven minutes and was stopped. Do not count the harness suite as passed.
- Browser rendering could not be checked because the Chromium download failed. Native Tauri checks were not run: Linux desktop libraries are unavailable here, and Rust source is unchanged.

No additional product rules, dependencies, backend changes or result-view redesign were introduced. Publication to `main`, including both frontend changes and these verification limits, follows the user's explicit request in place of the repository's branch-only publication workflow.
