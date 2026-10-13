Attachment file guidance

The image manifest emitted by Flue names an internal attachment ID but omits the image filename. Studio already appended a note containing the copy's exact path. The note now explicitly distinguishes the saved filename from the original upload name and supplies the read tool's path argument. Collision suffixes and sanitized names are derived from the saved path, rather than guessed from the upload name. Internal IDs remain intact for transcript storage and serving images.

Changed files:
- STUDIO HARNESS/src/conversations/attachments.ts: add fileName and read arguments to the model-facing note, clarify that the saved file contains the original upload bytes.
- STUDIO HARNESS/tests/unit/attachment-copies.test.ts: retain the ordered path/byte checks and assert saved names, read arguments, duplicate filenames, sanitized names, and the absence of an ID field in the note.

Verification: the focused attachment, agent-scope, and filesystem suites passed 127 tests, compared with 125 before the two added regressions. The strengthened mapping assertion and both new regressions failed against the old note, which omitted fileName and read; all passed after the change. Deleting the new fileName and read fields again made all three assertions fail as expected; the fields were then restored. The full harness pnpm check passed type checking, lint, build, and 2,376 tests across 176 files, with 28 tests skipped in two files, compared with 2,374 passing tests previously. It took 1,196.04 seconds, so the rules' two-minute estimate is outdated on this machine. Client code did not change. No product rule or dependency was added.

The read tool already returns stored image bytes and needs no change. Document attachments already announce their filenames and exact paths. Existing conversation history retains its earlier notes; the improved note applies when images are delivered. Work remains on codex/conversation-steering, with no commit on main.
