> **Superseded — archived 2026-08-15.** Kept for provenance, not as current
> guidance. The live source of truth is
> `documentation/work/phases-1-11-remediation.md`.

# T-001 — Git baseline and snapshot

**Parent:** `A-003`
**Status:** Verified
**Opened:** 2026-08-15 · **Closed:** 2026-08-15

## What and why

Development had drifted onto `task/phase-11-mcp-l-06` with 87 uncommitted
files, and the repository no longer represented the current state of the work.
A recoverable snapshot had to exist before any cleanup or remediation.

## What was implemented

1. **Snapshot commit `95c99f6`** — the entire working tree as-is, unmodified:
   Harness `execution/` and `identity/` modules, `application/ports.ts`, ADRs
   0032-0034, the Flue patches, the Gateway observability/analytics/UI work,
   and the new documentation and task files.
2. **Tag `snapshot/phases-1-11-pre-remediation`** on that commit.
3. `main` fast-forwarded to it — the branch was 3 ahead, 0 behind, so no merge
   commit and no history rewrite.
4. `task/phase-11-mcp-l-06` deleted. One branch, `main`.

## Verification

```
git branch          main, alone
git status          clean
git tag             snapshot/phases-1-11-pre-remediation
```

Confirmed before committing that no `node_modules/` or `dist/` was staged.

## Notes

Five broken `refs/codex/turn-diffs/...` refs from another tool make git print
warnings on every `git branch`. Left in place: removing them is destructive and
was not asked for. They are harmless noise. Clearing them, if wanted:

```bash
git for-each-ref --format="%(refname)" refs/codex | xargs -r -n1 git update-ref -d
```

Line-ending warnings (LF → CRLF) are expected on Windows and were not
suppressed; adding a `.gitattributes` policy is a separate decision.

## Links

- `A-003`, `T-002`.
