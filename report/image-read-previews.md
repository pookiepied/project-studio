# Image read previews

Studio's native `read` already sends supported image bytes as image content to
the model. A dedicated view-image tool would duplicate that capability. The
client now groups adjacent returned image reads as `Viewed N images`, expands
to thumbnails, and opens each image in the existing media lightbox. The full
image fits the viewport without cropping. Text reads retain their quiet rows.

`ImageReads.tsx` recognizes actual returned PNG/JPEG/GIF/WebP blocks and resolves
persisted attachment references through the existing conversation-scoped byte
resolver. Pending, refused and failed reads do not count as viewed images.
Missing or undecodable bytes have an unavailable message. The existing tool,
attachment transport, identities, permissions and diagnostic policy are reused.
The observability contract and coverage inventory document this presentation
path and the absence of preview-click/image-paint observations.

The previous image-read assertion required a disabled row. It now checks the
requested disclosure, thumbnail, full viewer and absence of printed base64;
existing text-read and failure assertions remain intact. New tests cover
adjacent grouping/order, saved attachments, unavailable bytes, decode failure,
multiple blocks and exclusion of non-image/error results. No new dependency,
tool, backend route or native command was added.

Verification includes a deliberate inversion of the image-read recognition
guard: all four then-existing new tests failed, and the guard was restored.
The focused group/image tests then passed 84 tests before the additional decode
failure case. A temporary browser fixture verified the collapsed row, three
thumbnails, full-image viewport, and close/focus return; the fixture was removed.
Removing the image decode-error handler also failed the exact decode-failure
regression (four other image tests passed); the handler was restored.

Full harness check passed typecheck, lint, build, and 2,468 tests with 28 skips
across 193 files (191 passed, two skipped), taking 1,330.83 seconds. This is
substantially longer than the README's approximate two-minute estimate on this
Windows environment. The previous recorded baseline was also 2,468 passed / 28
skipped; a fresh pre-change full baseline was not run.

The first full client check passed typecheck/lint and 1,560 tests but failed
one existing library test: `LibraryPane > says when a search found nothing,
and gives the wall back`, at its immediate `Edit Bruno` assertion after waiting
for the empty-search message to leave. The unchanged library file then passed
all nine tests alone. No library source or assertions were edited.
The second complete `pnpm -C STUDIO check` passed typecheck, lint, and all
1,561 tests across 174 files. Its test phase took 63.05 seconds. The previous
recorded client baseline was 1,556 tests; this change adds five tests without
deleting an existing test. No fresh pre-change full client baseline was run.
No native files changed, so no Cargo check was required for this change.

The user explicitly requested implementation, commit and push on `main`, which
overrides the repository's default branch instructions. The working tree was
clean at the start, and `main` matched `origin/main` before the commit.
