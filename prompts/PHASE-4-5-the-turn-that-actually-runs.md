# Phases 4 and 5 - The turn that actually runs

Phases 2 and 3 got the server started. Nothing can take a turn: no provider
is registered, so every submission is admitted and then dies inside the run
with `internal error`, and the agents are shells with an honest list of what
is missing written into their docblocks.

This phase makes a turn work end to end, and its exit is the proof the whole
stack is connected: **a real conversation in Full Auto that writes a file and
runs a command.**

It is two phases in one brief for the same reason 2 and 3 were. Phase 4 ports
the agents; Phase 5 mounts the providers. Neither can land green alone - a
ported agent with no provider still cannot run a turn, and a mounted provider
with a capability-less agent has nothing to prove. Four integration suites are
red today (`harness` 2/26, `stop` 2/4, `mcp-flue` 1/2, `observability` 0/3)
and they come back together or not at all.

Read `documentation/work/flue-2-migration.md` (Phases 4 and 5, including the
amendments Phases 2/3 wrote into them) and
`report/PHASE-2-3-the-pins-and-the-entry-we-own.md` in full. The Phase 2/3
report's "What Phase 4 and 5 inherit" section is your task list; this brief is
the reasoning around it.

---

## Part 0 - What is already true, measured

Do not re-derive these. Re-check them if you like.

1. **The render runs before the sandbox factory, once per submission.**
   Phase 0 measured it in the 2.0.3 bundle: `renderAgentFunctionWithStructure`
   then `resolveSandbox`, and `SandboxFactory.createSandbox(options)` is async
   and runs once per submission's harness initialization, with the instance id
   in `options.id`.
2. **The instance id IS the conversation id.** 1.0's `conversation:${id}`
   prefix has no counterpart in 2.0.
3. **Tools do not go through `useTool`.** The plan says "useTool per tool" and
   that is wrong. Studio's tools ride the SandboxFactory's own `tools()`
   member, built from the `CallGate` inside `createAgentSandbox`
   (`registerNativeTools`, plus the MCP refresh). `useTool` would be a second,
   ungated path to the same capabilities. Do not open one.
4. **`createAgentSandbox` is synchronous and returns a `SandboxFactory`**, so
   the render can call it. What is async - `runtime.start()`,
   `runtime.reconcile()`, the three `ensureDirectory` calls - is what moves
   into the returned factory's `createSandbox`.
5. **`permission_grant` holds zero rows on this machine** (measured
   2026-09-01, read-only). That is why the scope decision in Part 2 is free
   today. Re-measure before you rely on it.
6. **pi-ai is dual-installed:** the runtime depends on `^0.83`, our direct
   dependency is `^0.84`, and both are in the store. This is the whole risk of
   Part 4 and it is named there.

## Part 1 - The sandbox, and where the async went

`studio.ts` mounts `useSandbox(runtime.createAgentSandbox({...}), { cwd })`.

The awkward part, and the one thing to measure before writing much: **`cwd` is
read at render time, and the directory it names is created later**, inside
`createSandbox`. Find out what 2.0 does with a `cwd` that does not exist yet -
whether it validates at render, at initialization, or never. If it validates
early, the directory creation cannot live in the factory and has to happen in
the render, which is a synchronous `mkdirSync` and a different shape. Measure
it; do not assume either way.

Everything the 1.0 initializer did asynchronously moves into `createSandbox`,
which runs once per submission and therefore **must stay idempotent per
call**. The runtime's project-keyed maps and recursive directory creation
already are; confirm rather than assert it.

Carry the reasoning that is already written in the 1.0 initializer's docblock
(`git show 0e6d8477:"STUDIO HARNESS/src/agents/studio.ts"`) - it is the
authority on why every root is passed rather than inherited, and why a
projectless conversation stands in its own directory instead of the harness
process's cwd. That paragraph is a security property, not history. It belongs
in the ported code.

## Part 2 - The scope, and one decision that is free today

`#69` was one argument at one call site: the agent instance id was passed
where the agent name belonged, which made a standing grant unable to leave the
thread that gave it. The guard is that the permission scope is built from the
instance id and the agent is named separately.

The vocabulary changes: 1.0 built `conversation:${id}`, and in 2.0 the
instance id already is the conversation id. So decide, and say why:

- **Drop the prefix** - the scope is the bare conversation id. Cleaner, and it
  matches what the id now means.
- **Keep the prefix** - the stored scope string does not move, so any standing
  grant survives.

The measurement above says `permission_grant` is empty, which makes this free
right now and would not have been three weeks from now. Re-measure it, state
the number you found, and if it is not zero, say what happens to those rows.
This is the user's data either way, so **do not silently orphan a grant**.

Whatever you choose, `agent-scope.test.ts` gets the assertion back: the scope
is built from the instance id, and two conversations of one agent are two
scopes. Phases 2/3 replaced that test with identity and model contracts
because the wiring did not exist; the wiring exists now.

## Part 3 - The prompt, the environment block, and the statics

- Instructions are the static prompt first, then the environment block. That
  order is the cache argument and it is load-bearing - the 1.0 docblock
  explains what was tried and reverted. Keep both the order and the reasoning.
- `durability` as a static on the function: `maxAttempts: 3` and
  `timeoutMs: 3_600_000`. The hour is deliberate and the docblock explaining
  it (a turn can stop and ask a person, and waiting for a human is the one
  thing that legitimately takes a long time) must survive the port.
- The titler's model ladder is DOWN and must come back here. 1.0 resolved
  `backgroundModelSpecifier` asynchronously; a 2.0 render is synchronous. Find
  the synchronous read - or say plainly that there is not one and what the
  cheapest honest alternative is. **Titling must not go back into service on
  the frontier alias:** eight words silently riding an expensive model is the
  exact spend the ladder exists to refuse. The orchestrator's retry contract
  (attempt N dispatched to `<conversation id>-t<N>`) is unchanged; the
  agent-side half - the render parsing the suffix to step down the ladder - is
  what returns.

## Part 4 - The providers, and the version that will bite

2.0's providers are Pi's own objects, registered through `setProvider`. Both
adapters' `register()` are documented no-ops waiting for this;
`local-adapter.ts` and `test-adapter.ts` are where the work lands, and the
test adapter's scripted `stream` is already exported for it.

**The hazard, stated once so it cannot be discovered the hard way:** the tree
carries two copies of pi-ai. If `setProvider` is called with an object built
against our `0.84` while the runtime resolves models through its own `0.83`,
the registration **silently does nothing** - no error, no warning, and the
symptom is exactly the failure the suite shows today. Establish which instance
the runtime actually resolves through, prove the registration took (a positive
`hasProvider`, or a turn that runs), and write down how you proved it. If the
two versions cannot be reconciled, deduping to one is a legitimate outcome -
say so with what it costs.

The deferred OpenRouter fix belongs here: **"default" currently sends effort
`"none"`, which turns reasoning off**. The no-patch fix is
`thinkingLevelMap.off = null`. While you are in `contracts/models.ts`, the
docblock at line 66 is wrong - fix it.

## Verification

- `pnpm typecheck` clean.
- `pnpm test` (which builds first - the integration tests spawn `dist/`).
  Suites one at a time. **All four red suites green**: `harness` 26/26,
  `stop` 4/4, `mcp-flue` 2/2, `observability` 3/3. Any test still red is a
  finding with a reason, not a rounding error.
- `cargo clippy --all-targets` zero warnings and the Rust suite still 65/65.
- **The exit, and it is not a test:** launch the real app, start a
  conversation in Full Auto, and have it write a file and run a command. Say
  which file, which command, and what came back. This is the same proof
  Task 51 had to produce, because it is the only thing that shows the render,
  the sandbox, the gate, the tools and the provider are all connected to each
  other rather than each connected to a mock.
- **The permission path, once:** one turn in Manual that stops and asks, and
  is answered. The hour-long timeout exists for exactly that and nothing has
  exercised it since the port.

Live model turns spend the user's money. The exit needs a handful of real
turns and no more: never loop one, never benchmark, and the key never appears
in a log, an error, a fixture, a screenshot, a test or the report.

## Not this phase

- **Do not re-derive the runtime patch hunks.** Phase 8. The regression is
  documented in `pnpm-workspace.yaml` and stays until then, which means
  retries are invisible and the budget is upstream's while you work. Do not
  mistake that for a defect you introduced.
- **Do not touch the client or the stream path.** Phase 6 owns
  `harness-client.ts`; Phases 2/3 adapted it only far enough to typecheck, and
  said so.
- **Do not verify the titling event envelope against real events.** Phase 7.
- **Do not touch `STUDIO/`** - not the frontend, not `src-tauri`. If a turn
  needs a Rust change, that is a finding.
- Do not delete the Phase 0 spike, the exports in the user's home folder, the
  `*.beta9-journal` files, or anything else under `~/.studio/`.

## Report

`report/PHASE-4-5-the-turn-that-actually-runs.md`: the sandbox port and where
the async ended up, what `cwd` validation actually does, the scope decision
with the grant count you measured, the titler ladder's restoration or an
honest account of why it could not be, how you proved the provider
registration took against the right pi-ai, the four suites' numbers, and the
real turn - the file, the command, the output. And every place this brief was
wrong.

Update `documentation/work/flue-2-migration.md`: mark Phases 4 and 5 done with
what actually happened, and amend any later phase an answer here changes.

## Rules

`Backend/`, `docs/`, `prompts/` and `report/` are read-only context, except
the one report file you write. Never `git checkout`, `switch`, `stash`,
`reset`, `clean`, `commit` or `rebase`.

No `any`, no non-const `as`, no non-null `!`. UTF-8, no BOM, LF. No en-dashes,
smart quotes, curly apostrophes, ellipsis characters or emoji in source. Edit
by hand, never with a script - including bulk renames, which the last phase
slipped on and recorded.

No green placeholder tests, and **never a test that stopped checking
anything** - the last phase left two tests asserting against their own
module's source text, which passes on a docblock. If a 2.0 hook makes a
behaviour unreachable from a unit test, say that in the test and assert the
value the behaviour is built from, not the file it lives in.

Applied migrations are never rewritten. Secrets never enter a log, a fixture,
a report, or an error.

Verify against real code and real runs. Not this brief, not the plan, not the
Phase 2/3 report - all three are secondhand, and briefs in this series have
been wrong in every phase so far.
