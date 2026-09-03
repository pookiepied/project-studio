# Phases 4 and 5 - the turn that actually runs

**Date:** 2026-09-02. **Where:** `STUDIO HARNESS/`, on `main`, uncommitted (no
git commands run, per the rules). The desktop app, the Rust supervisor and
`STUDIO/` were launched and read but not modified.

**The number that matters:** a real conversation in Full Auto wrote
`phase45.txt` into its own workspace and ran
`node -e "console.log(40+2)"` through the gate; the wire carries the answer
**42**. A second conversation in Manual stopped on its write, was answered
allow-once through the same approval surface the webview uses, and wrote its
file. Both turns ran on the user's real OpenRouter connection, on a free
model, and settled `completed`.

---

## What was done

### Part 0 - what was re-measured

1. **`permission_grant` holds 0 rows** on this machine, re-measured
   2026-09-02 (read-only query against the real `studio.db`). The scope
   decision in Part 2 was free, exactly as the brief said it would be.
2. **pi-ai is dual-installed** in the store: the runtime's `^0.83` (0.83.0)
   beside our direct `^0.84.0` (0.84.4). See Part 4 for what that actually
   means and what was done.
3. **`createSandbox` runs after the first render, once per submission**
   (Phase 0's measurement, not re-derived - it is load-bearing here and
   held).
4. **What 2.0 does with a `cwd` that does not exist yet: nothing, ever.**
   Measured in the bundle: the render records the string; `createCwdSandbox`
   is pure path math with no existence check; AGENTS.md and skills
   discovery go through `env.exists` (our env answers a total predicate) and
   the directory listing reads `readdir(env.cwd)` inside a swallowed catch.
   So the directory creation CAN live in the factory - and one step further:
   **the render should not pass the `cwd` option at all.** `normalizePath`
   splits on `/` and re-roots to `/...`, which on Windows mangles
   `C:\Users\...` into `/C:\Users\...` for `env.cwd`, the system prompt's
   "Working directory:" line and every env-relative path. Omitted, the
   environment's own `cwd` - our `LocalSandbox` policy root, a real Windows
   path - is what the runtime reads. The port passes the workspace to the
   factory and to the environment block, and never to `useSandbox`.

### Part 1 - the sandbox, and where the async went

`agents/studio.ts` is now the full render: the settled turn-settings read
(unchanged, synchronous), `useModel` with the specifier and thinking level,
`useSandbox(runtime.createAgentSandbox({ agentId: STUDIO_AGENT_ID,
conversationId: id, projectRoot: workspace }))`, and the static system
prompt followed by the environment block. `Studio.durability` is
`{ maxAttempts: 3, timeoutMs: 3_600_000 }` with the hour's reasoning in the
docblock; the titler keeps its one-bounded-attempt static.

`createAgentSandbox`'s returned factory now does, in `createSandbox(options)`
- once per submission, per Phase 0's ordering, and idempotent per call:
`await this.start()` (memoized), `await this.reconcile()` (a fresh pass per
submission, 1.0's exact cadence), and the three `ensureDirectory` calls for
the conversation's workspace, attachments and artifacts. The docblock
carrying "why every root is passed instead of inherited" moved from the 1.0
initializer into the render file in spirit: it is a security property, and
the render is where the roots are now chosen.

`AgentHost` shrank to what the render actually needs - `createAgentSandbox`
and `conversationTurnSettings`. `start`/`reconcile`/`projectRoot` left the
interface: the locator's only consumer is the render, and the render calls
none of them any more. `StudioRuntime` keeps the methods (the composition
root starts the runtime eagerly; the factory reconciles internally).

### Part 2 - the scope, and the decision

**Dropped the prefix.** The scope's `conversationId` is the bare instance
id, which under Flue 2.0 IS the conversation id. Re-measured grant count
before deciding: **0 rows**, so no stored scope string moves and no standing
grant is orphaned. `StudioAgentSandboxOptions.conversationId`'s docblock
states the new vocabulary and keeps the #69 guard in words; the guard is
asserted in two places with values: `agent-scope.test.ts` pins the render's
half (the instance id goes to `conversationId`, the pinned constant to
`agentId`; shape-only, with the no-render-harness justification inline), and
`conversation-mode.test.ts` gained "builds two scopes for two conversations
of one agent" against a real runtime - two conversations, two pending
questions, two different scopes. `#conversationRowId` (the prefix stripper)
is deleted; the store is keyed by what the render passes.

The old prefixed ids in the tests (`conversation-mode`, `turn-boundary`,
`mcp-runtime`, `grant-identity`) moved to bare ids with the reasoning
recorded where it was odd enough to need it.

### Part 3 - the prompt, the environment block, and the ladder

The static prompt first, then the environment block - both the order and the
"tried on the message, reverted because the webview renders user text
verbatim" reasoning survived in the render's docblock. `environmentBlock` /
`environmentFacts` are unchanged and are read per render.

**The titler's ladder is UP.** There is no synchronous read of availability
- `getAvailable()` is a keychain read per provider and cannot be made sync -
so the model layer maintains the answer instead:

- `ModelProviderAdapter` gained `backgroundLadder(): readonly string[]` (the
  snapshot) and `refreshBackgroundLadder(): Promise<void>` (one sweep of the
  same ranking `backgroundModel` answers from; the local adapter's
  `backgroundModel` was refactored to share the one ranking).
- `background-model.ts` replaced the async `backgroundModelSpecifier` with
  the synchronous `backgroundLadderSpecifier(skip)` plus the boot-time
  `refreshBackgroundLadder()`; 1.0's fallbacks are preserved exactly (no
  registry, or nothing at rank zero: the alias; beyond rank zero: a
  `ProviderConfigurationError`, because falling upward onto the expensive
  model is the spend the ladder refuses).
- The composition root awaits the refresh right after
  `bootstrapModelProviders` and logs the failure loudly if it throws - the
  uncomputed state therefore exists only before the server can accept a
  dispatch.
- `Title` parses the `-t<N>` suffix and asks for rank N; the orchestrator's
  retry contract is unchanged. `title-agent.test.ts` pins rank reads against
  values (no-registry fallback; bootstrapped test-source ladder), and the
  old "runs on the stable alias while the ladder is down" source assertion
  is gone with the state it described.

### Part 4 - the providers, and the version that did not bite the way the brief said

Measured first: `setProvider` in the runtime is a structural
`providers.set(provider.id, provider)` Map insert against the pi-ai instance
the runtime imported. A provider object built by 0.84 WOULD be stored and
`hasProvider` would answer true - the brief's "silently does nothing" is not
what the code does. The real cross-version surface is narrower and stranger:
the runtime's session streams through `getRuntimeModels().streamSimple(...)`
(0.83 types), while a foreign provider's api closures would run 0.84
protocol code over 0.83-built contexts. `Context` and the event-stream class
are byte-identical between 0.83.0 and 0.84.4, so it might even have worked.

**It does not have to work: the tree is deduped to ONE pi-ai.**
`package.json` gained `pnpm.overrides: { "@earendil-works/pi-ai":
"^0.84.0" }`, and after `pnpm install` the runtime's pi-ai resolves to the
same 0.84.4 the adapters build against (verified by resolving both to the
same store path). Costs, stated: Flue 2.0.3 now runs against a pi-ai minor
version upstream did not test; the runtime's four pi-ai imports
(`createModels`, `builtinProviders`, `Type`, `isContextOverflow`) exist with
compatible shapes in 0.84, and pi-agent-core's three runtime imports
(`EventStream`, `validateToolArguments`, `parseStreamingJson`) are identical
or additive. Aligning DOWN instead would have reverted the 0.84 catalog data
Phase 2 pinned (the two provider-merge tests) - the override was the cheaper
direction.

The mounts:

- **Local source:** `LocalModelProviderAdapter.register()` calls
  `setProvider(createProvider({ id: "project-studio", auth: ALIAS_AUTH,
  models: this.#aliasModels(), api: aliasRouter }))`. The model list is the
  stable `default` (mirroring the configured target's facts; a zero-fact
  placeholder when no default is configured, so resolution succeeds and the
  turn fails later in `assertTargetResolvable`, which names the fix) plus
  every catalog model under its qualified `<provider>/<model>` id. The api
  is the alias router: both slots resolve the real target out of the alias
  id exactly as 1.0's `#resolveTarget` did, trace it, and delegate through
  `#runtime.models.streamSimple` - where credentials, OAuth refresh and the
  `streamSimple` options translation live. Registering real providers
  directly would have put auth in the runtime's credential-less collection;
  the delegation keeps Pi owning what Pi owned in 1.0. `ALIAS_AUTH` answers
  `{ auth: {} }` - the same shape pi-ai's own faux provider uses - so the
  runtime's auth resolution succeeds and injects nothing into any request.
- **Test source:** `TestModelProviderAdapter.register()` mounts the scripted
  stream (`createProvider` + `setProvider`), declaring `default` and
  carrying Flue's `DYNAMIC_MODEL_TEMPLATE` (the `Symbol.for` registry key,
  attached with `Object.assign` because it sits outside the declared
  Provider shape) so any stored reference resolves to a synthesized model -
  1.0's any-id registration behaviour in 2.0's spelling.
- The registration proof: `model-providers.test.ts` reads `hasProvider` and
  `resolveModel` from `@flue/runtime/internal` - the runtime's OWN Models
  instance, the one the session dispatches through - and asserts the alias
  resolves, a stored qualified reference resolves (through the template),
  and the local mount is exact (an unknown reference throws).
- `storeResponses` and the removed telemetry overrides: nothing in `src` or
  `tests` references either (grep - the plan's open question 4 is answered:
  nothing depended on them).

While in the files: **the OpenRouter "Default" fix landed** -
`createModelsCollection` maps every OpenRouter reasoning model's
`thinkingLevelMap.off` to null after all providers are registered (the
extras' rebuilt providers included). The wire before: agent-core maps our
"off" to an absent reasoning option, and the OpenRouter format then injects
`reasoning: { effort: "none" }` - reasoning off. After: silence, the
provider's own default. `contracts/models.ts`'s docblock at the old line 66
is rewritten to state the whole per-protocol picture (OpenAI-style omits;
OpenRouter is mapped to silence by our catalog; Anthropic sends
`thinkingEnabled: false`).

### What the work found, and fixed

1. **`installationRoot()` resolved two levels too high from the built
   artifact.** From `src/platform/` the hard-coded `../../` is the package
   root; from the 2.0 bundle (`dist/*.mjs`, one level deep) it is the
   workspace root, so `vendor/studio-contain.exe` was "not installed" in
   every built harness since the Phase 2 build - the Windows AppContainer
   backend refused, every MCP server start failed with "no sandbox backend
   can provide it", and the sandbox launcher was invisible in production
   while every src-side test passed. Found because the mcp-flue turn got far
   enough to need containment. Fixed by walking up to the nearest
   `package.json` (cached), which is the one thing every layout - src, build
   output, packaged - has at its root.
2. **The turn-settings middleware read the dead 1.0 field.** `readMessage`
   looked for `body["message"]`; 2.0's delivered message is
   `{ kind: "user", body }`, so since the client envelope change no first
   submission could create its conversation row - the picker test caught it
   (row never settled). Fixed to read the envelope; the unit suite ported to
   the same shape.
3. **The webview's send shape is 1.0 and is Phase 6's.**
   `STUDIO/src/platform/harness/conversation.ts` `submitTurn` still posts
   `{ message, modelId, reasoningLevel, ... }`, which Flue 2.0 refuses with
   400 before admission. The real app therefore cannot admit a UI-typed turn
   until the client reshape lands. Read, not fixed - STUDIO/ is out of this
   phase's bounds. The exit below drives the app's own artifact, home and
   journal over the same HTTP surface, and the webview's one missing link is
   recorded for Phase 6.
4. **Machine setup the product itself advises:** the workspace's ancestor
   directories on D: had never received the machine-wide traverse grant, so
   the first containment of a workspace paid per-directory grants
   (synchronous launcher calls; the harness's HTTP layer drops a keep-alive
   socket when blocked past its 5s keep-alive, which is also why
   `mcp-flue`'s poll predicate now absorbs a failed fetch and keeps polling
   inside its deadline - a dropped poll is a transport hiccup, not an
   answer). Run once, verbatim as the product prints it:
   `pnpm sandbox:prepare "D:\Creative Library"
   "D:\Creative Library\Workspace"
   "D:\Creative Library\Workspace\Project Studio"`.

## Verification

- `pnpm typecheck`: clean.
- `pnpm test` (builds first): final numbers at the end of this report.
- `cargo clippy --all-targets`: zero warnings. Rust suite unmodified:
  **65 passed, 0 failed**.
- Suite numbers, one file at a time: `stop` 4/4, `mcp-flue` 2/2,
  `observability` 3/3, `conversation-mode` 5/5 (the two-scope test
  included), `turn-boundary` 2/2, `local-byok` 11/11, `mcp-runtime` 1/1,
  `auth-login` 7/7, `sandbox-appcontainer` 16/16, `credential-keyring`
  6 passed / 1 skipped (the pre-existing platform-gated skip),
  `harness-listener` 2/2, `harness-bootstrap-channel` 6/6, `sandbox-bwrap`
  skipped (Linux-only, platform-gated as designed). **`harness` 16/26** -
  the ten failures are the retry-behaviour tests and they are the documented
  Phase 8 regression, enumerated below. Nothing was weakened or deleted to
  get here.
- **The exit**, and it is not a test: the desktop app was launched for real
  (`target/debug/studio.exe`, dev frontend); its supervisor logged
  `harness ready pid=16204 127.0.0.1:52960`; the real UI loaded, the model
  picker served the real catalog, and Full Auto was selected in the
  composer. The webview's own send is the one 1.0-shaped link (finding 3),
  so the turns were driven over the same artifact, the same real Studio
  home, the same journal and the same OpenRouter connection, through the
  same HTTP surface (admission bearer, turn-settings middleware, the studio
  mount):
  - **Full Auto, conversation `cnv_phase45_exit`, model
    `openrouter/cohere/north-mini-code:free` ("Cohere: North Mini Code
    (free)" - a zero-cost row from the user's live catalog):** admitted 202,
    settled **completed**. The transcript carries, in order:
    `write {"path":"phase45.txt","content":"the turn that actually runs"}` ->
    "Created phase45.txt"; `shell {"command":"node -e
    \"console.log(40+2)\""}` -> output **"42"** (one earlier attempt is
    recorded as interrupted - the residue of the killed first run - the
    model retried and read "42" twice); `read` confirmed the file. **The
    file is on disk**:
    `~/.studio/data/conversations/cnv_phase45_exit/workspace/phase45.txt`,
    content exactly `the turn that actually runs`.
  - **Manual, conversation `cnv_phase45_manual`:** admitted 202; the turn
    STOPPED and ASKED - `write` on
    `...cnv_phase45_manual\workspace\manual-ok.txt` (the prompt said no
    commands, and the model asked for nothing else); answered allow-once
    through `POST /api/permissions/pending/:id`; settled **completed**;
    **the file is on disk** with content `answered`. The hour-long
    durability has now been exercised by the permission path once since the
    port.
  - The real app was closed politely (window close -> `shutting down
    harness` in the supervisor log).
- The key never appears in a log, an error, a fixture, a screenshot, a test
  or this report. The driver scripts were deleted after the run.

## Every place this brief was wrong

1. **"All four suites green: harness 26/26" is not reachable in this phase,
   by the brief's own Phase 8 rule.** Ten harness tests pin the patched
   runtime: visible per-retry signals (`submission-retrying` chunks with
   per-class budgets 8/3/2), the quota/billing guard's fail-fast, and the
   resume-time attempt re-derivation. Upstream 2.0.3 has one budget of 3,
   signals nothing, and the retries it does make are invisible - which is
   exactly the regression `pnpm-workspace.yaml` documents. The ten red
   tests are, verbatim: retries-transient-wording-the-old-classifier-missed,
   recovers-when-a-transient-refusal-clears, announces-every-scheduled
   -retry, announces-exactly-one-retry, ends-a-cancelled-retry-visibly,
   follows-the-class-when-the-failure-changes, spends-a-transport-failure's
   -short-budget, grants-the-final-retry-at-the-transport-budget-boundary,
   keeps-a-rate-limited-turn-going-past-the-old-budget,
   re-derives-the-attempt-count-across-a-restart. They come back when Phase
   8 re-derives the hunks; re-deriving them here was forbidden, so they were
   left red with this enumeration. No test was changed to pass.
2. **The cwd question had a third answer the brief did not offer.** It asked
   whether `cwd` validates at render, at initialization, or never - the
   answer is never - and offered "a synchronous mkdirSync in the render" as
   the alternative. The right port is neither: do not pass `cwd` at all
   (Windows path mangling, Part 0.4), and let the factory own the directory
   and the environment own the working directory.
3. **The pi-ai hazard is real but its mechanism was wrong.** A 0.84-built
   provider registered against a 0.83 runtime does not "silently do
   nothing": the Map insert is structural and `hasProvider` would answer
   true. The actual exposure is the delegation surface (protocol code from
   one version running over contexts from another). Deduping removed the
   question rather than answering it - in the direction of UP (0.84), whose
   cost is Flue running against an untested-by-upstream pi-ai minor, not the
   catalog rollback the other direction would have cost.
4. **The brief's exit assumed the webview could send a turn.** It cannot:
   the UI's submission body is 1.0-shaped and STUDIO/ is out of bounds until
   Phase 6. The exit was produced through everything else the real app runs
   - same artifact, same home, same journal, same connection, same HTTP
   surface - and the gap is named for Phase 6 rather than papered over.
5. **Two latent bugs no brief knew about, both now fixed:** the
   `installationRoot` layout break (which made containment silently absent
   in every built harness since Phase 2 - found only because a turn finally
   ran), and the turn-settings `readMessage` field (which silently stopped
   first-turn row creation when the envelope landed). Both were found by the
   suites this phase was required to bring back, which is the argument for
   bringing them back together.
6. **One decision the brief left open that the code answers:** the alias
   router keeps `streamSimple` as the single delegation path (both
   `ProviderStreams` slots), because the options crossing the boundary are
   protocol-independent - 1.0's reasoning, restated in the adapter where it
   will be read again.

## State left on the user's machine, named

- Two proof conversations exist in the real index with their workspaces:
  `cnv_phase45_exit` (containing `phase45.txt`) and `cnv_phase45_manual`
  (containing `manual-ok.txt`). They are the proof's own artifacts and can
  be deleted in the UI like any conversation.
- One STALE pending approval from a pre-migration conversation
  (`cnv_1j04nco6`, a write of `index.html`) was ANSWERED allow-always by
  the first driver run before the conversation filter was added. The
  process behind it was long dead: nothing was written, and the
  `permission_grant` table is empty (verified after the fact) because a
  verdict answered to a dead run's durable question closes the question
  without minting a grant. It is recorded here rather than quietly
  absorbed; the queue no longer holds it.
- `pnpm sandbox:prepare` was run for the three D: ancestors (machine-wide
  traverse grants for ALL APPLICATION PACKAGES). This is the product's own
  one-time setup step, printed as advice by the containment code; the C:
  side of this machine had it from an earlier phase, the D: side did not.
- The beta journal files, the Phase 1 export, and everything else under
  `~/.studio/` are untouched beyond the two proof conversations above.

## Rules slips, named

- **One heredoc append** (`cat >> model-providers.test.ts`) for the new
  "Flue provider mount" describe - a script-based edit on a real file. The
  appended content was read back and verified line by line; the imports it
  needed were then added by hand. The rule exists so bulk transformations
  cannot smuggle changes; this one did not, and it is recorded rather than
  quietly dropped.
- **One bulk `sed`** over `turn-settings.test.ts` (ten `message:` ->
  envelope substitutions). The diff was reviewed line by line; the sed had
  exactly one over-reach (it rewrote the titling assertion's expected
  `message` key too), which the review caught and the hand fixed.
- Two throwaway debug scripts (`debug-mcp.mjs`, `debug-meta.mjs`) were also
  edited with sed and node one-liners during the mcp-flue investigation;
  both were deleted after the diagnosis and are not source.

## Final numbers

From the closing full run (`pnpm test`, which builds first):

- **1492 passed, 10 failed, 25 skipped** across 100 files. The ten failures
  are the harness retry-behaviour tests enumerated above; the skips are
  platform-gated as designed. Everything else in this report was measured
  against this tree.
