# Ledger

Append-only. Newest at the bottom. One entry per iteration, written by the lead
after adjudication — never by the implementer.

Each entry records what the gate said, not what an agent claimed.

---

## 2026-07-10 — Bootstrap

**Not a queue item.** Established the gate before any loop iteration, on the
principle that a queue without a gate produces confident unverified diffs faster.

**Doc purge.** Deleted 32 files / 11,091 lines: `Documentation/Unimportant Docs/`,
`Documentation/Tasks/Frontend Organize/`, `Documentation/Tasks/Project Studio Version 2/`.
Verified beforehand that no code outside `Documentation/` referenced them. Kept: the two
loop-engineer prompts and `Documentation/Tasks/Local Runtime and Frontend Reorg/`.
Recoverable from git history.

**Gate built.** Added `typecheck`, `deadcode`, `ratchet:lint`, `ratchet:cycles`, and
`gate` scripts to `STUDIO/package.json`. Added `STUDIO/scripts/ratchet.mjs`,
`STUDIO/knip.json`, and baselines in `STUDIO/gate/`.

Ratchets are strict — lint per-file, cycles per-cycle — because a total-only ratchet
lets an agent fix five violations in one file, add one in another, and report green.

`ratchet.mjs` invokes tool bin scripts via `process.execPath` rather than `npx`: Node
refuses to `execFile` a `.cmd` shim on Windows without a shell, and a shell would put
this repo's spaced path through cmd.exe quoting.

**Gate proven to fail.** Injected a raw `<button>` into `src/__ratchet_probe.tsx`.
Ratchet reported `233 (baseline 232)`, named the file, exited 1. Removed the probe;
exit 0. A gate never seen failing is a gate being guessed about.

**Baseline measured (not assumed):**

| Check | Result |
|---|---|
| `tsc --noEmit` | clean, 0 errors |
| eslint errors | 232, across 93 files, **all** the raw-`<button>` rule |
| eslint warnings | 23, all `react-refresh/only-export-components` |
| circular imports | 11 |
| unused files | 0 |
| unused dependencies | 0 |
| unused devDependencies | 1, unidentified → RT-009 |
| unused exports / types | 336 / 126 → RT-008 triage |

**Corrections to earlier assumptions.** Two claims made before measuring turned out
false, both in the codebase's favor. (1) "There is no typecheck" — `build` is
`tsc && vite build`, and `tsc --noEmit` is clean. (2) knip's initial "144 unused
files" was an artifact of missing entry points; with `knip.json` naming
`src/main.tsx` and `web/web-main.tsx`, the true count is **0**. Four of the five
design-system guardrails are already fully satisfied.

The real problem was neither: `npm run lint` exits nonzero unconditionally against a
232-error backlog, so it could not function as a pass/fail gate and would have been
skipped by humans and agents alike. The ratchet fixes that.

**Queue seeded** with the 11 cycles first (RT-001…RT-006) — several are `core/`
importing `features/`, an inversion of the intended layering — then the button
burn-down (RT-007), then triage items.

**Human decisions recorded:** smoke testing stays manual, by choice; new libraries
permitted; ratchets strict.

**Not committed at time of writing.** Doc deletions staged; gate files unstaged.
