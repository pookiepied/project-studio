Duplicate attachments in the current draft

Images and documents already held by the composer are rejected with the filename and "Already attached to this message." The first copy is retained. Comparison uses exact contents, not names or timestamps: renamed copies are duplicates, and different files sharing a name and size are allowed. No conversation history or persisted attachment store is consulted. Removing an attachment or successfully sending the draft permits attaching it again.

Changed files:
- STUDIO/src/domain/attachments/duplicates.ts: compare document bytes against same-size files in the draft, without Web Crypto or dependencies. Only potential duplicate documents need byte reads.
- STUDIO/src/features/chat/composer/Composer.tsx: compare canonical image data, serialize overlapping picks, keep attachment refs and state together, preserve mixed-selection warnings, and apply the existing limits after duplicate detection.
- STUDIO/src/features/chat/composer/PendingDocuments.tsx: update the comment to describe when document bytes are read.
- Composer.test.tsx and duplicates.test.ts: verify renamed duplicates, different contents with identical names and sizes, repeated selections, paste/drop overlap, cap behavior, removal, and reuse after sending.

Send waits for pending attachment reads and comparisons, including keyboard submission. This related behavior prevents a file selected before sending from appearing in the next draft after its duplicate check finishes. Stop remains available during an active run. The pending-check regression failed when its admission guard was removed, then passed after restoration.

Verification: full client pnpm check --fileParallelism=false passed type checking, lint, and all 1,433 tests across 150 files, compared with 1,424 tests across 149 files before this change. The serial test run took 295.69 seconds. Disabling image-data equality and document-byte equality made five regressions fail; both were restored before the successful check. An earlier full run exposed a stale draft assumption in a new assertion, corrected by setting the test's draft explicitly, and an unrelated LibraryPane timing failure. LibraryPane passed in the focused run and final serial suite; its code and tests were not changed.

The check recognizes byte-identical files, not visually similar or re-encoded photos. No upload is made for a refused duplicate. Existing attachment limits and permissions are unchanged. Harness and Rust source did not change and their suites were not rerun. No dependencies or documentation files were changed. Publication remains on main under the user's explicit instruction to keep the local workspace and GitHub on main, overriding the repository's branch-only publication rule.
