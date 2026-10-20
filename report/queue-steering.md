# Queue and steering

The running composer now uses one send icon to queue a follow-up. Stop and send
keep their slots while typing; the large Queue and direct Steer buttons are
removed. A queued message offers Steer now, using the existing atomic runtime
promotion rather than submitting its text again. Steering joins at the next
safe step; it does not interrupt a provider response mid-token.

Successful promotion now shows the pending user bubble immediately and resumes
the conversation reader at its retained offset. The runtime echo replaces that
bubble once. Already-settled submissions do not restart the working state.
Out-of-order queue reads cannot erase a newer list, and completion of an old
chat's action cannot invalidate the new chat's pending queue read. Refused
promotions keep the message and surface the runtime's error.

## Files

- `STUDIO/src/features/chat/composer/Composer.tsx`: compact, stable running
  controls and queue-only sending; its tests retain refusal, editing and
  stopping coverage under the new interaction.
- `STUDIO/src/features/chat/composer/QueuedMessages.tsx`: Steer now action;
  its test checks the existing queue mutation.
- `STUDIO/src/features/chat/ChatPage.tsx`: connects accepted promotion to the
  transcript and uses a queue-specific placeholder.
- `STUDIO/src/features/chat/connection/useQueuedMessages.ts`: successful
  promotion callback, read ordering, visible list failures and conversation
  fencing; its tests cover success, refusal, stale responses and navigation.
- `STUDIO/src/features/chat/connection/useConversation.ts`: follows the existing
  submission without another POST, using the retained read position; tested in
  `submitted-turn.test.tsx`.
- `STUDIO/src/features/chat/connection/useConversationTranscript.ts`: pending
  promotion bubble and identity-only observation; tested in `sent-words.test.ts`.
- The observability contract and coverage tracker describe the existing
  submission identity, promotion stage and delivery recovery.
- `STUDIO/src/features/settings/library/LibraryPane.test.tsx`: the repeated
  full gate exposed a race in an unrelated existing test. It now waits for the
  restored file card before checking that the empty-search message is absent.
  Both original conditions remain; no library product code changed.

## Verification

Five client regression tests were added. The previous recorded client gate had
1,571 passing tests; no fresh full baseline was taken before editing. The first
full client run after the first four additions had one unrelated LibraryPane
failure; its isolated nine tests and the repeated full 1,575-test gate passed
without changing that code. The final navigation regression then reproduced
another queue race and passed after the conversation fence was added. The next
full client run reproduced the library-test race, so its wait was corrected
as described above. The nine library tests passed; deliberately withholding
the restored listing made the strengthened assertion fail, then the original
fixture was restored.

Mutation controls removed the promotion callback, pending bubble update, reader
reattachment, stale-read guard and stable stop slot. All five targeted assertions
failed as expected, and passed after restoration. Removing the refusal guard
also made the refused-promotion test fail, as expected; the guard was restored.
The navigation regression failed before its fix. No unrequested product policy
or dependency was added.

Existing real-harness queue/steering integration fixtures both passed after a
fresh harness build. They verify queued versus joined delivery, removed/edited
messages, settlement and no separate assistant turn for a steered correction.

A headless Edge check rendered the actual Composer and QueuedMessages with an
isolated workspace and submission callback. Before and after typing, stop and
send stayed at x=715 and x=747, each 28x28; the text field stayed 19px high.
Queueing displayed the queued row with Steer now. There were no page errors or
horizontal overflow at 360px. This component smoke check is separate from the
real-harness integration fixtures; it does not claim a live desktop test.

The harness gate passed typecheck, lint and build. Its full suite finished with
2,547 passing tests, 28 skipped and one failure in the unchanged detached-browser
fixture: its poll at `tests/integration/browser-window.test.ts:133` timed out
waiting for the original tab's screencast frame after switching tabs. That file
passed on its isolated rerun without source changes. The full command therefore
exited 1; this is not reported as a clean full harness gate. The queue-specific
integration fixtures passed both in isolation and in the full run.

The final `pnpm -C STUDIO check` passed typecheck, lint and all 1,576 tests across
174 files after restoring the mutations and fixing the library-test wait. No
native host code changed, so no cargo checks are required for this change.

Work stays on `main` under the user's explicit instruction to use and synchronize
main instead of retaining a feature branch. This overrides the older delegated
work branch instructions in `documentation/rules.md` for this session.
