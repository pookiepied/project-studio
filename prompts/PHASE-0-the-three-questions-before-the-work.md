# Phase 0 - The three questions before the work

Studio is moving to Flue 2.0. The plan is
`documentation/work/flue-2-migration.md` - read it first, all of it. This is
the first of its nine phases, and it is the only one that produces no shipped
code.

Three questions decide the shape of Phase 3 and Phase 4. Each was reached by
reading the published 2.0.3 packages and each stopped at the point where the
types stop telling you and only running it will. Answer them by running
something, then write the answers into the plan document and stop.

**This is a spike. The code you write here is thrown away.** Work on a scratch
branch, or in a scratch directory outside the repo - your choice, but say
which. Nothing you write in this phase gets committed to `main` except edits
to `documentation/work/flue-2-migration.md`.

---

## Why a throwaway phase exists at all

Two of these questions, answered wrong, invalidate a later phase after real
work has gone into it. The handshake between the Rust supervisor and the
harness is the contract the Tauri host cannot flex; if the 2.0 build cannot
carry it, Phase 3 is a different task and Phase 8 grows a patch back. Finding
that out in week one costs a day. Finding it out in week three costs the
week.

The third question is smaller but has the same shape: if the agent function
renders before its sandbox factory has run, the studio agent needs a warmed
cache it does not need otherwise, and that is a design decision, not a line
of code.

## What is already known, so you do not re-derive it

All of this was read from the published tarballs. Re-check anything you
depend on, but do not start from zero.

- `vite build` on the Node target emits **two** entries: the self-starting
  `dist/server.mjs` and a non-listening `dist/app.mjs` it imports. The docs
  say a custom host can import the second "to embed the application in its own
  server".
- `@flue/vite` ships `dist/bootstrap/node-server.mjs`, which exports
  **`loadFlueNodeApplication(options)`** and `startFlueNodeServer(options)`.
- `loadFlueNodeApplication()` resolves to a `LoadedFlueNodeApplication` with
  the complete lifecycle surface: `fetch(request, env?)`, `enterActivity()`,
  `pauseAdmissions()`, `stop(timeoutMs?)`, `closeSync()`.
- `startFlueNodeServer` accepts `hostname`, which is half of what our CLI
  patch adds. But its `onReady` is typed `() => void` - **no address** - and
  the `FlueNodeServer` it returns exposes only `stop()` and `closeSync()`.
  Neither surfaces the bound port. That is the same gap our patch's third
  hunk fixes today.
- `@hono/node-server` is already a runtime dependency of `@flue/runtime`, and
  its `serve()` callback **does** receive the bound address.

Which produces the hypothesis this phase exists to test.

## Question 1 - Can our own entry own the handshake?

**Hypothesis:** we write our own server entry, in our own source. It calls
`loadFlueNodeApplication()`, then `serve()` from `@hono/node-server` itself,
and therefore owns the listen - the bind address, the bound port, and the
moment of readiness. Every behaviour the `@flue/cli` patch injects today
becomes ordinary code we maintain, and the patch is deleted rather than
re-architected.

The four behaviours, from `patches/@flue__cli@1.0.0-beta.9.patch` - read it,
it is 76 lines:

1. **Admission bootstrap.** Read fd `PROJECT_STUDIO_ADMISSION_BOOTSTRAP_FD`,
   parse JSON, validate `credential`, `clientId` and `sessionId` are strings,
   set the three `PROJECT_STUDIO_ADMISSION_*` environment variables, close the
   fd if above 2. A malformed bootstrap throws rather than starting.
2. **Loopback bind.** `PROJECT_STUDIO_HARNESS_HOSTNAME` becomes the bind
   hostname. Without it the server binds every interface, which ADR 0028 says
   it must never do.
3. **Readiness frame.** On listen, write one line of JSON to fd
   `PROJECT_STUDIO_READINESS_FD`: `type`, `version`, `pid`, `host`, `port`,
   `clientId`, `sessionId`. Set `PROJECT_STUDIO_BOUND_PORT`. Close the fd if
   above 2.
4. **Shutdown.** Whatever `stop()` and the `disconnect` handling in the
   patched entry do today - read it and carry it over.

Prove it by running it. A scratch Flue 2.0 app with one trivial agent is
enough; you do not need Studio's agent to answer this.

**The proof that counts:** the Rust supervisor in `STUDIO/src-tauri/src/harness/`
starts your entry and gets its readiness frame. Read `channel.rs` and
`bootstrap.rs` first and match their frame shape, fd numbers and environment
names exactly - they are the fixed side of this contract, and this phase does
not change them.

If you cannot get the real supervisor pointed at a scratch build, say so and
prove it the closest way you can, naming exactly what you could not exercise.
A claim that the handshake works, from a test that never ran the Rust side,
is worth less than an honest gap.

**If the hypothesis fails**, say precisely where: `loadFlueNodeApplication`
not usable outside the generated entry, the app requiring the generated
wrapper's globals, `virtual:flue/providers` not resolving outside a Vite
build, or something else. The fallback is post-build injection into
`dist/server.mjs`, and knowing why we need it is worth as much as the answer.

## Question 2 - Does the sandbox factory run before the first render?

2.0 agent functions are synchronous and re-render before every model turn.
Ours is an async initializer that today does, in order: `runtime.start()`,
`runtime.reconcile()`, three `ensureDirectory` calls, then a **synchronous**
`runtime.conversationTurnSettings(id)` read whose result decides the model and
thinking level passed to `useModel`.

The three async calls have a home: `SandboxFactory.createSandbox(options)` is
async, receives `options.id`, and 2.0 documents it as called once per
initialized harness. The sync read needs no home - it is already sync.

So the whole question is ordering. **Does `createSandbox` run before the agent
function's first render, or after it?**

- If **before**: the port is nearly mechanical. The factory does the async
  setup, the render reads settings synchronously, and Phase 4 is smaller than
  the migration report predicted.
- If **after**: `conversationTurnSettings` would read a runtime that has not
  started, and the studio agent needs its turn settings warmed somewhere else
  - a lifecycle hook, or admission time. That is a design decision for Phase 4
  and it needs stating, not improvising.

Measure it. A scratch agent with a sandbox factory that logs when
`createSandbox` runs, and a render that logs when it renders, over two turns
of one conversation, answers this in one run. Report the actual order, and say
what happens on the **second** turn as well as the first - the render repeats
and the factory may not.

## Question 3 - Does the build survive our shape?

Smaller, but it gates everything.

- A module with the `'use agent'` directive is picked up by the build's scan
  and registered.
- `vite build` produces a `dist/server.mjs` the existing Rust supervisor
  starts unchanged - same artifact path, same start command.
- `flue.config.ts` with `defineConfig` from `@flue/runtime/config`, minus the
  retired `root` and `output` fields, is accepted.

Report the actual `vite.config.ts` and `flue.config.ts` that worked, verbatim.
Phase 2 will use them, and a config reconstructed from a description is a
config debugged twice.

## Not this phase

- **Do not port the studio agent.** That is Phase 4, and a real port needs the
  answers this phase produces.
- **Do not touch `STUDIO HARNESS/src`, `STUDIO/`, or `patches/`.** Nothing on
  `main` changes except the plan document.
- **Do not upgrade the repo's dependencies.** No `pnpm add`, no lockfile edit,
  no `package.json` change in the repo. Phase 2 owns the pins. Your scratch
  app has its own.
- **Do not evaluate remote MCP, parallel tool calling, or the archive
  mechanism.** All three are after Phase 8, by decision.
- Do not write tests for scratch code you are deleting.

## What to deliver

Edit `documentation/work/flue-2-migration.md` in exactly two places:

1. **Section 8, "Open questions"** - replace questions 1 and 2 with their
   answers, keeping the numbering of the rest intact.
2. **Section 5, Phase 0** - append what the spike found, and amend Phase 3
   and Phase 4 where an answer changes their shape. If Question 1's hypothesis
   held, say plainly that the `@flue/cli` patch is deleted rather than
   re-derived, and move that from section 4's table.

Then the report, `report/PHASE-0-the-three-questions-before-the-work.md`:
the three answers, how each was measured, the working configs verbatim, and
every place this brief was wrong. If a question could not be answered, say
which and what would answer it - an honest unknown is a finding.

## Rules

`Backend/`, `docs/`, `prompts/` and `report/` are read-only context, except
the one report file you write. Never `git checkout`, `switch`, `stash`,
`reset`, `clean`, `commit` or `rebase`. `~/.studio/` is the user's data and is
never deleted or moved.

No `any`, no non-const `as`, no non-null `!`. UTF-8, no BOM, LF. No en-dashes,
smart quotes, curly apostrophes, ellipsis characters or emoji in source. Edit
by hand, never with a script. Measurements of the machine must come from a
shell you have confirmed is unsandboxed, and say how you confirmed it.

Verify against real code and real runs. Not the plan document, not the
migration report, not this brief - all three are secondhand, and two of them
have already been wrong.
