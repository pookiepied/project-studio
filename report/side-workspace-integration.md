# Integrate the pending conversation workspace

Date: 2026-10-29

The person asked to finish and integrate the pending side-workspace work before
continuing live voice testing. The original checkout remains on
`codex/side-workspace`, with its unrelated edits preserved. Integration runs on
`main` in `C:/pookiepied/Dev Workspace/Project Studio Windows Validation`, starting
at `1808e658`. A Git stash also retains the original pending feature changes:
`06177bf5073388b78560d9058479f487397d2f44`.

## Scope

The integration includes conversation-scoped resources, execution history and
worker inspection; polling and stop feedback; chat typography and control
sizing; Markdown links, sources, checklists and maths; conversation and web
reply images; five declarative visual formats and their bundled skill.
Personal launch-file and CLAUDE.md deletions and the transcript scratch directory
are excluded.

Four three-way conflicts retained both sides: media route options, HTTP wiring,
the observability contract and its progress tracker. Voice-task model validation,
desktop lease rules and screen collaboration remain present.

## Defects reproduced during integration

- Numeric strings that overflowed to infinity reached chart geometry. The new
  `rejects overflowing numeric strings before they reach plot geometry` test
  failed with `Infinity` when the finite check was removed, then passed restored.
- A `studio-file:%ZZ` Markdown image threw `URIError` during rendering. The new
  malformed-address test failed against the decoder without its guard, then
  passed with an unavailable-image result.
- Primary task inspection omitted the image conversation context. Its regression
  reported `none` instead of the owning conversation before the provider was
  added; it now passes. Removing the worker exclusion separately failed with the
  parent conversation instead of `none`, then passed after restoration.
- File URLs with an escaped `#` in their filename returned 404. The reserved-name
  test reproduced this against manual URI decoding and passed after using Node's
  fileURLToPath. Removing real-root containment separately made the linked-folder
  test return 200 instead of 404; restoring it returned the expected refusal.
- The rebuilt runtime exposed a skill integration fixture that assumed no
  bundled skill was enabled. It now asserts the visual skill's default, disables
  it in its isolated home, and retains every original hello activation/removal
  assertion. The original fixture failed; the adjusted integration test passed.

New error classes follow the client StudioError contract. Type assertions in the
pending visual and citation code were replaced with explicit types and narrowed
values. No dependency was added.

## Evidence and limits

Both TypeScript checks and client lint passed after resolving the conflicts.
The first focused client run passed 116 tests in 16 files. The updated visual
suite passed 12 tests, reply-image suite 6, and workspace overview suite 2.
The harness reply-image and bundled-skill suites passed 9 tests in 2 files.
Streamed document and citation checks passed 33 tests in 3 files after replacing
the source-map type assertion with a content-keyed, typed map cache.
The production client build passed, retaining its large-chunk warning.

The first full harness invocation passed 2,727 tests, skipped 28, and failed
none (209 passed files, 2 skipped). It took 1,474.10 seconds on this machine.
Integration was performed while that invocation ran, so the final rebuilt gate
is recorded separately rather than treating this as a pristine baseline.
`cargo test --no-run --locked` compiled the Windows native test binaries in
2 minutes 32 seconds. This is compilation evidence, not a native test result.

The rebuilt harness run passed 2,735 tests, skipped 28 and failed only the old
skill activation fixture (210 passed files, 1 failed, 2 skipped; 1,367 seconds).
Its corrected focused integration run passed. Negative controls also removed
the default-on skill and then overwrote an explicit off choice: the bundled
skill test failed at each corresponding assertion, and passed after restoration.
The complete gates are being rerun against that corrected tree.

Chrome displayed the integrated conversation specimen in dark mode on Windows.
This uses production renderers with fixture data, not a live provider worker.
Further UI interaction stopped when Computer Use could not determine Chrome's
current URL confidently enough to enforce its policy. Live worker cancellation,
native resizing, voice, microphone, overlay/DPI and latency remain unverified.

Full check results and final commits will be recorded after the gates finish.

## Commits

- `87c522d0`: integrate the existing workspace and reply presentation with main.
- `841dd5b0`: reject overflowing numeric strings in reply visuals.
- `e9cf910e`: contain malformed local-image address decoding.
- `244cd8f6`: parse file URLs through Node while retaining real-root containment.
- `9c0bdb88`: retain primary reply-image scope and clear it for worker inspection.
- `2d2d2679`: isolate the hello activation probe from the bundled visual default.

All commits are directly on `main`, as explicitly requested. No branch or PR was
created for this integration. The original side-workspace checkout is retained.
