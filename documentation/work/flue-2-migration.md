# Migrating Studio to Flue 2

**Written:** 2026-09-01, on commit `1760c545`, with the tree green.
**Source of truth:** the published `@flue/runtime@2.0.3`, `@flue/cli@2.0.3`,
`@flue/sdk@2.0.3` and `@flue/vite@2.0.3` tarballs, downloaded and read;
Flue's own `docs/guide/migration.md`, which ships inside the runtime tarball;
and this workspace's source. Where something is inference it says so.

This document is the plan. It is not a brief - each phase gets its own brief
in `prompts/` when its turn comes, written against the state the tree is
actually in by then, because a brief written six phases early is a brief
written about a tree that no longer exists.

---

## 1. What we are moving from and to

We are pinned to `@flue/runtime@1.0.0-beta.9`, published 2026-06-30. That
line never went stable. It was renamed `2.0.0` and shipped on 2026-07-31, and
everything published since exists only on the 2.x line. Four releases went out
in 2.0's first week; the last is `2.0.3`, on 2026-08-05.

So this is not an upgrade we are choosing to take. It is the branch we are on
having ended. The `next` dist-tag still points at `0.8.0-beta.6`, which tells
you how little attention the old lines get.

Two facts make the move smaller than the version jump suggests:

- **`engines` is identical on both sides** (`node >=22.19.0`).
- **`vite build` still emits `dist/server.mjs`, started with
  `node dist/server.mjs`.** The Tauri host spawns that artifact and nothing
  else, so the process architecture, the supervisor, the job object, the
  environment allowlist, and the whole webview → IPC → Rust → loopback chain
  survive untouched.

---

## 2. Verifying the report

`report/FLUE-V2-is-it-pain-or-bless.md` was written on 2026-08-31. I checked
its load-bearing claims against the real packages rather than reading it and
agreeing.

### Claims that hold

| Claim | How I checked it | Result |
|---|---|---|
| `defineAgent`, `defineWorkflow`, `defineAction`, `defineAgentProfile` are gone with no alias | grepped the whole 2.0.3 type surface | **True.** Zero occurrences. |
| The hook set exists as described | grepped declared exports | **True.** All 14 `use*` hooks, `createAgentRouter`, `defineTool`, `defineSubagent`, `defineSkill`, `dispatch`, `init`, `getAgentInstance`, `setProvider`, `sandboxFromDriver`, `instrument`. |
| `registerProvider` / `registerApiProvider` / `ProviderRegistrationError` removed | grepped | **True.** Zero occurrences. |
| Flue schema v5 → v8, reset-only, no in-place migration | read `migration.md` | **True**, and stated in Flue's own first section: the runtime rejects an older database before application code runs. |
| Tool `run()` returns `{ output?, terminate? }`; a bare string still works, any other bare value throws | read `migration.md` | **True.** |
| MCP in 2.0 is remote only | grepped `stdio` across all docs and types; read `McpConnectionDefinition` | **True, and absolute.** `url: string \| URL` is required, transport is streamable-HTTP or SSE, and the word `stdio` appears zero times in the entire package. |
| `isRetryableModelError` still has no quota or billing exclusion | read the function in the 2.0.3 bundle | **True.** The regex grew a `(retryable_interruption)` marker and a `provider finish_reason: error` alternative. Still nothing that stops a billing 429 from burning retries. |
| `waitForTransientModelRetry` is still invisible with one fixed budget | read the function | **True.** `MAX_TRANSIENT_MODEL_RETRIES = 3`, an internal warn log, no record written. |
| `composeSystemPrompt` drops the headless preamble but re-adds date, cwd, directory listing and an always-present `## Available Agents` | read the function | **True**, including the empty-roster paragraph telling the model not to call `task`. |
| The dependency set and engines | read `package.json` | **True** (the report omits `ulidx`, which changes nothing). |
| SDK is conversation-scoped with `send`/`wait`/`observe`/`history`/`abort`/`attachmentUrl` | read the SDK types | **True.** |

That is a good report. Everything I could falsify, I tried to.

### Four corrections

**1. `@flue/runtime/routing` still exists.** The report says the auto-router
"no longer exists", which reads as though the import path dies. The subpath is
still exported; what changed is what comes out of it. Our
`import { flue } from "@flue/runtime/routing"` becomes
`import { createAgentRouter } from "@flue/runtime/routing"`. Same line, same
file, different symbol. Smaller than described.

**2. The `VALID_THINKING_LEVELS` hunk is obsolete for a different reason.**
The report says upstream now includes `max`. What I found is that the named
constant does not exist in 2.0.3 at all - the validation was restructured, not
widened. The verdict (drop the hunk) is right; the reason to record is that
its anchor is gone, so there is nothing to re-derive against.

**3. The CLI patch may not need to be a patch at all.** This is the report's
"largest single patch item", and I think it stops being a patch. `vite build`
emits **two** entries: the self-starting `dist/server.mjs` and a non-listening
`dist/app.mjs` chunk that it imports, which the docs describe as what "a
custom host can import to embed the application in its own server". Every
behaviour our CLI patch injects - the fd-4 admission bootstrap read, the
`PROJECT_STUDIO_HARNESS_HOSTNAME` loopback bind, the fd-3 readiness frames -
is server-entry work. We can write that entry ourselves, in our own source,
importing `dist/app.mjs`, and delete the patch instead of re-deriving it.

The API shape supports this. `@flue/vite` ships
`dist/bootstrap/node-server.mjs` exporting `loadFlueNodeApplication()`, which
resolves to the complete lifecycle surface - `fetch`, `enterActivity`,
`pauseAdmissions`, `stop`, `closeSync`. An entry that calls it and then calls
`serve()` from `@hono/node-server` itself owns the listen, and therefore owns
the bind address, the bound port and the moment of readiness.

That last part matters, because the alternative does not work:
`startFlueNodeServer` accepts `hostname` but its `onReady` is typed
`() => void` with no address, and the `FlueNodeServer` it returns exposes only
`stop()` and `closeSync()`. Neither surfaces the bound port - the same gap our
patch's third hunk fixes today. Owning the listen is what makes the patch
unnecessary rather than merely smaller.

That is a strictly better outcome than the report predicted, and it is the
single biggest reason to sequence the handshake early: if the embed path does
not work the way the docs say, everything downstream needs replanning, and we
want to learn that in week one rather than week three.

**4. "MCP becomes framework work" is wrong for us.** The report's blessing
list says `useMcpConnection` replaces our wire plumbing - framing, JSON-RPC
correlation, era probes, lifecycle, backoff, handshake. It does not, because
**every MCP server Studio runs is a local stdio child process**, and 2.0's MCP
cannot speak stdio at all. The report is careful about this in section 2.9
("mounts a *remote* MCP server's tools") and then over-claims in 3.5. Task 51
already recorded the same finding from the other direction.

The honest position: 2.0 adds a remote MCP capability Studio does not have and
could offer later. It removes nothing from `src/extend/mcp/`. Our stdio stack
stays, in full, and stays ours to maintain.

---

## 3. What actually changes, and what does not

### Untouched (verified, not assumed)

- **`STUDIO/` in its entirety.** React app, design system, transcript,
  composer, Tauri shell. `@flue/react` is not a dependency, and the frontend
  never speaks to Flue - it speaks to our HTTP surface through the Tauri IPC
  seam. Nothing in this migration reaches it.
- **`STUDIO/src-tauri/`.** Supervisor, job-object containment, environment
  allowlist, the fd-4/fd-3 handshake, `service_fetch` / `service_stream`. The
  spawn contract is ours and the artifact name does not change. The frame
  shape, fd numbers, and environment variable names must keep matching
  `harness/channel.rs` and `bootstrap.rs` - that is a constraint on our new
  server entry, not a change to Rust.
- **Studio's product layer.** Admission, the permission kernel, `CallGate`,
  the native tool registry, sandbox containment and everything Task 50 and
  Task 51 landed, the snapshot store, projects, retrieval, app settings, our
  own migrations. None of it is Flue-coupled in a way 2.0 disturbs.
- **`src/db.ts`'s location and its import.** `@flue/runtime/node` still
  exports `sqlite`, and 2.0 wants `db.ts` at the source root, which is where
  ours already is.
- **The MCP stdio stack**, per correction 4.

### The whole Flue surface, enumerated

Thirteen files in `STUDIO HARNESS/src` import from `@flue/*`. That is the
entire blast radius:

| File | Imports today | Becomes |
|---|---|---|
| `agents/studio.ts` | `defineAgent`, `AgentRouteHandler` | A `'use agent'` module exporting a sync function. The delicate one. |
| `agents/title.ts` | `defineAgent` | The same conversion, dispatch-only, no mount. |
| `application/studio-runtime.ts` | `SandboxFactory`, `SessionEnv` | `SandboxFactory` survives with `createSandbox(options)`; check `SessionEnv`. |
| `application/harness-client.ts` | `createFlueClient` and seven types | Conversation-scoped client construction; the chunk types survive. |
| `conversations/titling.ts` | `dispatch`, `observe`, `FlueObservation` | Function reference instead of a name string; event renames. |
| `db.ts` | `sqlite` from `/node` | Unchanged import; store interface gains settlement and lease methods. |
| `models/adapters/local-adapter.ts` | `registerApiProvider`, `registerProvider` | Pi `createProvider` + `setProvider`. |
| `models/adapters/test-adapter.ts` | same | same |
| `observability/flue.ts` | `instrument`, `createOpenTelemetryInstrumentation` | Both names already correct; the events they carry are renamed. |
| `transport/http/create-app.ts` | `flue` from `/routing` | `createAgentRouter` from the same subpath. |

Plus, outside `src`: `package.json` scripts, `flue.config.ts`,
`pnpm-workspace.yaml`, `patches/`, and a new `vite.config.ts` and `app.ts`.

### The patches, one at a time

| Hunk | Verdict | Why |
|---|---|---|
| `@flue/cli` - bootstrap fd, loopback bind, readiness frames | **Delete the patch, own the entry** | Per correction 3. Falls back to post-build injection only if the embed path fails. |
| runtime - `VALID_THINKING_LEVELS` + `max` | **Delete** | The anchor no longer exists. |
| runtime - delegate retry classification to pi-ai | **Re-derive** | 2.0.3 still has no quota exclusion. Anchor moved to `dispatch-*.mjs`. |
| runtime - visible retries, per-class budget | **Re-derive, and grow it** | Still invisible, still one budget of 3. 2.0.3 also computes its own delay curve, so the hunk must now own the delay as well as the budget. |
| runtime - `composeSystemPrompt` | **Re-derive, smaller, and decide** | The preamble removal is upstream now. But 2.0.3 re-adds `Date:` computed with `new Date()` at compose time - the exact cache instability our patch exists to remove - plus cwd, directory listing, and an always-on `## Available Agents` section including new prompt text for an empty roster that nobody here has read. |

---

## 4. The hard parts, ranked honestly

**1. The conversation data reset.** Not code. User data. Flue's own SQLite
store is rejected at startup when it predates v8, and there is no in-place
migration. Every conversation on every machine that has run Studio is gone
unless something exports it first. This is the only item with an
irreversibility attached, which is why it is Phase 1 and not Phase 8.

It also collides with a decision we have been deferring: deletion semantics.
We already know the Flue transcript survives our purge - 23 Flue transcripts
outlived a delete. Whatever export we write has to know which of those are
real history and which are debris.

**2. The synchronous agent function.** 2.0 agent functions must be sync and
re-render before every model turn. Ours is an async initializer that calls
`runtime.start()`, `runtime.reconcile()`, and three `ensureDirectory` calls
before reading the conversation's turn settings.

Smaller than the report makes it, for one measured reason:
`conversationTurnSettings(id)` is **already synchronous**, so the read that
decides `useModel`'s argument needs no cache. The three async calls all have a
home - `SandboxFactory.createSandbox(options)` is async, receives
`options.id`, and is called once per initialized harness.

The open question, and it is a real one: **does `createSandbox` run before the
first render?** If the render happens first, `conversationTurnSettings` reads
a runtime that has not started. I could not settle this from the types, and
I am not going to guess. It is the first thing Phase 2's spike answers.

**3. The provider rewrite.** Mechanical but wide. Two adapters, plus mapping
`src/models/local/catalog.ts` into full Pi `Model` objects, each carrying its
own `baseUrl` and metadata, with no catalog hydration for custom providers.
The `streamSimple` implementation carries over unchanged; the wrapper around
it does not.

**4. The SDK reshape and the stream path.** `harness-client.ts` moves to
conversation-scoped clients. The chunk types survive, so the seam holds, but
the Rust `service_stream` path makes offset and retry assumptions that need
re-confirming against the new shapes. Also: `abort()` now aborts the
conversation's in-flight **and queued** work, with no per-submission abort.
For our one-run-per-conversation UX that is equivalent in practice, but it is
a behaviour change and should be written down rather than discovered.

---

## 5. The phases

Eight phases. Each one lands on `main`, green, with the app running, before
the next begins. That rule is the whole design: a migration that is
half-applied across three phases has no state you can ship from and no state
you can revert to.

**One phase at a time. One brief per phase. No phase begins until the previous
one is committed and the app has been driven by hand.**

### Phase 0 - The spike, thrown away

Answer the three questions that would force replanning, on a scratch branch,
with no intention of keeping the code.

1. Does a hand-written server entry importing `dist/app.mjs` support the fd-4
   read, the loopback bind, and the fd-3 readiness frames? (Decides whether
   the CLI patch dies or gets re-architected.)
2. Does `SandboxFactory.createSandbox` run before the agent function's first
   render? (Decides whether the turn-settings read needs a warmed cache.)
3. Does a `'use agent'` module survive our build with the Vite plugin, and
   does `vite build` produce a `dist/server.mjs` our Rust supervisor starts
   unchanged?

Output: three answers, written into this document. Not code.

**Exit:** the answers exist, and Phase 3's shape is decided.

### Phase 1 - The export, before anything moves

Write the conversation export and re-seed path, against the **beta** runtime,
while it still reads its own database. Run it on the real machine and prove
the output is complete.

Settle the deletion question here too: an export that faithfully preserves
23 orphaned transcripts is not a feature.

**Exit:** a real export of this machine's history exists on disk, verified by
count and by reading one conversation end to end. Nothing else has changed.

### Phase 2 - Pins and build

`@flue/*@2.0.3`, `pi-ai` to `^0.84`, add `vite` and `@flue/vite`, move the
build script, author `vite.config.ts`, move `defineConfig` to
`@flue/runtime/config` and drop the retired `root`/`output` fields.

Everything will be broken at the end of this phase except the build, and that
is expected - it is the one phase that does not end green, so it ends
**squashed into Phase 3** rather than committed alone.

**Exit:** `vite build` produces `dist/server.mjs` and `dist/app.mjs`.

### Phase 3 - The handshake, before the agents

Re-land the four behaviours the Rust host cannot flex - fd-4 admission
bootstrap, loopback bind, fd-3 readiness frames, and the port contract -
against whatever Phase 0 said the shape is. Delete the `@flue/cli` patch if
the embed path worked.

Prove it against the existing harness-launcher test seam **and** by launching
the real app, before a single agent is ported. This is the contract the Tauri
host cannot negotiate; everything after it assumes it holds.

**Exit:** the Rust supervisor starts the 2.0 artifact and gets its readiness
frame. Committed with Phase 2.

### Phase 4 - Routing and the two agents

`app.ts` with explicit mounts; `createAgentRouter(StudioAgent)` replacing the
`flue()` line in `create-app.ts`; admission middleware stays ordinary Hono
middleware registered before the mount.

Then both agents. `studio.ts` becomes a `'use agent'` module exporting a sync
function: `useModel` carrying the thinking level, `useSandbox(factory, { cwd })`,
`useTool` per tool, instructions as the return string, `durability` as a
static, `export const route` deleted. `title.ts` is the same conversion and
stays unmounted, because its only caller is an in-process `dispatch()`.

Pin `agentName` on both. Identity is the function name now, and a rename
without a pin is a storage-identity change.

**Exit:** the app runs a real turn, in Full Auto, that writes a file and runs
a command - the same proof Task 51 had to produce, because it is the proof
that the whole stack is connected.

### Phase 5 - Providers

Both adapters to `createProvider` + `setProvider`; the catalog to full `Model`
objects; `fauxProvider` in tests. `storeResponses` and the telemetry overrides
are gone with no replacement - check nothing depended on them.

Fold in the OpenRouter "Default" reasoning fix we have been deferring
(`thinkingLevelMap.off = null`) and the wrong docblock at
`contracts/models.ts:66`, because this is the phase that has the file open.

**Exit:** a real turn against the user's OpenRouter connection, one short
message, and the reasoning level the person chose is the one that is sent.

### Phase 6 - The client and the stream

`harness-client.ts` to conversation-scoped clients; the new send body shape;
renamed error codes; `wait()` semantics; abort scope written down. Confirm the
Rust `service_stream` offset and retry assumptions against the new chunk
shapes by reading `harness/` on the Rust side, not by assuming.

**Exit:** streaming works in the real app - a long turn watched end to end,
interrupted once, resumed.

### Phase 7 - Events, observability, and the stores

`run_start`/`run_end` to `agent_start`/`agent_end`; `runId` to `instanceId`
plus `submissionId`; `dispatchId` to `submissionId` across receipts, events
and telemetry; envelope `v: 3`. `titling.ts` consumes the renamed events.
`AgentSubmissionStore` gains its settlement and lease methods.

Adopt `@flue/runtime/test-utils` contract suites against our SQLite stream
store, which is free coverage on the one component this migration most
threatens.

**Exit:** telemetry shows a complete turn, and the contract suites pass.

### Phase 8 - The patches, last

Re-point `pnpm-workspace.yaml` to 2.0.3. Delete two hunks. Re-derive the retry
classification and the visible-retry budget, the latter now owning the delay
curve too. Then the `composeSystemPrompt` decision, made with a fresh prompt
diff actually in hand: either drop our `# Environment` block and lose the git,
shell and machine facts, or re-patch to suppress the duplication and the
unstable `Date:` line.

Patches last because a patch re-derived against a bundle we have not yet
proven we can run is a patch derived twice.

**Exit:** retries are visible again, the budget is per class, and the system
prompt has been read by a person.

---

## 6. Rules for every phase

These are the rules the previous eleven phases were run under and they are not
negotiable here:

- **One phase per brief, one brief at a time.** No phase starts before the
  previous is committed and driven by hand in the real app.
- **Delete the old thing in the phase that replaces it.** No compatibility
  shims, no `-v2` files sitting beside `-v1` files, no dead `defineAgent`
  wrapper kept "until we are sure". If a phase leaves two ways to do one
  thing, it is not finished.
- **Verify against real code, every time.** Not the report, not the tests, not
  this document. Reports have been wrong; this document will turn out to be
  wrong somewhere too, and each brief must say to record where.
- **Never rewrite an applied migration.** Append only, on our own store.
- **Never touch `~/.studio/` on the user's behalf.** The export in Phase 1
  reads and writes its own output file; it does not clean up.
- **The two suites run one at a time.** Concurrency produces bogus ENOENT
  failures. `pnpm test` builds first, and running `vitest` against a stale
  `dist/` has mis-attributed failures in two separate reports already.
- **`cargo clippy --all-targets` with zero warnings**, and Rust changes only
  where the fd contract genuinely moved.
- **Live model turns spend real money.** One short message per verification,
  never looped, never benchmarked, key never in a log or a report.
- No `any`, no non-const `as`, no non-null `!`. UTF-8, no BOM, LF. No
  en-dashes, smart quotes, curly apostrophes, ellipsis characters or emoji in
  source. Edit by hand, never with a script. No green placeholder tests.

## 7. What this migration deliberately does not do

Three things wait until after Phase 8, each for its own reason:

- **Remote MCP** (`useMcpConnection`). A capability we do not have today. It
  does not replace the stdio stack and must not be bundled with the runtime
  move - the permission wrapper has to be proven around it first.
- **Parallel tool calling.** 2.0 runs a batch in parallel and serializes its
  own `write`/`edit` behind a per-path lock, which is the design we
  independently landed in `access-log.ts`. Adopting it is a behaviour change
  to the agent loop and deserves its own task, after the runtime is stable.
- **Delete and archive.** Phase 1 settles what an export contains. The product
  mechanism is a separate task, and it is better designed against the v8
  schema than the v5 one.

## 8. Open questions

Recorded because a plan that hides its unknowns is a plan that gets believed.

1. Does `createSandbox` run before the first agent render? (Phase 0)
2. Does the `dist/app.mjs` embed support our fd handshake? (Phase 0)
3. What is in 2.0.3's empty-roster `## Available Agents` paragraph, in full,
   and do we want the model reading it? (Phase 8)
4. Does anything depend on `storeResponses` or the removed telemetry
   overrides? (Phase 5)
5. How many of the 23 orphaned Flue transcripts are real history? (Phase 1)
