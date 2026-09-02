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

**Found, 2026-09-01.** Spike run from a scratch directory outside the repo
(`D:\Creative Library\Workspace\flue2-phase0-spike`); full measurements,
verbatim configs and honest gaps in
`report/PHASE-0-the-three-questions-before-the-work.md`.

1. **The embed path works, and the shape is better than an embed: the
   `@flue/cli` patch is deleted, not re-derived.** A hand-written
   `src/server.ts` imports `virtual:flue/server` and calls
   `loadFlueNodeApplication()`, then `serve()` from `@hono/node-server`
   itself - whose listener callback carries the bound `AddressInfo`, so the
   readiness frame, the loopback bind, the fd bootstrap read and the
   graceful stop are ordinary code in our source. `vite build` compiles it
   as the `server` input via a one-key config-merging plugin listed after
   `flue()`. `build.rolldownOptions.input` is one of `flue()`'s enforced
   paths, so setting it directly in `vite.config.ts` is overridden - with a
   warning naming the path, not silently, so expect that line and do not
   hunt it. A later plugin's `config` hook merges over the forced map
   instead, which is why the `app` entry survives and only `server` is
   replaced. The unmodified Rust integration test passes
   against the scratch build on Windows: frame parsed, admitted request 200,
   unauthenticated 401, polite shutdown inside the drain bound. The default
   generated entry, run under the same supervisor first, timed out without a
   frame - the negative control. One measured hazard: on Windows, the fd-0
   bootstrap read blocks forever when the entry is spawned by Node's
   `child_process` pipe stdio, and works when spawned the supervisor's way
   (`Stdio::piped`); Node-side test harnesses must spawn like the supervisor
   or feed the bootstrap from a file.
2. **`createSandbox` runs after the first render, once per submission.**
   Measured across two turns of one conversation: render, then
   `createSandbox` one millisecond later, then a second render - repeated
   identically on turn two. The async setup therefore moves into the
   factory's `createSandbox(options)` (`options.id` carries the
   conversation), which must stay idempotent per call; the render's
   synchronous `conversationTurnSettings` read needs no warmed cache.
3. **The build survives our shape.** `vite build` emits `dist/server.mjs`
   plus `dist/app.mjs`, scans and registers the `'use agent'` module, and
   accepts `flue.config.ts` from `@flue/runtime/config` with `root` and
   `output` strictly rejected. The working configs are recorded verbatim in
   the spike report for Phase 2 to lift.

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

**Done, 2026-09-01** (squashed with Phase 3; see
`report/PHASE-2-3-the-pins-and-the-entry-we-own.md`). The pins are in with
the exit met: `vite build` emits both entries and scans both agents under
their pinned identities. What the phase actually added beyond the plan:

- `@flue/cli` is **deleted**, not upgraded - nothing needs it once the entry
  is ours and the build is Vite's.
- The runtime patch failed the install exactly as designed
  (`ERR_PNPM_PATCH_FAILED`, hunks anchored to beta hashes), so its workspace
  entry is **removed until Phase 8** with the regression documented in
  `pnpm-workspace.yaml`: invisible retries, one shipped budget, no quota
  guard, and the unstable `Date:` line are back until the hunks are
  re-derived.
- `@hono/node-server` became a direct dependency (our entry imports it;
  under 1.0 it was only transitive).
- **The journal reset arrived here, not in a phase of its own:** Flue
  2.0.3's store rejects the beta journal on the DEFAULT path
  (`storedVersion: 4, supportedVersion: 1` - not the v5-to-v8 story this
  document carried), so no 2.0 harness starts until the old journal moves.
  With Phase 1's export verified, `~/.studio/data/flue.db` (+`-shm`,
  `-wal`) was RENAMED to `*.beta9-journal` - preserved, reversible, nothing
  deleted. Every machine taking this migration needs the same step.
- pi-ai is dual-installed (Flue's own `^0.83` beside our `^0.84`); Phase 5
  must register providers against the runtime's instance.
- The pi-ai bump moved Pi's generated catalogs (jamba retired from
  OpenRouter's list, image catalog 35 -> 50), and two `provider-merge`
  expectations were updated to the new data.

### Phase 3 - The handshake, before the agents

Land the four behaviours the Rust host cannot flex - fd-4 admission
bootstrap, loopback bind, fd-3 readiness frames, and the port contract - in
our own server entry, the shape Phase 0 proved: author `src/server.ts`
importing `virtual:flue/server` and calling `serve()` from
`@hono/node-server`, claim the `server` input with the config-merging plugin
recorded verbatim in the spike report, and **delete the `@flue/cli` patch**
from `patches/`. Nothing is re-derived; the behaviours are ordinary code.
One proof remains open from Phase 0: the Unix fd 3/4 transport was not
exercised on the Windows machine the spike ran on, so the integration test
runs once on a Unix box too.

Prove it against the existing harness-launcher test seam **and** by launching
the real app, before a single agent is ported. This is the contract the Tauri
host cannot negotiate; everything after it assumes it holds.

**Exit:** the Rust supervisor starts the 2.0 artifact and gets its readiness
frame. Committed with Phase 2.

**Done, 2026-09-01.** The exit is met and the whole proof ran: unmodified
Rust suite 65/65 (`a_real_harness_starts...` green, output verbatim in the
report), negative control FAILED against a frame-less entry exactly as it
must (supervisor kills it at the 30 s bound), the real app launched - eager
start, `harness ready`, webview up, and the window close drove the graceful
stop - and the Unix transport proof ran on the VPS (built 2.0 entry on real
Linux, bootstrap in on fd 4, readiness out on fd 3, 401/200/202, exit 0).

Two things the spike shape got wrong, fixed and recorded in the report:

- **The bootstrap read is its own module** (`src/host/bootstrap.ts`),
  imported first by the entry AND by the composition root: in the built
  artifact the app chunk's evaluation is hoisted to the facade's import
  line, so the spike's entry-body bootstrap read ran AFTER the admission
  session was created - random credential, everything 401. Phase 0's
  conclusion stands; its verbatim entry does not.
- The loopback bind **falls back to 127.0.0.1** when
  `PROJECT_STUDIO_HARNESS_HOSTNAME` is absent (fail closed toward ADR 0028;
  the supervisor refuses non-loopback frames anyway).

The Unix gap that remains is the Rust half only (`command-fds`' `pre_exec`
`dup2`, `process_group`, the SIGTERM sweep): compiling `src-tauri` on the
VPS needs system webkit/gtk packages that were outside the `~/temp` remit.
One `cargo test` run there, by someone with the package remit, closes it.

### Phase 4 - Routing and the two agents

`app.ts` with explicit mounts; `createAgentRouter(StudioAgent)` replacing the
`flue()` line in `create-app.ts`; admission middleware stays ordinary Hono
middleware registered before the mount.

Then both agents. `studio.ts` becomes a `'use agent'` module exporting a sync
function: `useModel` carrying the thinking level, `useSandbox(factory, { cwd })`,
`useTool` per tool, instructions as the return string, `durability` as a
static, `export const route` deleted. `title.ts` is the same conversion and
stays unmounted, because its only caller is an in-process `dispatch()`.

Phase 0's measured ordering shapes the port: the render runs before
`createSandbox` and the pair repeats on every submission, so `useModel`'s
argument comes from the synchronous `conversationTurnSettings` read in the
render - no warmed cache - while `runtime.start()`, `reconcile()` and the
three `ensureDirectory` calls move into the sandbox factory's
`createSandbox(options)`, which runs once per submission and therefore stays
idempotent per call (the runtime's project-keyed maps and recursive `mkdir`
already are).

Pin `agentName` on both. Identity is the function name now, and a rename
without a pin is a storage-identity change.

**Exit:** the app runs a real turn, in Full Auto, that writes a file and runs
a command - the same proof Task 51 had to produce, because it is the proof
that the whole stack is connected.

**Amended, 2026-09-01, by Phases 2/3:** the routing half and both agent
shells landed with the pins (the phase could not typecheck otherwise); what
remains here is the substance. `createAgentRouter` is mounted at
`/agents/studio` with an injectable `agent` option; `studio.ts` is a
`'use agent'` module with `agentName` pinned `"studio"`, the sync
turn-settings read, and an honest list in its docblock of what is missing;
`title.ts` is converted, unmounted, pinned `"title"`, with its model ladder
DOWN (both attempts run the stable alias - restore the ladder here).
`SandboxFactory.createSandbox` replaced `createSessionEnv` early (2.0
renamed it). One decision this phase now owns that the plan did not have:
1.0's permission scope used a `conversation:<id>` prefix on the instance id;
in 2.0 the instance id IS the conversation id, so the scope vocabulary is
just the id - carry `#69`'s guard (scope built from the instance id) into
the factory port and assert it in `agent-scope.test.ts`, which now pins
identity and the model contracts instead.

**Done, 2026-09-02** (see
`report/PHASE-4-5-the-turn-that-actually-runs.md`). The render is the full
port: `useModel` + `useSandbox` with the gated factory, the environment
block after the static prompt, the hour-long `durability` static, and the
async setup (`start`, `reconcile`, the three conversation directories)
inside the factory's `createSandbox`, idempotent per submission. **The scope
prefix is dropped** (grants re-measured at 0 rows first), the guard is
asserted with values against a real runtime (two conversations, two scopes),
and the render does NOT pass the `cwd` option - measured: 2.0 never
validates a `cwd`'s existence anywhere, and `normalizePath` mangles Windows
paths, so the sandbox environment's own cwd carries the workspace. **The
titler's ladder is UP** via a synchronous snapshot the model layer
maintains (`backgroundLadder` / `refreshBackgroundLadder` on the adapter
contract, awaited once at boot before the server accepts a dispatch);
1.0's fallbacks are preserved and the orchestrator's `-t<N>` contract is
unchanged. Found and fixed en route: `installationRoot()` resolved two
levels too high from the 2.0 bundle (containment silently absent in every
built harness since Phase 2 - the Windows launcher was "not installed"), and
the turn-settings middleware's `readMessage` still read the dead 1.0
`message` field (no first-turn row could ever be created). The real-app exit
ran: the desktop app launched, its harness went ready, and - the webview's
send body still being 1.0-shaped (Phase 6's client reshape) - the proof
turns drove the same artifact, home, journal and OpenRouter connection over
the same HTTP surface: Full Auto wrote `phase45.txt` and `shell` answered
**42**; a Manual turn asked, was answered, and wrote its file. Ten harness
tests stay red until Phase 8 (the visible-retry/per-class-budget regression
- enumerated in the report); nothing was weakened to get here.

### Phase 5 - Providers

Both adapters to `createProvider` + `setProvider`; the catalog to full `Model`
objects; `fauxProvider` in tests. `storeResponses` and the telemetry overrides
are gone with no replacement - check nothing depended on them.

Fold in the OpenRouter "Default" reasoning fix we have been deferring
(`thinkingLevelMap.off = null`) and the wrong docblock at
`contracts/models.ts:66`, because this phase has the file open.

**Exit:** a real turn against the user's OpenRouter connection, one short
message, and the reasoning level the person chose is the one that is sent.

**Amended, 2026-09-01, by Phases 2/3:** both adapters' `register()` are
documented no-ops and the test adapter's scripted `stream` is exported,
waiting for its `createProvider`/`setProvider` mount - every turn-driven
integration test currently fails with an internal run error, and comes back
when this phase lands. Two cautions the plan did not have: **pi-ai is
dual-installed** (Flue 2.0.3 depends on `^0.83`, we pin `^0.84` directly), so
`setProvider` objects must be built against the pi-ai instance the RUNTIME
resolves models through, or the registration silently does nothing - the
safest move is likely aligning our direct pin to the runtime's range. And
`AgentPromptResponse` is gone from the SDK: `harness-client.ts` already
returns `AgentReadResult` from `wait()` (adapted early for typecheck), so
check `storeResponses`-era assumptions against that shape here.

**Done, 2026-09-02** (with Phase 4; see
`report/PHASE-4-5-the-turn-that-actually-runs.md`). Both adapters mount
through `createProvider` + `setProvider`. The local source registers ONE
alias provider (`project-studio`) whose models mirror the local runtime's
catalog under qualified `<provider>/<model>` ids and whose api is the alias
router - it delegates through the local runtime's own Models collection,
where the credential bridge and `streamSimple`'s translation live (registering
real providers directly would have put auth in the runtime's
credential-less collection). The test source mounts the scripted stream with
Flue's `DYNAMIC_MODEL_TEMPLATE` so any stored reference resolves, 1.0's
any-id behaviour in 2.0's spelling. **pi-ai is deduped, not aligned:** a
`pnpm.overrides` entry forces `^0.84.0` everywhere, so the runtime resolves
through the same 0.84.4 the adapters build against - the measured mechanism
differed from the caution above (`setProvider` is a structural Map insert
and a foreign-built provider WOULD register; the true risk was the delegated
stream surface, which deduping removes). The deferred OpenRouter fix landed
(`thinkingLevelMap.off = null` on every OpenRouter reasoning model in the
local collection) and the wrong docblock at `contracts/models.ts` is
rewritten to the real per-protocol picture. `storeResponses` / telemetry
overrides: nothing in the tree references them (open question 4 answered).
Measured on the user's real OpenRouter: a free-model turn with
`reasoningLevel: "default"` admitted and completed; the reasoning-level-on-
the-wire verification against real telemetry remains Phase 7's (2.0's
history projection carries no per-message model metadata at all, so the old
history-based assertion channel is gone).

### Phase 6 - The client and the stream

`harness-client.ts` to conversation-scoped clients; the new send body shape;
renamed error codes; `wait()` semantics; abort scope written down. Confirm the
Rust `service_stream` offset and retry assumptions against the new chunk
shapes by reading `harness/` on the Rust side, not by assuming.

**Exit:** streaming works in the real app - a long turn watched end to end,
interrupted once, resumed.

**Amended, 2026-09-01, by Phases 2/3:** the client moved early because the
2.0 SDK would not typecheck otherwise: `FlueHarnessClient` builds one
conversation-scoped client per thread id (`createFlueClient({ url:
<base>/agents/<name>/<id> })`), `send` wraps the bare string into
`{ kind: "user", body }` (the 2.0 `send` takes the full delivered message,
not the input shorthand), `wait` is `read(submissionId)` (the re-attach
form - `AgentPromptResponse` no longer exists, the reply is an
`AgentReadResult`), and `abort`/`history`/`observe` take no addressing
arguments. The wrapper's per-conversation call shape is unchanged, so no
caller moved. What remains here is the real work: the Rust `service_stream`
offset/retry assumptions against the new chunk shapes, `wait()` semantics
written down, the abort scope (in-flight AND queued now) documented, and the
dedup decision - `idempotencyKey` exists upstream in 2.0, and adopting or
declining it belongs to this phase with ADR 0033 reopened or reaffirmed.

**Amended, 2026-09-02, by Phases 4/5:** the reshape has a SECOND half that
moved from "eventual cleanup" to "the UI cannot admit a turn without it."
`STUDIO/src/platform/harness/conversation.ts` `submitTurn` still posts the
1.0 body (`{ message, modelId, reasoningLevel, ... }`), which Flue 2.0
refuses with 400 before admission - measured in the real app: the composer's
send answers 400 and the webview renders "the harness answered 400 with no
explanation" (its error-shape reader also expects a field the 2.0 refusal
bodies do not carry; our turn-settings refusal is `{ error, code }`). The
harness side of the envelope is done (`turn-settings` reads `kind`/`body`,
proven by the Phase 4/5 exit turns), so this phase's work is the webview's
body, its refusal rendering, and the stream-path items above. Also measured
for this phase: 2.0's history projection carries no model identity on
assistant messages (1.0's `metadata.model` is gone), and errored assistant
attempts are dropped from the projection - anything the webview or the
transcript rendered from those channels now needs the stream/telemetry
shapes instead.

### Phase 7 - Events, observability, and the stores

`run_start`/`run_end` to `agent_start`/`agent_end`; `runId` to `instanceId`
plus `submissionId`; `dispatchId` to `submissionId` across receipts, events
and telemetry; envelope `v: 3`. `titling.ts` consumes the renamed events.
`AgentSubmissionStore` gains its settlement and lease methods.

Adopt `@flue/runtime/test-utils` contract suites against our SQLite stream
store, which is free coverage on the one component this migration most
threatens.

**Exit:** telemetry shows a complete turn, and the contract suites pass.

**Amended, 2026-09-01, by Phases 2/3:** the titling event consumption moved
early (typecheck): `submission_settled` is the studio trigger and the title
ladder's failure signal, and the title reply text now comes from the run's
`agent_end` messages (2.0 observations carry messages, not a settled result
object) via a bounded reply stash; `dispatch` is by agent reference.
`titling.test.ts` pins the routing with 2.0-shaped events. What this phase
still owns: **verify the envelope fields against real events** (which fields
the runtime stamps on direct submissions and dispatched title runs - the
routing was written from the type surface, not from a live trace, because no
turn can run until Phase 5), the observability event renames, the
`dispatchId`-to-`submissionId` sweep across receipts and telemetry, and the
lost `title_model` log fact (restore it from a response event if one carries
the model).

**Amended, 2026-09-02, by Phases 4/5:** turns are real now, so the
verification against LIVE events is finally possible, and two channel facts
change what this phase verifies: 2.0's history projection carries no model
identity on assistant messages (`metadata.model` is gone from the record
entirely) and drops errored assistant attempts, so the `title_model` log
fact and any run-side model identification must come from the telemetry
events (or be re-derived from the settled settings row), and the retry
attempt count is invisible until Phase 8's hunks land. The titler's ladder
reads the model layer's synchronous snapshot (Phase 4/5), so a real titling
run can be verified end to end for the first time in this phase.

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

**Amended, 2026-09-01, by Phases 2/3:** the workspace entry is already
REMOVED - the 2.0.3 install failed loudly on the beta-anchored patch
(`ERR_PNPM_PATCH_FAILED`), so the regression this phase closes (invisible
retries, one budget, no quota guard, unstable `Date:`) is live NOW and
documented in `pnpm-workspace.yaml` and the Phase 2/3 report. The
`VALID_THINKING_LEVELS` hunk has nothing to re-derive against (confirmed: the
constant does not exist in 2.0.3). The `composeSystemPrompt` facts to read
the diff against: 2.0.3 re-adds `Date:` at compose time, cwd, the directory
listing, and an always-present `## Available Agents` section whose
empty-roster paragraph is in the bundle at
`conversation-stream-store-*.mjs` ("None. No subagents are currently
declared, so the `task` tool has no valid `agent` value - do not call it
unless an agent is introduced later in the conversation.").

**Amended, 2026-09-02, by Phases 4/5:** the regression's cost is now
COUNTED: ten harness tests are red on exactly this regression (enumerated in
`report/PHASE-4-5-the-turn-that-actually-runs.md`), and they are this
phase's acceptance list - when the hunks land, those ten come back green and
nothing else needs to move. One sharpening for the retry hunk: under 2.0.3,
the retries that do happen are invisible in BOTH channels at once (no
`submission-retrying` chunk AND the errored assistant attempt is dropped
from the history projection), so the re-derived patch should treat the
attempt record itself as part of "visible". The `composeSystemPrompt`
decision is unchanged. One dependency note: pi-ai is deduped to a single
0.84.4 instance by a pnpm override (Phase 4/5), so the re-derived hunks
anchor against the 2.0.3 bundles under an overridden dependency tree - the
bundle bytes are unchanged, but re-verify the anchor hashes after any lock
file move.

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

1. ~~Does `createSandbox` run before the first agent render?~~ **Answered in
   Phase 0: no, and it runs again on every turn.** Measured ordering is
   render, then `createSandbox` about a millisecond later, then a second
   render - and the same sequence repeats on the second turn. The factory is
   called once per submission's harness initialization, not once per
   conversation. The render's synchronous `conversationTurnSettings` read
   needs no warmed cache: it reads the row the turn-settings middleware
   settled before admission, which does not depend on the factory having
   run. Details in `report/PHASE-0-the-three-questions-before-the-work.md`.
2. ~~Does the `dist/app.mjs` embed support our fd handshake?~~ **Answered in
   Phase 0: yes, and the entry is ours rather than an embed of `app.mjs`.**
   A hand-written `src/server.ts` is compiled by `vite build` as the
   `server` input (a small plugin listed after `flue()` re-overrides that
   one key of the forced input map), imports `virtual:flue/server`, and
   calls `serve()` from `@hono/node-server` itself, whose listener callback
   carries the bound address. The unmodified Rust integration test passes
   against the scratch build on Windows: readiness frame parsed, admitted
   request 200, unauthenticated 401, graceful shutdown inside the drain
   bound. The `@flue/cli` patch is deleted, not re-derived. One gap stands:
   the Unix fd 3/4 transport was not exercised on this Windows machine; the
   spike report names it for Phase 3's proof run.
   **Phase 3 addendum, 2026-09-01:** the gap is closed on the Node side
   (real Linux, real fds 3/4: readiness, 401/200/202, exit 0) and the whole
   unmodified Rust suite passes on Windows against the 2.0 artifact. The
   one proof still open is the RUST Unix transport (`command-fds`' `pre_exec`
   `dup2`, `process_group`) - the VPS run needs system webkit/gtk packages
   that were outside the `~/temp` remit. Also learned here: the spike's
   verbatim entry does NOT survive the real composition (the built app chunk
   evaluates before the entry body, so the bootstrap read had to become a
   module imported by both the entry and `app.ts`); see the Phase 2/3
   report, item 2.
3. What is in 2.0.3's empty-roster `## Available Agents` paragraph, in full,
   and do we want the model reading it? (Phase 8) **Answered early,
   2026-09-01, from the bundle:** "None. No subagents are currently
   declared, so the `task` tool has no valid `agent` value - do not call it
   unless an agent is introduced later in the conversation." Whether the
   model should read it stays Phase 8's decision.
4. Does anything depend on `storeResponses` or the removed telemetry
   overrides? (Phase 5)
5. How many of the orphaned Flue transcripts are real history? (Phase 1)
   **Counted, 2026-09-01:** 51 streams, 27 matching a conversation we still
   have, **24 orphans** with real content (offsets up to 224). Our side has
   16 conversations of which 7 are `cnv49_*` test fixtures, so real history
   is 9. Also measured: this machine's `flue_meta.schema_version` is **4**,
   not the 5 the migration guide describes - below 8 either way, so the
   rejection is unchanged, but an export must read the tables rather than
   assume a version's shapes.
6. **New, 2026-09-01:** what is 2.0.3's journal format version story,
   actually? The store refuses the beta journal with
   `storedVersion: 4, supportedVersion: 1` - the 2.0 line's own format
   version is 1, and neither the migration guide's v5-to-v8 story nor any
   phase owned the reset of the default-path journal. The reset happened in
   Phase 2/3 by RENAME (`~/.studio/data/flue.db*` ->
   `*.beta9-journal`, preserved byte-for-byte; the Phase 1 export was
   verified first). Every machine taking this migration needs the same
   step; it belongs in the release notes, and the beta journal files stay
   until a confident cutover decides otherwise.
