# Independent audit — prompt for a fresh session

Copy everything below the line into a new conversation with no prior context.
Do not summarise it; the length is deliberate. It is written to be read by
someone who knows nothing about this project.

---

You are auditing a codebase you have never seen. Your job is to find out what
is **actually true** about it, and to report every place where the repository
claims something that is not.

Nobody is asking you to fix anything. A fix you make is a fix nobody reviewed.
Your entire output is a report.

## The situation, stated plainly

This project is "Project Studio" — a local-first agent harness, comparable in
kind to Claude Code or OpenAI Codex: it runs an AI agent against a user's
workspace, with a permission system, tool calls, MCP extensions, snapshots and
undo, and a local database.

It has been through a long remediation cycle. Many things were fixed. The
reason you are here is that this project has a **history of declaring work
complete when it was not**. Documented examples, already known:

- A phase was marked "Done" for OS-level sandbox isolation with **zero lines**
  of isolation code in the tree.
- A test file was marked as covering "stop, timeout and cancellation" and
  contains **no timeout test**.
- Architecture tests passed *because* the violation they described was
  present — they asserted `offenders.length > 0`.
- A patch shipped calling a function that existed in **no version** of the
  dependency, so every agent submission returned 500, and it went unnoticed
  because the failure was swallowed by a catch block.

That is the failure mode you are hunting. Not typos. Not style. **Claims
without implementations, and implementations nobody ever asked for.**

## The one rule that matters

**Code is evidence. Documentation is a claim under test. Test names are
claims under test. Commit messages are claims under test. Comments are claims
under test.**

Never write "X is implemented" because a document says so. Open the file. If
you cannot point at the lines that do the thing, it is not implemented, no
matter how confidently something asserts otherwise.

Two habits that have repeatedly caught errors in this codebase, both of which
you should adopt:

1. **Never infer an identity or a value from its name.** A field called
   `agentId` in this repo held a conversation id for months, and two separate
   analyses got the bug backwards by reading the name and the default
   expression instead of measuring what actually flowed through it at runtime.
   If a value's meaning matters to your conclusion, print it, log it, or write
   a scratch test that observes it.
2. **Ask what would fail if this code were deleted.** If the answer is
   "nothing", you have found either dead code or a missing test, and both are
   findings. Where practical, actually try it: comment out the behaviour, run
   the relevant test, and see whether anything goes red. A test that passes
   with the implementation removed is not a test.

## Where things are

Repository root: `D:\Creative Library\Workspace\Project Studio`
Platform: Windows 11. Shell examples below are for PowerShell or Git Bash.

```
Project Studio/
├── STUDIO HARNESS/     ← the product. This is what you are auditing.
│   ├── src/            ← ~25 domain folders (permissions, sandbox, tools,
│   │                     extend/mcp, models, snapshots, storage, transport,
│   │                     observability, admission, auth, execution, …)
│   ├── tests/          ← unit/ and integration/
│   ├── patches/        ← hand-written patches against a dependency's built
│   │                     output, wired in pnpm-workspace.yaml
│   └── vendor/
├── STUDIO/             ← the client application
├── STUDIO Gateway/     ← RETIRED. A Cloudflare Worker, kept only as reference.
│                         Not built, not tested, not shipped, not part of 1.0.
│                         Its README says so. Do not audit it. Do not count
│                         its contents as dead code — that is already decided.
└── documentation/
    ├── decisions/      ← 38 ADRs. These are the richest source of claims.
    ├── architecture/   ← domain ownership, API inventory, project map
    ├── phases/         ← phase definitions
    ├── work/           ← the active remediation register (see "anchoring")
    └── archive/        ← superseded material, including the old task 008
```

Commands, run from `STUDIO HARNESS/`:

```bash
pnpm typecheck                 # tsc --noEmit
CI=true npx vitest run         # the full suite; takes several minutes
npx vitest run tests/unit/x.test.ts    # one file
npx flue build --target node   # produces dist/server.mjs
```

Capture long output to a file and grep it. Do not tail the suite to the
screen — a failing test's identity has been lost that way before.

Known-good baseline at the time this prompt was written: **73 test files,
1147 passed, 2 skipped, 0 failed**; typecheck clean; build clean. If your
numbers differ, that is itself a finding — say so before anything else.

The 2 skipped tests are claimed to be legitimate platform gates. Verify that
claim rather than accepting it.

## What to hunt

Seven categories. The last two are the ones this audit exists for.

### 1. Correctness defects

Logic that is wrong. Race conditions, unhandled rejections, swallowed errors,
resource leaks, incorrect SQL, off-by-one, wrong error propagation, missing
`await`. Pay attention to anywhere an error is caught and not re-thrown or
logged — that is how the worst bug in this project's history stayed hidden.

### 2. Claims that exceed implementation

For every "Done", "complete", "implemented", "verified", "enforced" in
`documentation/` and in code comments — find the implementation. Where the
implementation is absent, partial, or does something different from what is
described, report it with both sides quoted.

Give particular weight to claims about **security properties**: containment,
isolation, permission enforcement, secret redaction, trust boundaries. A false
claim about a security property is worse than a missing feature, because
someone relies on it.

### 3. Implementation that exceeds need

Exported functions with no callers. Classes nobody instantiates. Interfaces
with no implementors. Error kinds never thrown. Events never emitted. Config
options never read. Enum or union members with no code path.

Note that this codebase has a deliberate convention: some ports are declared
but not wired, and are marked in the source with a comment naming the ADR that
requires them. Those are **not** findings — but *verify the comment is true*
by checking the named ADR actually says that. An unmarked unused export is a
finding.

### 4. Tests that do not test

- Tests that pass when the implementation is removed.
- Tests asserting on their own mocks rather than on the system.
- `expect(x).toBeDefined()` where the real property is what `x` equals.
- Skipped tests, and whether the skip hides a gap.
- Whitelists and allow-lists in tests — are they empty, shrinking, or quietly
  accumulating entries?
- Tests whose name promises more than their body checks. The "stop, timeout
  and cancellation" file with no timeout test is the canonical local example;
  assume there are more.
- Fixtures, helpers or constants defined and never used — usually the residue
  of a test someone intended to write.

### 5. Platform claims resting on one platform

**Nothing in this repository has ever been executed on Linux or macOS.** Every
cross-platform statement is a Windows measurement plus an inference. Find each
one and mark it. Path handling, process termination, signals, file locking,
credential storage and sandboxing are the likely places where the inference is
wrong.

### 6. Silent omissions — things that should exist and were never discussed

**This is the most important category and the hardest.** You are looking for
the absence of something nobody ever wrote down, so no document will point you
at it. It cannot be found by reading; it has to be derived. Six methods that
work:

- **Enumerate every ADR's Decision section, then find its implementation.**
  38 ADRs, each stating something the system does. For each, locate the code.
  An ADR with no implementation and no "deferred" marker is a silent omission.
- **Enumerate every type union, enum and schema variant, then find producers
  and consumers for each member.** A member with neither is a declared feature
  that was never built.
- **Enumerate every database table and migration, then find the code that
  writes and reads it.** A table nothing reads is a feature that stopped
  halfway.
- **Enumerate every HTTP route and compare against the API inventory in
  `documentation/architecture/`.** Both directions: routes not documented, and
  documented routes that do not exist.
- **Enumerate every environment variable and config key read by the code**, and
  check each is documented and validated.
- **Ask what a product of this class must have, then look for it.** This is the
  method that finds what nobody thought of. A local agent harness handling
  untrusted model output and executing tools needs, at minimum: cancellation
  and timeouts on every long operation; crash recovery; concurrency limits;
  bounded growth of anything that accumulates (logs, snapshots, sessions,
  in-memory maps); secret redaction on every output path including errors and
  telemetry; child-process cleanup on every exit path including SIGKILL;
  a migration path for existing user data; and audit-ability of what the agent
  did. For each, find where it lives. If you cannot find it, that is a finding
  even though no document mentions it.

### 7. Blockers and decisions never taken

Places where the code, or a document, defers a decision that was then never
made — `TODO`, `FIXME`, "decide later", "for now", "temporary", "pending",
"will be moved in", "post-1.0" — and where the thing depending on that decision
shipped anyway. Search for those strings, then check each one's status.

## The anchoring problem — read this before you look at the register

There is an active issue register at
`documentation/work/phases-1-11-remediation.md`. It lists roughly 70 numbered
issues with their state, and it is detailed and mostly accurate.

**Do not read it until you have finished your own investigation.**

If you read it first you will spend the audit confirming its contents, and the
findings that matter most — the ones nobody has thought of — are by definition
not in it. Anchoring is the specific failure this audit is designed to avoid.

So: audit independently first. Then, at the very end, read the register and
split your findings into three lists:

- **Already known** — in the register, state matches what you found.
- **Known but understated** — in the register, but the register describes it
  as smaller, or in a different category, than the code shows.
- **New** — not in the register at all.

The third list is the value of this audit. If it is empty, say so plainly and
explain what you did to try to fill it, so the reader can judge whether the
emptiness is real.

## Evidence standard

Every finding must carry:

1. **Location** — `path/to/file.ts:123`, with the relevant lines quoted.
2. **The claim it contradicts**, quoted, with its own location — for claim-type
   findings.
3. **How it fails** — concrete inputs or state producing a wrong result, or the
   specific reason the code cannot do what is claimed. Not "this looks
   fragile".
4. **How you verified it** — read it, ran it, deleted it and watched a test
   still pass, printed a value at runtime. Say which.
5. **Confidence** — Confirmed (you executed something and saw it) or Plausible
   (you reasoned from the code but did not run it). Never blur the two.

Findings you could not verify still go in the report, in their own section,
marked as unverified with a note on what verification would require. An honest
"I could not determine this" is worth more here than a confident guess — this
project has been damaged specifically by confident guesses.

## Severity

- **Critical** — data loss, a security property that is claimed and absent, or
  a path where the product does not work at all.
- **High** — a wrong result users will hit, or a claim of completion that is
  materially false.
- **Medium** — a real defect with a workaround or a narrow trigger.
- **Low** — dead code, inconsistency, a doc that is stale but harmless.

Order the report by severity, not by the order you found things.

## Deliverable

Write to `documentation/work/audit-<YYYY-MM-DD>.md`:

1. **Baseline** — the exact suite, typecheck and build results you got, before
   anything else, so every later statement is anchored to a known state.
2. **Method** — what you actually examined and what you did not, honestly. If
   you read 40% of `src/`, say 40% and say which parts.
3. **Findings** — by severity, in the evidence format above.
4. **Silent omissions** — category 6, separately, because it will otherwise be
   buried under easier findings.
5. **Unverified** — what you suspect but could not confirm.
6. **Reconciliation** — the three lists against the register.
7. **The one-paragraph answer** — if the owner reads nothing else: is this
   codebase in the state the documentation says it is in? Yes or no, and the
   two or three things that most need attention.

## What not to do

- Do not modify source, tests, or documentation. Scratch files outside the repo
  are fine; a temporary probe you revert is fine if you say you did it.
- Do not fix anything you find, however small. Report it.
- Do not audit `STUDIO Gateway/`. It is retired reference material, already
  decided.
- Do not soften a finding to be agreeable, and do not inflate one to look
  thorough. A short accurate report beats a long padded one.
- Do not report style preferences, formatting, or naming you merely dislike.
- Do not claim you ran something you did not run.

Take the time this needs. Depth is the point; speed is not.
