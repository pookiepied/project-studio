# Stage 3 implementation plan — dead code and hygiene

Child of `phases-1-11-remediation.md`. Covers issues #24b and #30–#35. Retires
when the stage verifies.

**Baseline, measured 2026-08-15 at `ccfc662`:** `CI=true vitest run` →
**69 files · 1138 passed · 2 skipped · 0 failed**; `tsc --noEmit` clean;
`flue build` clean. (The meta-task §2 records 1137; that figure predates the
Windows descendant-kill test added in `ccfc662`. Corrected there.)

---

## 1. What the register claimed, and what the code actually shows

Stage 3 was written as a cleanup list. Reading the code first, as Stage 1–2
did, changes four of the seven items — two shrink to nothing, two turn out to
be larger than "dead code".

| # | Register said | Code shows | Net |
|---|---|---|---|
| 30 | `noUnusedLocals`/`noUnusedParameters` off, "so none of #31-#35 fails the build" | True, but the flags catch **only #33**. #31, #32, #34 are all *exported*, and `noUnusedLocals` never reports an export. The flags are worth turning on; they are not the enforcement #31–#35 needs. | **Narrower** |
| 31 | Two unreachable exports | Both are ADR-mandated, not accidental. `createRetryExecutionContext` is ADR 0033 §attemptId; `executionContext()` is the declared pair of `authContext()`. Same shape as #34. | **Reclassified** |
| 32 | `unsupported_isolation` never thrown | **Three** kinds are never thrown — `unsupported_isolation`, `unavailable`, `internal`. And `unavailable` is load-bearing: `SandboxError` computes `retryable: kind === "unavailable"`, so removing it makes that expression a constant `false`. | **Larger** |
| 33 | Three unused imports | Exactly three, in `src/`. Eight more in `tests/`, and two of those are the interesting ones — see #66. | **Confirmed + finding** |
| 34 | `PassthroughContextOptimizer` never wired — "wire or delete" | Neither, as stated: `roadmap.md:65` already records it as a deliberately unimplemented port from ADR 0003. The register and the roadmap contradict each other; that contradiction is the actual issue. | **Reclassified** |
| 35 | Two unbounded sets | `gate.ts` `#reportedWithheld` is **not** unbounded — its key space is (capabilities × switches), it is per-`CallGate`, and it dies with the sandbox. `studio-runtime.ts` `#turns` **is** unbounded, and worse than a leak. See §2. | **One is wrong, one is bigger** |
| 24b | `observability/index.ts:49` module singleton "needs a decision rather than a reflex" | It has a full lifecycle: guarded init, `shutdownObservability()` clears it, redaction is reset. It behaves like a resource, not like the storage globals #24 deleted. | **Decision, framed below** |

---

## 2. #35 is not a memory leak, it is a missing key

`studio-runtime.ts:344` registers one closure per sandbox and never removes it:

```ts
this.#turns.add(() => snapshots.beginTurn());
```

The register reads this as "grows for process lifetime". That is true, but it
is a symptom. Three facts together say what is actually wrong:

1. **Flue re-runs the initializer per run.** Its own doc comment:
   *"The initializer runs whenever a runner initializes a root harness from the
   agent definition. Do not treat it as a one-time constructor."*
   `agents/studio.ts:18` calls `createAgentSandbox` inside that initializer, so
   the set grows **once per run**, not once per process phase.

2. **Each dead entry still does work.** `prepareModelTurn()` iterates the whole
   set on every model operation, calling `beginTurn()` on the `TurnSnapshots` of
   every sandbox ever created. Cost is O(runs) per turn, forever.

3. **The key needed to fix it is already there and is being thrown away.**
   `registerFlueTurnBoundary` hands its callback a full `ExecutionContext`
   carrying `flueConversationId` (`observability/flue.ts:66-81`).
   `app.ts:77` wires it as `() => runtime.prepareModelTurn()` — argument
   dropped — and `prepareModelTurn()` takes no parameter.

So the registration is keyed by nothing because the only thing that could key
it is discarded one line from the call site. Keying it bounds the set as a
side effect.

**A second consequence, not previously recorded (#67).** Because each run gets
a fresh `TurnSnapshots`, its `#turn` counter restarts at 0 and the first
snapshot of every run is labelled `"turn 1"`. Undo history for a multi-run
conversation therefore contains repeated `"turn 1"` labels. `turn.ts:59-64`
documents the off-by-one it was careful to avoid; the re-initialization defeats
it anyway. Keying by conversation fixes the labels and the growth with one
change, which is why they are one step rather than two.

---

## 3. Options where the answer is not obvious

### #31 and #34 — ports declared by an ADR with no implementation

Three artifacts in this shape: `createRetryExecutionContext` (ADR 0033),
`PassthroughContextOptimizer` (ADR 0003), and `unsupported_isolation`
(ADR 0034 / decision #15). Each has a test, no production caller, and an ADR
saying it should exist.

| | Option | Consequence |
|---|---|---|
| (a) | Delete all three, supersede the ADR text | Honest tree. But ADR 0003 and 0033 are *Accepted* and still describe the intended design; superseding a decision because its implementation is not yet due is the wrong reason to move a decision. |
| (b) | **Keep, and mark each at the source as a declared-not-wired port, naming its ADR** | The tree stops looking accidentally dead. Costs three comments and a documented convention. The test stays honest because it stops being filed as an architecture test. |
| (c) | Keep silently, as today | The state that produced this issue. Every future audit re-finds them. |

**Recommendation: (b)** — with one exception. `executionContext()` is not an
ADR-declared port, it is a two-line accessor whose pair `authContext()` *is*
used. Keeping it is a judgement about API symmetry, not about a boundary; it
is small enough that either answer is defensible, and (b) applies to it only if
you want the symmetry. My preference is to keep it and say why.

`unavailable` and `internal` stay regardless: `unavailable` is referenced by
`SandboxError`'s own `retryable` computation, and `internal` is the fallback
kind every error union in this codebase carries.

### #32 is blocked on decision #15

`unsupported_isolation` is precisely the error a `SandboxFactory` would throw.
Deleting it under #32 and reinstating it under #15(a) is churn; keeping it
under #15(b) means labelling it as deferred. **#32 cannot be resolved before
#15 is.**

### #24b — the observability singleton

| | Option | Consequence |
|---|---|---|
| (a) | Inject the handle through the composition root like `database` | Consistent with #20/#24. But `initializeObservability` starts an OpenTelemetry SDK that registers *global* providers; the process genuinely has one, and a constructor parameter would be a second name for the same thing. |
| (b) | **Record Accepted: process-wide by nature, with a lifecycle** | It already has the properties #24 was missing — guarded init, explicit shutdown, state reset. The defect in #24 was a global that could be re-entered silently; this one throws `already_initialized`. |

**Recommendation: (b)**, recorded as a short ADR so the architecture test can
whitelist it by name rather than by accident.

---

## 4. Order of work

`noUnusedLocals` last, per the meta-task. Within Stage 3 the same logic
applies one level down: the flags are the *gate*, so they go on after the code
they would report is gone.

| Step | Issue | Files | Verify |
|---|---|---|---|
| 1 | #35 + #67 | `studio-runtime.ts`, `app.ts` | new test: N runs ⇒ one registration per conversation; turn labels continue across runs |
| 2 | #35 (gate) | — | none; the claim is withdrawn with evidence, not fixed |
| 3 | #31, #34, #32 | `context.ts`, `context-optimizer.ts`, `sandbox/errors.ts`, `architecture.test.ts` | comments land; optimizer test moves out of `architecture.test.ts` |
| 4 | #33 | `observability/index.ts:13`, `permissions/trust.ts:3`, `tools/git/index.ts:11` | `tsc` with flags reports zero in `src/` |
| 5 | #66 | `tests/integration/stop.test.ts` | the two MCP fixtures are used by a test, or the gap is registered |
| 6 | #24b | new ADR + `architecture.test.ts` | whitelist names the singleton |
| 7 | #30 | `tsconfig.json` | `CI=true pnpm check` |

After each step: `CI=true npx vitest run`. After step 7: `pnpm typecheck`,
`pnpm build`, `CI=true pnpm check`.

---

## 5. New issues found while reading

| # | Issue | Category |
|---|---|---|
| 66 | `tests/integration/stop.test.ts` defines `ECHO_SERVER` and `SLOW_SERVER` — two complete MCP stdio server fixtures — and **uses neither**. The file is titled "008.2 stop, timeout, cancellation, and disconnect" and has four tests, none of which involves an MCP tool. The timeout and MCP-tool-cancellation half of 008.2 was set up and never written. Deleting the constants to satisfy `noUnusedLocals` would erase the only evidence of the gap. | Needs Implementation |
| 67 | `TurnSnapshots.#turn` restarts at 0 on every run because the sandbox is rebuilt per run, so undo history repeats the label `"turn 1"`. Same cause as #35. | Needs Implementation |
| ~~68~~ | **Withdrawn — this was wrong.** Filed from reading the default expression `` `conversation:${agentId}` ``. Flue's initializer `id` is the agent *instance*, one per conversation thread; a probe against a running harness across two threads reported `alpha` and `beta`. Conversations are isolated. The real defect runs the other way and is #69. | Withdrawn |
| 69 | `ExecutionScope` has no agent dimension: `agentId` holds a conversation identity and `conversationId` derives a second copy of it. Because `grant-store.ts:108` filters on `agent_id`, a `duration: "always"` grant cannot outlive the conversation that made it, so `always` and `conversation` are the same answer. Fails closed. Pinned by `tests/unit/grant-identity.test.ts`. | Needs Decision |

**#69 is the one to look at first**, and it needs a decision before an
implementation — what a grant should be keyed by is not a question the fix
should answer by itself. It is recorded here because Stage 3 is where it
surfaced, not because it belongs to Stage 3.

**On #68, and why this section now has a withdrawal in it.** The first version
of this document asserted that all conversations shared one scope, and a
recommendation was given on that basis. It came from reading a default
expression instead of measuring what Flue passes. The measurement — a probe in
`agents/studio.ts` writing its `id`, run against two threads of a live harness
— took about four minutes and reversed the conclusion. The general lesson is
already this cycle's rule and was not followed here: an identity that is
*derived* from another value has to be observed at runtime before anything is
concluded from its name.

---

## 6. Blockers

| Blocks | What is needed | Why it blocks |
|---|---|---|
| **Step 3 (#32 only)** | Decision **#15** — OS isolation Accepted vs implemented | `unsupported_isolation` is deleted under one answer and documented-as-deferred under the other. |
| **Step 3 (#34 only)** | Confirmation that ADR 0003 stands | The register says "wire or delete"; `roadmap.md:65` says "kept deliberately". One of the two is wrong and I should not pick silently. Recommendation: **ADR 0003 stands, register entry is corrected.** |
| **Step 6** | Decision **#24b** — recommendation (b) above | It is a decision by definition; the meta-task filed it as one. |
| Step 5 scope | Whether #66 is written now or registered for Stage 5 | 008.2 is phase work (#49-#62 territory). Recommendation: **register it**, do not open phase work inside a hygiene stage. |

**Steps 1, 2, 4, 5 and 7 are unblocked** and are what this stage does now.

> **Correction, made during execution.** This section first listed step 7 as
> unblocked and step 5 as a scope question. That was wrong in one direction:
> with everything else fixed, `ECHO_SERVER`/`SLOW_SERVER` were the *only* two
> remaining errors, so turning the flags on was gated on #66 after all. Step 5
> is resolved as recommended — the gap is registered, not written — by moving
> the fixtures to `tests/fixtures/mcp-servers.ts`, which is where an unused
> fixture can live honestly. **This preserves the evidence; it does not close
> the gap.** #66 stays open.

---

## 7. Outcome

**After, measured 2026-08-15:** `CI=true vitest run` → **70 files · 1139
passed · 2 skipped · 0 failed**; `tsc --noEmit` clean *with the new flags*;
`flue build --target node` clean.

| # | Result |
|---|---|
| 30 | **Solved.** `noUnusedLocals` + `noUnusedParameters` on. Zero remaining errors tree-wide. |
| 31 | **Accepted (b).** `createRetryExecutionContext` marked declared-not-wired at the source, naming ADR 0033 and decision #12. `executionContext()` kept as the pair of `authContext()`. |
| 32 | **Blocked on #15.** Untouched, deliberately. |
| 33 | **Solved.** Three `src/` imports removed, plus six dead test-file locals the flags surfaced. |
| 34 | **Solved.** ADR 0003 stands — the register entry was wrong, `roadmap.md:65` was right. Source marked declared-not-wired; test moved to `context-optimizer.test.ts`, where it no longer reads as an architectural guarantee. |
| 35 | **Solved** for `studio-runtime.ts` — see §2, mutation-verified. **Withdrawn** for `gate.ts`: the claim was wrong. |
| 24b | **Solved.** ADR 0037, recommendation (b) taken. The three properties the argument rests on are now tests; two mutation-verified. No whitelist added — see below. |
| 66 | **Registered**, not closed. |
| 67 | **Solved** with #35; they were one defect. |
| 68 | **Withdrawn**, disproved by measurement. |
| 69 | **Registered**, with a characterization test. Needs a decision, not a patch. |

**On #24b, and what changed while implementing it.** The recommendation in §3
assumed the fix was a named exception in an architecture whitelist. There is no
general module-state test to whitelist against — the guard in
`architecture.test.ts` is specific to `storage/database.ts` and forbids a
module-level `StudioDatabase` binding. Widening it into a general rule with a
carve-out would leave it enforced by whoever remembered to add themselves to a
list. So the ADR's claims are asserted directly instead: read-before-init
throws, shutdown clears the handle, shutdown resets redaction. Removing
`resetRedaction()` or `handle = undefined` each fails the suite.

**Mutation check on the one behavioural change.** Reverting `#turnSnapshots`
to build a fresh `TurnSnapshots` per initializer run makes
`turn-boundary.test.ts` fail with `['turn 1', 'turn 1']` against the expected
`['turn 2', 'turn 1']` — the exact symptom described in §2. The test binds to
the behaviour, not to the shape of the fix.
