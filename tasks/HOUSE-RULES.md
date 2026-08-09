# House rules for delegated work in STUDIO

Read this **before** the task file, every time, even if you have done work here
before. It is the difference between code that is correct and code that belongs.

Correct is not enough. Code that works but does not fit this codebase costs more
than code that was never written, because it has to be understood, argued with,
and then rewritten.

---

## 1. What STUDIO is

A **local-first, general-purpose agent runtime** with a desktop UI. Not a coding
agent. Coding is one thing it does well, not the thing it is.

Three properties break every tie:

1. **Readable.** Small enough to read in an afternoon and then change.
2. **Glue, not platform.** If a capability can be reached through an API, an MCP
   server, or a local binary, STUDIO connects it. It does not reimplement it.
3. **Local-first.** No required external infrastructure.

It is **open source**. Every decision has to serve someone who forks this, not
just the person who wrote it.

Full version: `documentation/mental-model.md`. Read it once.

## 2. The repository

```
Project Studio/
  STUDIO/            React 19 + Vite + Tailwind v4 + Tauri v2. The desktop UI.
  STUDIO HARNESS/    TypeScript on Flue + Pi + Hono. The runtime. Your work.
  documentation/     Repo-wide: mental-model.md, architecture.md, check-later.md
  tasks/             Work in progress. This file lives here.
```

Inside `STUDIO HARNESS/`:

```
src/
  agents/        agent definitions
  application/   wiring and startup
  auth/          sign-in
  contracts/     shared types. capabilities.ts, effects.ts, errors.ts
  credentials/   OS credential store. never a database column
  models/        model providers and adapters
  net/           destination rules. outside tools/ so every caller shares them
  observability/ logging, tracing, redaction
  permissions/   the kernel, policy, grant store, modes
  platform/      paths and OS differences
  process/       running subprocesses
  retrieval/     web search and fetch providers
  sandbox/       containment
  snapshots/     undo history
  storage/       SQLite
  tools/         the gate, the bounds, and the native tools
  vendor/        pinned binaries
docs/
  decisions/     ADRs. the real reasoning. numbered, and they amend each other
  ROADMAP.md STATUS.md KNOWN-ISSUES.md
tests/unit/      one file per subject
```

**Where a thing goes.** A rule that more than one caller must obey lives outside
the callers — that is why `net/` is not inside `tools/`. A rule only one place
enforces is a rule the second place forgets.

**Do not create an empty directory or a speculative abstraction.** A folder
exists when something is in it. An interface exists when it has two
implementations, or one implementation and a written reason.

## 3. The philosophy, in the form it actually gets applied

These are not slogans. Each one has already decided a real argument here.

**One meaning, one place.** A field answers one question. A boolean that answers
three is the bug we spent a whole item removing — see ADR 0025.

**Store what the user sets. Never store what the system computes.** Health,
protocol version, admissibility, connection state are derived on demand. Storing
them creates states nobody can explain and a migration to remove them later.

**Write the error message before the schema.** If you cannot write the sentence a
user reads when a state occurs, that state should not exist.

**A field with no reader gets deleted.** Do not add one for the future.

**Symmetry.** If two things are alike, they are handled alike. If you handle one
differently, say why in a comment, or make them the same.

**Delete rather than deprecate.** This codebase is young. There is no
compatibility burden.

## 4. Security rules that are absolute

Breaking any of these fails the work outright, however good the rest is.

1. **Secrets live in the OS credential store, never in a database column.** A
   migration guard fails any migration whose column names look like credential
   storage.
2. **Never put a credential or tenant authority into an argument the model can
   choose.** If the model can spell it, the model can widen it.
3. **A command is an executable path plus an argument vector. Never a string.**
   `shell: false` always. No `.bat` or `.cmd` on Windows — CVE-2024-27980.
   Absolute executable paths only. No inherited `PATH`. A vendored binary
   resolves against the installation, never the working directory.
4. **The approver never authors a permission pattern.** It picks a `scopeId`
   from `request.scopes`. No wildcard like `git:*` is ever offered, and nothing
   above the workspace root is ever offered.
5. **A destination is derived by our code from a parsed URL.** Loopback,
   link-local, private ranges, and our own listening ports are refused before
   the permission question. `169.254.169.254` serves cloud credentials to
   anything that asks.
6. **Anything that comes back from the network is untrusted content.** It never
   becomes a path, a command, an argument, or a URL for a following call, and it
   can never widen a scope or satisfy a permission.

## 5. The permission model, so you do not accidentally redesign it

There is one door: `CallGate.call` in `src/tools/gate.ts`. Everything executable
goes through it. A tool that checks for itself is opt-in, and opt-in security is
the absence of security.

The gate does, in this order: parse input, resolve the resource, ask the kernel
to authorize, ask the sandbox whether it can contain the effect, take an undo
snapshot if the effect table requires one, then run inside a deadline.

Three separate layers, and they are not the same question:

| Layer | Question | Where |
|---|---|---|
| Installed | Does this exist on this machine? | once, at add time |
| Enabled | Is it selected for this project? | per project, off by default |
| Approved | May this call happen? | the kernel, per call |

**Enabling can only subtract. It never grants.** Selection is scoping, not
permission. Do not add a permission check to a selection path, and do not let a
selection decide an approval.

**Do not invent a new permission concept.** If your task seems to need one, stop
and say so in your report. The single largest risk in this project is a
permission system that grows until nobody can predict what it allows.

## 6. Errors

One contract, enforced by `tests/unit/architecture.test.ts`:

- Every error class in `src/` extends `StudioError`. No exceptions.
- **Never `throw new Error(...)`** in `src/`. It lands in the `unclassified`
  domain, which measures code that was never onboarded.
- An error carries a `domain`, a `kind`, and whether it is `retryable`.
- The message is written for the person reading it, not for the developer.
  Short, plain, and it says what to do next where there is something to do.

## 7. Style

**TypeScript is strict.** No `any`. No `as` used to escape a type. No `!`
non-null assertion. If you need a type, write it. Prefer a union of string
literals over an enum, and `readonly` on interface fields.

**Modules use ESM with `.js` suffixes on relative imports** — `from
"../contracts/capabilities.js"` — even though the source is `.ts`.

**Naming says what a thing is, not what it does mechanically.** `classifyHost`
over `checkHostType`.

**Comments say why, never what.** Read `src/net/destination.ts` and
`src/tools/gate.ts` before you write any. The pattern: a comment explains a
decision, a trade-off, or a bug that happened. If the code already says it, do
not say it again. No banners, no `====` dividers, no TODOs.

Comments in code and prose in `docs/` use full prose with em dashes. **Your chat
report to the reviewer does not** — keep that plain and short.

## 8. Testing

`tests/unit/<subject>.test.ts`, vitest. Read a neighbouring test file and match
it exactly before writing a new one.

**The verification standard, and it is not optional:**

1. Write the test.
2. Break the code it covers — delete the line, invert the condition.
3. Run it and **confirm it fails**.
4. Restore.

A test that passes against broken code tests nothing. If it still passes in step
3, fix the test or say so in your report.

**Never delete or weaken an existing test.** If one fails, either your change is
wrong, or the test's meaning genuinely moved. If it moved, rewrite it to assert
the property in its new home and explain that in your report. Do not silently
change an assertion.

**If you add a rule nobody asked for, write a test for it and name it in your
report.** This is the one defect that got through last time.

## 9. Running things

From `STUDIO HARNESS/`:

```
pnpm check
```

That is `tsc --noEmit` then a Flue build then vitest. It must be green.

If pnpm prompts on this machine, use `CI=true pnpm check`. The full suite takes
about two minutes. Node is 22.18.0 and `node:sqlite` prints an experimental
warning that is expected and not your problem.

**Add no dependency.** Not one. Node's standard library and what is already in
`package.json`.

## 10. How you must not work

- **No batch files, PowerShell scripts, or shell scripts that edit source.** No
  scripted search-and-replace across files. Edit every file by hand, one edit at
  a time. Scripted edits have corrupted this codebase before.
- **ASCII only in source files.** No emoji. No smart quotes, no curly
  apostrophes, no en-dashes. Plain `'`, `"`, `-`. UTF-8, no BOM, LF endings.
- **Do not reformat code you are not changing.** No import reordering, no
  whitespace tidying, no unrelated fixes. The diff contains only your task.
- **Do not edit anything in `docs/`, `documentation/`, or `tasks/`.** The
  reviewer writes those. A wrong amendment note is worse than a missing one,
  because the next person believes it. Put your findings in your report instead.
- **Stay inside the files your task names.** If the task cannot be done without
  touching another, stop and say so rather than widening.

## 11. Git

Work on the branch your task names. One commit. Imperative subject line, and a
body that says **why**, not what — read `git log` first. No `Co-Authored-By`
lines.

Leave `MCP/studio-web-mcp/src/validation/url.ts` alone. Its changes are nobody's
and stay unstaged.

## 12. Your report

Plain and short. Six things:

1. Files changed, and what each change was.
2. Passing test count before and after.
3. For each new rule: which line you broke, and that the test failed as expected.
4. **Any rule you added that the task did not ask for**, and its test.
5. Anything you found that looks wrong but was out of scope. Name it, do not fix
   it.
6. Anything in the instructions that was wrong or impossible. Say so plainly
   rather than working around it silently.

Do not claim a verification you did not run. The reviewer re-runs them.
