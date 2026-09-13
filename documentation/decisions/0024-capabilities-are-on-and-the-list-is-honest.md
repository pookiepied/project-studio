# ADR 0024 — Capabilities Are On, And The List The Model Sees Is Honest

**Status:** accepted
**Closes:** `T-28`.
**Amends:** ADR 0019's default, not its rule.
**Builds on:** ADR 0012 (permission and containment), ADR 0019 (running a chosen program), ADR 0022 (network).
**Amended by:** ADR 0025. "Provenance stays absolute" below described a
sandbox refusal that has moved to the policy. The list rule here is
untouched: `supports()` is still `assertSupports()` minus the exception, and
is still the only filter on what the model sees.
**Amended by:** [ADR 0041](0041-containment-is-the-kernel-s-job.md). The list
rule is *still* untouched — and what it now filters on has changed underneath
it, which is the point of having one rule instead of two. A connected tool used
to be refused permanently; it is now contained, so it appears. On a host whose
kernel cannot contain, it disappears again. See the corrected consequence at the
end of this file.

## Context

`allowExec` and `allowNetwork` both defaulted to off. Two problems came out of
that, and only one of them was the default.

**The default was wrong for the product.** An agent that cannot run a command or
reach the network is a text box. Both switches existed because "closed by
default" is a good instinct, and the instinct was applied to the wrong thing:
they are not the wall that protects the user.

**The list the model saw was dishonest.** `CallGate.list()` returned every
registered tool. `LocalSandbox.assertSupports` ran later, at call time. So a
switched-off capability still appeared in the prompt, the model called it, and
the call was refused. That is one wasted attempt — and, far worse, a whole
schema sitting in the cached prefix on **every turn**, paid for, to advertise a
refusal. `mental-model.md` §3.2 puts tools in that prefix precisely because the
list is supposed to be worth its space.

The second problem is the interesting one. It is `T-28`, and it is the same
shape ADR 0020 named: one meaning, two places, and the two disagreed.

## Decision

### 1. Both switches default to on

Containment is the wall. `readRoots` and `writeRoots`, enforced in `paths.ts`,
are closed by default, have no override, and refuse anything outside the folder
the user opened — `..`, symlinks pointing out, sibling folders sharing a name
prefix, other drive letters. **That** is what protects the user, and nothing
here weakens it.

The capability switches are not that wall and were never doing its job. What
actually bounds running a command is the chain ADR 0019 built: trust the folder,
a policy rule, an approval, and a restore point first. A boolean sitting in
front of all of that adds no safety a user would notice, and removes a
capability they installed the product for.

### 2. They still exist, and are easy to reach

Someone running this in a locked-down environment needs a way to say no, and
forking the code is not a way. Three ways to say it, in order of scope:

| Where | Reaches |
|---|---|
| `createSandboxPolicy({ allowExec: false })` | One workspace |
| `PROJECT_STUDIO_ALLOW_EXEC=off` | The whole process, no code change |
| `DEFAULT_CAPABILITY_SWITCHES` in `policy.ts` | The build, one line, for a fork |

Only an explicit `off`, `false`, `0`, or `no` disables a switch. An unset or
misspelled variable leaves the default alone — a typo in a deployment script
must not silently disable half the agent.

There is no UI for this, and there should not be one by default. It is a
deployment control, not a user preference. Anyone who wants a button has one
value to bind it to.

### 3. What the model is shown comes from the rule that decides the call

`LocalSandbox.supports()` is `assertSupports()` without the exception, and
`CallGate.list()` filters through it. The list and the decision can no longer
disagree, because there is only one rule and it is asked twice.

Writing the check out a second time inside `list()` would have been the same
defect wearing a fix.

**Permission is deliberately not consulted.** "You have not approved this yet"
is a question with an answer, and hiding the tool would take away the user's
chance to give it. Only what can *never* run is hidden.

`listAll()` returns everything registered, for a settings screen — which has to
render a switched-off capability in order to offer switching it on. The model
never sees it.

## What this does not change

**Provenance stays absolute.** A capability from a connected server is still
refused for `execute` and `network`, whatever the switches say. The switches
move the line for code we or the user chose; they have no effect at all on code
a third party chose. That is ADR 0019's rule, and it is untouched. `S-02` is
still what would change it.

**The roots stay closed by default.** A policy that had to be tightened rather
than loosened would start every new call site able to reach the whole disk, and
would become safe only if someone remembered.

## Consequences

- Nine native tools are usable out of the box.
- A tool that cannot run costs nothing in the prompt.
- MCP inherits this: a Phase 11 server whose tools the sandbox refuses will not
  appear in the model's list, with no second decision to make. **Still true, and
  it now fires for a different reason** — since ADR 0041 the sandbox refuses a
  connected tool not because of who wrote it but because *this machine* cannot
  contain it. On a host that can, the tool appears and runs inside a container.
  The rule did not change; the world it reads did.
- One test changed meaning rather than being deleted: "refuses an effect the
  sandbox cannot contain" now uses a *connected* capability, ~~which is the case
  where the refusal is absolute and permanent~~. **That clause is no longer
  true.** It was permanent only for as long as no isolation tier existed, and
  ADR 0041 built one for both supported platforms. The refusal is now
  conditional on the host, which is a weaker claim and a truer one.
