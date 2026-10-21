You are reviewing Project Studio's branch `fix/attachments-voice-local-provider`
against `main` (`git log main..HEAD`, `git diff main...HEAD`). Much of this
work was done by an unsupervised agent session. Assume nothing is correct
because a test passes. Do not change any code; this is a read-only review.

Before you start, read `AGENTS.md`, `README.md`, `documentation/rules.md` and
`documentation/architecture/observability.md`. The branch covers:
attachments (Office/PDF reading, page selection, UTF-16 text, pixel size),
voice delegation and sub-agent inspection, computer and browser screenshot
budgets, MCP oversize answers, self-hosted (9router) providers (probe facts,
vision), and a per-request picture window in
`STUDIO HARNESS/src/gateway/language/image-window.ts`.

Check, for every changed file:

1. Correctness: logic errors, edge cases (empty, huge, malformed input,
   concurrency, cancellation), wrong assumptions about provider/MCP behaviour.
2. Messiness: dead code, duplicated helpers that already exist elsewhere,
   inconsistent naming, comments that no longer match the code, leftover
   debug output, half-finished features, TODOs.
3. The observability contract: every new effectful path is instrumented; no
   content, arguments, credentials or picture data in attributes; stable
   stage names; the coverage inventory and progress doc are updated.
4. Tests: do they test behaviour or just mirror the code? Would they fail if
   the fix were reverted? Do any touch `~/.studio` instead of isolated state?
5. Scope leakage: unrelated changes in commits (the working tree has
   unrelated edits to `CLAUDE.md`, `.claude/launch.json`, `ArchivePane*` and
   `.studio-transcript-patch/` that must not be in any commit).
6. Security: path handling, refusal rules (plain HTTP on LAN), anything
   that sends data somewhere new.

Run, one after the other (they share sandbox resources):
`pnpm -C "STUDIO HARNESS" check` then `pnpm -C STUDIO check`.

Report in this format and nothing else:

## Verdict
Ready / Ready with fixes / Not ready, plus one sentence.

## Check results
Each suite: pass or fail, with counts and the failing test names.

## Findings
A table ordered by severity (Critical, High, Medium, Low) with columns:
ID | Severity | File:line | What is wrong | Why it matters | Suggested fix.
Only real, verified issues; say how you verified each one.

## Messiness and cleanup
A bullet list of non-bug quality problems, with file:line.

## Test gaps
Behaviour that changed but has no test that would catch a regression.

## Things that look right
Short list of areas you checked and found sound, so coverage is visible.
