# ADR 0039 — A child process inherits nothing it was not given

**Status:** Accepted · 2026-08-15
**Supersedes:** nothing. Generalises the rule `process/exec.ts` already applied
to tool subprocesses, and extends it to the one boundary that was exempt.

## Context

Project Studio starts three kinds of child process, and until now each spawn
site decided for itself what the child would inherit.

The tool runner was strict. `process/exec.ts` stated that "the environment is
built from policy, never from `process.env`", enumerated four OS variables as a
deliberate exception, and went as far as blanking `PATH` explicitly — because on
Windows omitting it does not omit it.

The desktop Host was the opposite. `supervisor.rs` handed the Harness the entire
host environment and removed one variable:

```rust
// Inherit filtered env: keep PATH, HOME etc but not secrets? For now inherit all except credential.
cmd.env_remove("PROJECT_STUDIO_ADMISSION_CREDENTIAL");
```

Two opposite answers to one question, each locally reasonable, neither aware of
the other. The comment is honest about being unfinished — it is a question mark
and a "for now" in shipped code, on the process boundary the whole admission
design exists to control. That is meta-task **#74**.

What the Harness actually received was every variable in the shell that launched
the desktop app: `OPENAI_API_KEY`, `AWS_SECRET_ACCESS_KEY`, `GITHUB_TOKEN`,
whatever a developer's profile exports. The Harness runs model-directed tools. A
tool that reads its own environment is not exotic; it is `env`.

And `NODE_OPTIONS` was inherited, which is not a secret at all — it carries
`--require`, arbitrary code executed inside the Harness before any of our code
runs. Nothing downstream would observe it having happened.

## Decision

**An environment is built from a stated policy, never copied from the parent.**
One rule, three named policies, each owned by exactly one module.

| Kind | Started by | Policy | Owner |
|---|---|---|---|
| **Harness** | the desktop Host | `HARNESS_INHERITED_VARIABLES` — allowlist | `harness/environment.rs` (Rust) and `process/environment.ts` (TypeScript) |
| **Tool** | the Harness | `buildEnvironment()` — OS plumbing, `PATH` blanked | `process/environment.ts` |
| **MCP server** | the Harness | `buildEnvironment(declared)` — the same, plus the server record's own declared variables | `process/environment.ts` |

A new spawn site picks one of the three. It does not invent a fourth, and it
does not reason about individual variables at the call site — that is precisely
what produced the `// For now` line.

### Allowlist, not denylist

A denylist has to enumerate every secret anyone might ever export and is wrong
the first time someone invents a new one. It also fails silently: the variable
nobody thought of is passed through, and nothing reports it.

An allowlist is wrong in the direction that gets noticed. Something fails to
start, and the failure names the variable it wanted.

### The Harness is not the same kind of child as the tools it starts

It keeps `PATH` and a home directory, which the tool policy refuses. That is not
an inconsistency; it is the reason the kinds are named separately. The Harness is
first-party code whose job includes resolving real binaries — `vendor/resolver.ts`
and `tools/shell/resolve.ts` search `PATH`, and `platform/paths.ts` needs a home
directory or there is no `~/.studio` at all. Containment for the programs it then
finds is applied to *those programs*, by `buildEnvironment`.

Every entry on the Harness list was chosen by enumerating `process.env` reads
across `src/`, not by guessing what a Node process might want.

### The credential is never added, rather than removed

`PROJECT_STUDIO_ADMISSION_CREDENTIAL` travels over a file descriptor so it never
appears in an environment (008.5). The old code removed it after inheriting
everything. The new code clears first and adds only the list, so the credential
is absent because nothing put it there — a stronger statement than "we
remembered to delete it".

`env_clear()` before adding is the mechanism, and the ordering is load-bearing.

## Consequences

- **The lists exist twice and cannot import each other.** Rust cannot read the
  TypeScript constant and TypeScript cannot read the Rust one, so the duplication
  is structural rather than lazy. `tests/unit/harness-environment-parity.test.ts`
  parses the Rust declaration and fails if the two disagree — the same guard as
  the duplicated git subcommand lists (#78), for the same reason: each copy is
  internally consistent, so drift is silent. It reads the source rather than
  running cargo, so the check holds on a machine with no Rust toolchain.
- **The parity test is weaker than compiling.** It proves the declarations
  match, not that the code uses them, so `environment.rs` carries its own
  `#[cfg(test)]` module for the behavioural half — including one asserting that
  `env_clear` runs before anything is added.
- **A variable added on one side only is a bug in a specific direction.**
  TypeScript-only: a feature that works in development and silently does not in
  the packaged app. Rust-only: the Harness receives more than its own
  documentation says, which is how #74 happened.
- **Adding to the Harness list is a decision, not a convenience.** The list is
  the boundary; growing it because something failed to start is the correct
  reason, and growing it because it seemed harmless is how a denylist gets
  rebuilt by accident.
- **This ADR does not fix how the Harness binary is located.** `supervisor.rs`
  still runs `Command::new("node")`, a bare name resolved through the very
  `PATH` this list passes in — the thing `assertRunnableCommand` refuses on the
  TypeScript side. That is meta-task **#88** and is deliberately not folded in
  here: it is a resolution question, not an inheritance one.
