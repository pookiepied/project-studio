# Phases 2 and 3 - The pins, and the entry we own

This is the phase that installs Flue 2.0 and does not stop until the Rust
supervisor is starting a 2.0 artifact. It is two phases in one brief on
purpose: Phase 2 leaves the tree broken by construction, so it has no green
state of its own to land on, and shipping a half-migrated tree is the one
thing the migration plan forbids.

Read `documentation/work/flue-2-migration.md` first, all of it, and
`report/PHASE-0-the-three-questions-before-the-work.md` in full - Phase 0
already built and proved the thing Phase 3 has to build, and its report
carries the working configs verbatim. Lift them rather than rediscovering
them.

**The point of no return is in Part 1.** Once `@flue/runtime@2.0.3` is
installed, the beta cannot read its own journal any more and the old harness
does not run. The user's history is already exported and verified
(`~\studio-conversation-export-2026-09-01T14-25-57\`, 40 conversations,
verified against the live beta's own projection), so the safety net is in
place. Do not re-run the export, and do not delete the old one.

---

## Part 0 - What Phase 0 already settled

Do not re-derive any of this. Re-check it if you like; do not rebuild it.

1. **Our own entry works and the `@flue/cli` patch dies.** A hand-written
   `src/server.ts` importing `virtual:flue/server` and calling `serve()` from
   `@hono/node-server` itself carries all four behaviours. The unmodified Rust
   integration test passed against it on Windows.
2. **`startFlueNodeServer` is the wrong door.** It accepts `hostname`, but its
   `onReady` is typed `() => void` and the server it returns exposes only
   `stop()` and `closeSync()`. Nothing surfaces the bound port.
   `loadFlueNodeApplication()` plus our own `serve()` is what makes the patch
   unnecessary instead of merely smaller.
3. **`flue()` forces `build.rolldownOptions.input`.** A plugin listed *after*
   `flue()` whose `config` hook returns only the `server` key merges over it,
   so the `app` entry survives. Setting `input` directly in `vite.config.ts`
   is overridden **with a warning naming the path** - expect that line, do not
   hunt it.
4. **`vite build` emits `dist/server.mjs` and `dist/app.mjs`**, and the
   supervisor's own `resolve_server_path` finds the first through its normal
   candidate list. Same artifact, same start command.
5. **A measured hazard.** On Windows the fd-0 bootstrap read blocks forever
   when the entry is spawned by Node's `child_process` pipe stdio, and works
   when spawned the way the supervisor spawns (`Stdio::piped`). Any Node-side
   test harness must spawn like the supervisor or feed the bootstrap from a
   file. A Node-piped rehearsal will false-negative.
6. **The spike is still on disk** at
   `D:\Creative Library\Workspace\flue2-phase0-spike` - a working 2.0.3 app,
   the proven entry, and the junction that lets the real supervisor test run.
   Read it. Do not delete it until this phase is committed.

---

## Part 1 - The pins

- `@flue/runtime`, `@flue/sdk`, `@flue/opentelemetry` to `2.0.3`;
  `@flue/cli` to `2.0.3` if it is still wanted at all (its build and dev roles
  are gone - decide, and say which).
- Add `vite` and `@flue/vite`. `hono` is already present.
- `@earendil-works/pi-ai` to `^0.84` and **as a direct dependency**: 2.0's
  providers are Pi's own objects, so Phase 5 imports it by name rather than
  reaching through Flue.
- `build` moves from `flue build --target node` to `vite build`.
- `flue.config.ts`: `defineConfig` from `@flue/runtime/config`, and drop
  `root` and `output` - they are strictly rejected, verified against the real
  validator.
- `pnpm-workspace.yaml`: the `@flue/cli` patch entry goes (Part 3 deletes the
  patch), and the runtime patch entry re-points to 2.0.3. **Expect the runtime
  patch to fail to apply** - its hunks are anchored to beta bundle hashes.
  That failure is designed and loud. Phase 8 re-derives those hunks; this
  phase's job is to get the tree building without them, so the retry
  behaviour is temporarily upstream's. **Say so in the report** - it is a real
  regression that exists between this phase and Phase 8, and nobody should
  discover it by surprise.

Everything is broken at the end of Part 1. That is expected and it is why
this phase does not end here.

## Part 2 - Routing, and an `app.ts`

2.0 requires an explicit `app.ts`. The auto-router is gone; the subpath is
not - `@flue/runtime/routing` still exists and exports `createAgentRouter`.

- Replace the `options.flueApp ?? flue()` mount in
  `transport/http/create-app.ts` with `createAgentRouter` over the studio
  agent. **URL shapes are ours** and must not move: the frontend, the Tauri
  IPC seam and our own tests all address the existing paths. Any change to a
  path a client can see is out of scope and, if forced, is a finding to report
  rather than a decision to make.
- Admission middleware stays ordinary Hono middleware, registered before the
  mount. It is the thing that makes an unauthenticated request 401, and Phase
  0's proof asserts exactly that, so it must keep working.
- The titler is dispatch-only and **stays unmounted**. Its only caller is the
  in-process `dispatch()` in `conversations/titling.ts`.

Porting the agents' internals is Phase 4. This phase needs whatever minimum
makes them registrable and the server startable - a `'use agent'` module that
compiles and mounts. If that minimum turns out to be the full port, say so
and stop rather than half-doing Phase 4 here.

## Part 3 - The entry we own

Author `src/server.ts` in our source, the shape Phase 0 proved, carrying the
four behaviours the Rust host cannot flex. Read
`patches/@flue__cli@1.0.0-beta.9.patch` before you write it - 76 lines, and
the authority on what the behaviours actually are - then **delete that patch**
and its workspace entry.

1. **Admission bootstrap.** Read the fd named by
   `PROJECT_STUDIO_ADMISSION_BOOTSTRAP_FD`, parse JSON, validate
   `credential`, `clientId` and `sessionId` are strings, publish the three
   `PROJECT_STUDIO_ADMISSION_*` variables, close the fd if above 2. A
   malformed bootstrap throws rather than starting - a harness that starts
   without admission is a harness listening with no door.
2. **Loopback bind.** `PROJECT_STUDIO_HARNESS_HOSTNAME` is the bind hostname.
   Absent it, do not bind every interface - ADR 0028 is the reason this patch
   existed at all. Decide what absent means and defend it.
3. **Readiness frame.** One line of JSON to the fd named by
   `PROJECT_STUDIO_READINESS_FD`: `type`, `version`, `pid`, `host`, `port`,
   `clientId`, `sessionId`. Set `PROJECT_STUDIO_BOUND_PORT`. Close the fd if
   above 2. The frame shape is fixed by `STUDIO/src-tauri/src/harness/` -
   read `channel.rs` and `bootstrap.rs` and match them exactly. **This phase
   does not change the Rust side.**
4. **Shutdown.** Graceful stop through the loaded application's own `stop()`,
   the hard-exit fallback, SIGINT/SIGTERM/disconnect, and the authenticated
   `POST /api/shutdown` path the supervisor uses.

This is ordinary code in our tree now, which means it gets what our code
gets: docblocks that say why, and tests.

## Verification

The number that matters is that the supervisor starts a 2.0 artifact.

- `pnpm typecheck` clean.
- `pnpm test` - which builds first; the integration tests spawn `dist/`, and
  running `vitest` against a stale build has mis-attributed failures in two
  earlier reports. Suites one at a time.
- `cargo clippy --all-targets` zero warnings, and the Rust tests pass
  **unmodified** - including
  `a_real_harness_starts_publishes_a_loopback_endpoint_and_answers_an_admitted_request`,
  which is the whole proof. If a Rust file needs to change for that test to
  pass, stop and report it: the contract was supposed to be fixed, and that
  would mean Phase 0 measured something wrong.
- **The negative control**, as Phase 0 ran it: confirm a build *without* our
  entry fails the handshake. A test that cannot fail is not a proof.
- **Launch the real app** and confirm the harness comes up. Not a turn - the
  agents are Phase 4 - but the process starts, the endpoint publishes, and the
  webview reaches it.
- **The Unix proof Phase 0 could not run.** The fd 3/4 transport was never
  exercised. The user has a Linux VPS reachable as `ssh contabo`; work only
  under `~/temp` there. If it cannot be done, say so plainly and leave the gap
  named rather than implied.

## Not this phase

- **Do not port the agents' internals.** Phase 4, and it carries Phase 0's
  measured render-then-`createSandbox` ordering.
- **Do not touch the providers.** Phase 5. Expect them to be broken here and
  say so.
- **Do not re-derive the runtime patch hunks.** Phase 8, deliberately: a patch
  derived against a bundle we have not yet proven we can run is derived twice.
- **Do not touch `STUDIO/`** - not the frontend, not `src-tauri`. If the
  handshake needs a Rust change, that is a finding, not a task.
- Do not delete the Phase 0 spike, the export in the user's home folder, or
  anything under `~/.studio/`.

## Report

`report/PHASE-2-3-the-pins-and-the-entry-we-own.md`: what the entry looks like
and why, the `@flue/cli` decision, the state the runtime patch was left in and
what regressed until Phase 8, the Rust test output verbatim, the negative
control, the Unix result or its absence, and every place this brief was wrong.

Update `documentation/work/flue-2-migration.md`: mark Phases 2 and 3 done with
what actually happened, and amend any later phase an answer here changes.

## Rules

`Backend/`, `docs/`, `prompts/` and `report/` are read-only context, except
the one report file you write. Never `git checkout`, `switch`, `stash`,
`reset`, `clean`, `commit` or `rebase`.

No `any`, no non-const `as`, no non-null `!`. UTF-8, no BOM, LF. No en-dashes,
smart quotes, curly apostrophes, ellipsis characters or emoji in source. Edit
by hand, never with a script. No green placeholder tests, and never a test
that stopped checking anything.

Applied migrations are never rewritten. Secrets never enter a log, a fixture,
a report, or an error. Live model turns are not needed in this phase.

Verify against real code and real runs. Not this brief, not the plan, not the
Phase 0 report - all three are secondhand, and briefs in this series have been
wrong in every phase so far.
