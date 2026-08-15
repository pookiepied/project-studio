# ADR 0012: Permission And Containment

Status: Accepted

**Amended by ADR 0025.** Where this document says a capability is *trusted*,
read `provenance.author === "studio"`. The boolean it named was answering
three questions at once, and Phase 11 broke the equivalence that let it.

## Context

Phases 10-13 add native tools, MCP servers, skills, and subagents. Each of them
can execute something on the user's machine. Deciding how execution is
authorized and bounded has to happen before any of them exist, because
retrofitting a boundary onto code that already runs without one never fully
succeeds.

Two questions are separate and both must be answered:

- **May this run?** — permission.
- **What can it touch once it does?** — containment.

An approved capability with no containment is an approval to do anything.
Containment with no approval is a boundary nobody agreed to.

## Decision

### One kernel decides, and it neither executes nor prompts

Native tools, MCP tools, and skill-provided actions all resolve through
`PermissionKernel`. The moment a second place can authorize execution, "what is
this agent allowed to do" stops having an answer.

The approver is injected, so the same policy runs identically in the UI, in a
CLI, and in a test. Evaluation order is policy, then stored grants, then the
default — a grant can never overturn a rule, so approving something once cannot
widen what the rules allow later.

An unregistered capability is denied rather than asked about. There is no
honest prompt to show for something whose effects are unknown.

### Effects and provenance are declared by the integrator

Never by the model, and never by the server describing itself. An MCP server
calling its own tool read-only does not thereby become read-only.

### Scope carries authority and is rejected when incomplete

`ExecutionScope` comes from application state. A blank agent or conversation id
would collapse distinct scopes into one bucket, so a grant given in one
conversation would apply everywhere and a subagent would inherit its parent's
approvals. Both are refused.

### Grants are visible and revocable

An approval the user cannot see or take back is worse than never having asked.
Revoking marks rather than deletes, so changing your mind does not erase the
audit trail. `once` stores nothing.

### Containment is closed by default

`SandboxPolicy` starts with no environment, no exec, and no network. A policy
that had to be tightened rather than loosened would mean every new call site
starts over-permissioned and only becomes safe if someone remembers.

The environment is built from the policy alone and never from `process.env`. An
agent inheriting the host environment inherits every API token on the machine,
which would undo the credential design in one line.

Path containment is written against the ways the check is normally got wrong:
string prefixes are not containment (`/work` is a prefix of `/work-secrets`),
`..` is resolved before comparing rather than pattern-matched, symlinks are
followed because a link inside the workspace can point anywhere, and Windows is
compared case-insensitively. A path outside the sandbox is *refused* on an
existence check rather than reported absent, because answering "no" lets an
agent map the filesystem by asking.

### The local sandbox states its isolation honestly

`LocalSandbox` is `in-process`. It constrains what our own code does on the
agent's behalf, which is effective against an agent that goes off-track — the
realistic failure — and is **not** a boundary against code that is actively
hostile, because a subprocess is outside our checks entirely.

So `execute` and `network` are refused there rather than approximated. Allowing
exec in policy does not grant the isolation to contain it; permission and
isolation are checked separately, and both must pass.

### Tencent CubeSandbox is the remote provider, not the local one

CubeSandbox was evaluated for this. It requires **x86_64 Linux with KVM** and
cannot run on Windows or macOS desktops, so it cannot be the sandbox for a
local-first harness the user runs on their own machine.

It remains the right answer for the `os`/`remote-vm` tier: it is Apache 2.0,
MicroVM-isolated, and E2B-SDK compatible, which means one client interface
covers self-hosted CubeSandbox and E2B Cloud alike. `IsolationLevel` exists so
the harness can route work that needs real isolation to that tier instead of
running it locally and calling the result sandboxed.

Flue's `SandboxFactory` is the seam this plugs into — it exists precisely to
wrap external sandboxes — so remote execution is an adapter, not a rewrite.

## Consequences

- Nothing calls the kernel yet, because no real tools exist. Wiring is Phase 10,
  and a tool that does not resolve through the kernel is the thing to catch in
  review.
- Exec and network are unavailable locally until the remote provider lands. That
  is a real functional gap, chosen over a sandbox that claims more than it does.
- The `once` duration authorizes a single call and is not re-checked mid-call;
  a long-running approved operation is not re-authorized partway through.
- Not yet decided: how a project binding supplies `readRoots` in practice, and
  whether a subagent's policy is derived from its parent's or declared
  independently. Both need Phase 13/14 to exist before they can be answered
  honestly.
