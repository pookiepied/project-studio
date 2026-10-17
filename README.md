# Project Studio

A local-first, general-purpose agent runtime with a desktop UI. Coding is one
thing it does well, not the thing it is.

Three properties break every tie:

1. **Readable.** Small enough to read in an afternoon and then change.
2. **Glue, not platform.** If a capability can be reached through an API, an MCP
   server, or a local binary, Studio connects it. It does not reimplement it.
3. **Local-first.** No required external infrastructure.

## The products

| Product | What it is | Where |
|---|---|---|
| **Studio Harness** | The runtime. Agents, permissions, sandboxing, policy, execution, storage, MCP. Everything with authority. | `STUDIO HARNESS/` |
| **Studio Client** | The Tauri desktop application over the Harness. | `STUDIO/` |

One git repository, no submodules. Each product has its own `package.json` and
`pnpm-workspace.yaml`, so they are independent builds within one history and a
single commit can span both. The Harness is the primary codebase.

`Backend/` is a separate project — the undeployed `pookiepied.dev` umbrella scaffold — kept in
this repository as reference material. Ignore it: it is not part of any product here, and no
task in this repository modifies it.

## Stack

**Harness** — TypeScript on Node 24.19.0, Flue, Hono, `node:sqlite`. No ORM, no
external database, no required network service.

**Client** — React 19, Vite, Tailwind v4, Framer Motion, Tauri v2 (Rust).

## Running it

Node 22.18.0 and pnpm.

### Harness

```bash
cd "STUDIO HARNESS"
pnpm install
pnpm build        # vite build -> dist/
pnpm typecheck    # tsc --noEmit
pnpm check        # typecheck, build, then the full vitest suite
```

`pnpm check` is the gate and must be green before anything merges.

Two things that will waste an hour if nobody tells you:

**Build before you test.** The integration tests spawn the built entrypoint, so
`dist/` has to exist. Running `vitest` on a clean checkout fails about forty
tests for that reason alone, and none of the failures say so.

**Run the suites one at a time.** They contend for sandbox resources otherwise.

### Client

```bash
cd STUDIO
pnpm install
pnpm typecheck    # tsc -b
pnpm test         # vitest
```

`typecheck` here is `tsc -b` against a solution file. Running
`tsc -p tsconfig.json` instead typechecks nothing and reports success, which is
worse than no check at all.

Rust side: `cargo clippy --all-targets` must be zero warnings.

### Both workspaces

From the repository root:

```bash
pnpm typecheck    # the Harness's, then the Client's — the minimum gate
pnpm check        # both workspaces' full checks, strictly one at a time
```

`pnpm check` at the root is the gate for the whole repository: the Harness's
check (typecheck, lint, build, the full suite) and then the Client's, never in
parallel — the suites contend for sandbox resources. A client break fails the
root command exactly as a harness break does.

## Layout

```
STUDIO HARNESS/src/
  agents/        agent definitions
  application/   wiring and startup
  auth/          sign-in
  contracts/     shared types
  credentials/   OS credential store, never a database column
  models/        model providers and adapters
  net/           destination rules, shared by every caller
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
```

A rule more than one caller must obey lives outside the callers. That is why
`net/` sits beside `tools/` rather than inside it: a rule only one place
enforces is a rule the second place forgets.

## The permission model

There is one door: `CallGate.call` in `src/tools/gate.ts`. Everything
executable goes through it. A tool that checks for itself is opt-in, and opt-in
security is the absence of security.

The gate parses input, resolves the resource, asks the kernel to authorize,
asks the sandbox whether it can contain the effect, takes an undo snapshot if
the effect table requires one, then runs inside a deadline.

Three layers, answering different questions:

| Layer | Question | Where |
|---|---|---|
| Installed | Does this exist on this machine? | once, at add time |
| Enabled | Is it selected for this project? | per project, off by default |
| Approved | May this call happen? | the kernel, per call |

**Enabling can only subtract. It never grants.** Selection is scoping, not
permission.

## The native tools

Nine tools in five families, registered under one `native` namespace by
`registerNativeTools`:

| Family | Tools |
|---|---|
| filesystem | `read`, `write`, `edit` |
| search | `glob`, `grep` |
| git | `git` |
| shell | `shell` |
| web | `web_search`, `fetch` |

MCP tools register and unregister dynamically on top of these, filtered by
per-project enablement.

## Rules that fail work outright

1. Secrets live in the OS credential store, never in a database column.
2. Never put a credential or tenant authority into an argument the model can
   choose. If the model can spell it, the model can widen it.
3. A command is an executable path plus an argument vector, never a string.
   `shell: false` always. No `.bat` or `.cmd` on Windows (CVE-2024-27980).
4. The approver never authors a permission pattern. It picks a `scopeId` from
   `request.scopes`.
5. A destination is derived by our code from a parsed URL. Loopback,
   link-local, private ranges and our own listening ports are refused before
   the permission question is asked.
6. Anything returned from the network is untrusted. It never becomes a path, a
   command, an argument, or a URL for a following call.

Applied database migrations are frozen and append-only.

The full set is [`documentation/rules.md`](documentation/rules.md), and it is
required reading before changing anything.

## Style

TypeScript is strict. No `any`, no `as` used to escape a type, no `!` non-null
assertion. ESM with `.js` suffixes on relative imports even though the source is
`.ts`. Every error class extends `StudioError`; `throw new Error(...)` never
appears in `src/`.

Comments say why, never what. `src/net/destination.ts`, `src/tools/gate.ts` and
`src/process/interpreter.ts` are the files to read before writing one.

## Testing

`tests/unit/<subject>.test.ts`, vitest.

Every load-bearing test gets a negative control: break the mechanism on purpose,
watch the exact test fail, then restore it. A test that passes against broken
code tests nothing.

## Documentation

`documentation/` is the only documentation root.

Identity and instrumentation follow the [observability developer contract](documentation/architecture/observability.md).
Local Diagnostics settings provide opt-in bounded recording, scoped content,
stop, clear and export controls. Capture starts disabled and needs no account.
The separate external AI inspector is a later project.

| Path | What it holds |
|---|---|
| [`project-map.md`](documentation/project-map.md) | Where everything lives. Read first. |
| [`rules.md`](documentation/rules.md) | Constraints that fail work outright. |
| [`decisions/`](documentation/decisions/README.md) | ADRs, numbered. The real reasoning, cited by name from source comments. |
| [`architecture/`](documentation/architecture/) | How the system is shaped. |
| [`phases/roadmap.md`](documentation/phases/roadmap.md) | The source of truth for product phases. |
| [`audits/`](documentation/audits/README.md) | Read-only passes, dated, never amended. |
| [`work/`](documentation/work/) | The active meta-task. Temporary by design. |

`prompts/` holds the task briefs handed to implementing sessions; `report/`
holds what those sessions reported back. Together they are the record of why
each change was made.

## Backups

This repository is the backup. Git keeps its history in `.git`, inside the
project folder, so it protects against bad edits and not against losing the
disk. Commit and push often: anything that exists only in the working tree
exists in exactly one place.
