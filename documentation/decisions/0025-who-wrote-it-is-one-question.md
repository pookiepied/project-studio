# ADR 0025 — "Who Wrote It" Is One Question, And The Sandbox Was Not Asking It

**Status:** accepted
**Amends:** ADR 0012, ADR 0018, ADR 0019, ADR 0022, ADR 0024 — each states its rule
in terms of the word this decision splits.
**Precedes:** all Phase 11 work. Nothing MCP may be built on the old field.

## Context

`CapabilityProvenance` carried a boolean called `trusted`. Three places read it,
and each was asking a different question:

| Reader | The question it was really asking |
|---|---|
| `sandbox/local-sandbox.ts` | Can our containment reach this code? |
| `permissions/policy.ts` — `BASE_POLICY` | Must a human see this at least once? |
| `permissions/policy.ts` — `defaultVerdict` | May this run with no approval at all? |

One boolean answered all three, and it worked, because until now three facts
were the same fact: *we wrote it*, *it runs inside our process*, and *it is safe
unattended*.

Phase 11 breaks that equivalence in both directions at once. A server the user
installs is code nobody reviewed that they consented to. A server we bundle is
code we reviewed that runs outside our process. Neither value of one boolean is
right for both.

### What the wrong value would have shipped

Setting `trusted: true` on an installed server is the choice that makes MCP work
at all, and it opens a hole with no visible symptom:

1. `BASE_POLICY`'s only rule stops firing — it is keyed on `!trusted`.
2. Evaluation falls through to `defaultVerdict`, which returns `ask` with source
   `"default"`.
3. `resolveAsk("full-auto", …)` allows a **default** `ask` unconditionally
   (`permissions/mode.ts:73`).

Full Auto would silently run third-party server code. ADR 0018 states the
opposite in prose and names a test for it.

The test would not have caught it. `trust-and-modes.test.ts` builds its own
third-party descriptor, so it asserts the *rule* correctly and would keep
passing while the rule stopped applying to any real MCP capability. The rule was
tested; the wiring was not, and the wiring did not exist yet to test.

Setting `trusted: false` is no better: no MCP tool ever runs, and the escape
hatch has to be an MCP lookup wired into `LocalSandbox` — which makes `sandbox/`
import `extend/mcp/`, and gives `supports()` a second input after ADR 0024 spent
a decision reducing it to one.

## Decision

### 1. `trusted` becomes `author`

```ts
readonly author: "studio" | "third-party";
```

One question — *did we review this code* — and two readers, both in
`permissions/policy.ts`. `BASE_POLICY` keys on `"third-party"`;
`defaultVerdict` keys on `"studio"`.

`BASE_POLICY` stays a **policy** `ask`, which is the load-bearing part: ADR 0018
lets a mode resolve a *default* `ask` and never a policy one, so this verdict
survives Full Auto and the one below it does not.

### 2. There is no second field for where the code runs

The obvious companion — `in-process` versus `external` — is not added, because
nothing reads it. What isolation an effect requires is the effect table's
question (ADR 0020), and whether a program sits outside the folder wall is read
by the install dialog from the server record, not from a descriptor.

A field with no reader is the thing this codebase keeps deleting.

### 3. The sandbox stops asking who wrote the code

`assertSupports` now asks two questions: has the operator switched this effect
off, and do we have the isolation the effect requires.

The refusal it loses — *never run a connected server's code* — was never a
containment fact. It stood in for a consent path that did not exist. When it was
written, the only honest answer to "the user connected this" was "we have
nowhere safe to put it".

Phase 11 builds the path it was standing in for. Three explicit user actions now
sit between a server and a call:

1. Install it by hand, behind a dialog that states the consequence.
2. Select it into this specific project — off by default.
3. Approve the call, every time, through a policy `ask` no mode can resolve.

That is what replaces isolation we do not have. It is weaker than a sandbox and
stronger than a boolean, and it is now written where it can be argued with
rather than buried in a field name.

**The switch check moved ahead of the isolation check.** It used to sit behind
the provenance refusal, so it never applied to connected code — the code it most
obviously describes. `allowExec=off` now stops a stdio MCP server, which is what
the switch claims to do.

### 4. `NATIVE_PROVENANCE`

Nine tools repeated the same literal. A literal repeated nine times is a default
nobody wrote down, and the tenth tool inherits whichever neighbour it was pasted
from. One exported constant.

## What this does not change

- **`S-02` still matters, in the other direction.** Real isolation was never
  what made an MCP capability exist; it is what would let us relax the per-call
  approval. `local-sandbox.ts` used to imply the opposite.
- **Containment is untouched.** `readRoots` and `writeRoots` bound our own code
  and always did. They never reached into a separate process, and no wording
  here pretends otherwise.
- **Folder trust is untouched.** An untrusted folder still denies `write`,
  `execute`, and `network`, so MCP is off there with no new rule.
- **ADR 0024's list rule is untouched.** `supports()` is still `assertSupports()`
  minus the exception, still asked once, still the only filter on what the model
  sees.

## Consequences

- Two tests changed meaning rather than being deleted. `sandbox.test.ts` now
  asserts the sandbox is provenance-blind — a property of the new design, and a
  property nobody tests is a property that comes back — and a second test
  asserts the switch reaches connected code, which it previously could not.
- The guarantee those tests used to carry lives in `trust-and-modes.test.ts`,
  where it was already asserted and is now the only place asserting it.
- Phase 11 can declare an MCP capability `third-party` and have every reader
  behave correctly without a special case.
- A bundled server we wrote declares `studio`, and is a native tool that happens
  to speak a protocol.

## The cost of having waited

One interface, four call sites, nine literals, six test fixtures, and five
amendment notes — all in one change, with the suite as the check.

After `mcp_server` rows, per-project selection, and a settings screen exist, the
same change is a migration plus a re-derivation of what every already-stored
grant meant when it was given. That second cost is the one the owner named when
asking for this review.
