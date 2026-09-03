# Phase 0 - the three questions before the work

**Date:** 2026-09-01. **Where:** a scratch directory outside the repo,
`D:\Creative Library\Workspace\flue2-phase0-spike` (not a scratch branch; the
repo was never checked out, switched, or committed to, and `git status` is
byte-identical to the session's start). The scratch contains a Flue 2.0.3 app
(`app/`), a copy of `STUDIO/src-tauri` minus `target/` (`spike-host/`) used to
run the real supervisor unmodified, and the extracted published tarballs.

**Shell unsandboxed - how confirmed:** npm registry reachable (`npm ping`
returned PONG, 271 ms); a loopback TCP server bound and accepted a connection
from the same shell; files were written outside the repo; `node`, `cargo`,
`vite`, and `npm pack` child processes all spawned and ran. Every measurement
below came from that shell.

**Environment:** Windows 10.0.26200 x64, Git Bash; node v24.19.0; cargo
1.97.1. Installed in the scratch app: `@flue/runtime@2.0.3`,
`@flue/vite@2.0.3`, `@flue/sdk@2.0.3`, `vite@8.2.2`,
`@hono/node-server@2.1.1`, `hono@4.13.5`, `@earendil-works/pi-ai@0.83.0`.
No live model turn was spent; the scratch agent ran against pi-ai's
`fauxProvider`.

---

## The three answers

1. **Yes - our own entry owns the handshake, and the `@flue/cli` patch is
   deleted rather than re-derived.** The unmodified Rust supervisor started
   the hand-written entry and the full integration test passed on Windows.
2. **No - `createSandbox` runs after the agent function's first render, and
   it runs again on every turn** (once per submission's harness
   initialization, not once per conversation). The turn-settings read needs
   no warmed cache; the async setup moves into the factory and must be
   idempotent per call.
3. **Yes - the build survives our shape.** `vite build` emits
   `dist/server.mjs` (our entry) plus `dist/app.mjs`, registers the
   `'use agent'` module, and accepts the 2.0 `flue.config.ts` minus the
   retired `root`/`output` fields (which are strictly rejected).

---

## Question 1 - can our own entry own the handshake?

### What was run

A scratch Flue 2.0.3 app whose `src/server.ts` is a hand-written entry
carrying all four behaviours (source below, verbatim). `vite build` compiles
it as the `server` input via a plugin listed after `flue()` whose `config`
hook re-overrides `build.rolldownOptions.input.server` - `flue()` forces that
map (`input: { server: <generated entry>, app: <node-server bootstrap> }`,
enforced paths include `build.rolldownOptions.input`), and a later plugin's
hook result merges over it, so only the `server` key is replaced and the
`app` entry survives. The entry imports `virtual:flue/server`
(`@flue/vite/dist/bootstrap/node-server.mjs` resolved by the plugin) for
`loadFlueNodeApplication()`, and calls `serve()` from `@hono/node-server`
itself. That package's listener callback is typed
`(info: AddressInfo) => void` - the bound address arrives as an argument,
which is exactly what `startFlueNodeServer`'s `onReady: () => void` refuses
to surface. Behaviours one (fd bootstrap read), two (loopback bind), three
(readiness frame + `PROJECT_STUDIO_BOUND_PORT`) and four (graceful stop with
the 60 s hard-exit fallback, SIGINT/SIGTERM/disconnect, and `POST
/api/shutdown` reaching `application.stop()`) are ordinary code in our
source.

### The proof that counts

The scratch app's `dist/` was junctioned to
`flue2-phase0-spike/STUDIO HARNESS/dist`, and the integration test from
`STUDIO/src-tauri/src/harness/` ran unmodified against a copy of the crate at
`spike-host/`, where the supervisor's own `resolve_server_path` found the
artifact through its normal candidate list. On Windows the transport is
stdin/fd 0 in, stdout/fd 1 out; the Unix fd 3/4 path was not exercised (see
gaps).

Negative control first: the default generated entry (pre-spike build) under
the same supervisor timed out exactly as it should - it listened
(`observed=[flue] Server listening on http://localhost:0`) and wrote no
readiness frame, so the supervisor killed it at 30 s. The handshake is not
accidentally satisfiable.

Then the spike entry:

```
running 1 test
test harness::integration::a_real_harness_starts_publishes_a_loopback_endpoint_and_answers_an_admitted_request ... readiness: host=127.0.0.1 port=50764 pid=12700 clientId=studio-host sessionId=c52eff23-5189-48a5-a637-48601890db7d token=[redacted 43 chars]
ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 64 filtered out; finished in 1.09s
```

That single test asserts, in order: the readiness frame parsed
(`parse_readiness_line`), host is loopback, port and pid non-zero,
`clientId` echoes the bootstrap's, session id non-empty; an authenticated
`GET /api/mcp/servers` returns 200 with a JSON list - only possible if the
credential crossed the pipe, since the environment allowlist and `env_clear`
guarantee it was never in the environment or argv; an unauthenticated request
returns 401; and `shutdown_all` (bearer `POST /api/shutdown`, then bounded
drain wait) leaves no endpoint because the process exited politely inside
`DRAIN_BOUND`. Exit code 0.

### A measured hazard for test harnesses, not for production

Spawning the same built entry from **Node's** `child_process` with pipe stdio
(`stdio: ["pipe", "pipe", "inherit"]`) and writing the bootstrap to stdin
hung the child inside `readFileSync(0)` - reproduced twice, no output after
the entry's first line. Spawning it from Rust with `Stdio::piped()` - the
supervisor's way, and os_pipe underneath - works instantly, every time, and
so does Git Bash `< file` redirection. So the fd-0 read's behaviour depends
on how the parent constructed the pipe (libuv stdio initialization
differences; mechanism not investigated further). Any Phase 3+ test harness
written in Node must spawn the entry the way the supervisor does, or feed
the bootstrap from a file; a Node-piped rehearsal will false-negative.

### Where the hypothesis could have failed, and did not

`loadFlueNodeApplication` runs outside the generated entry without complaint
(it is the same function `vite preview` imports natively from
`dist/app.mjs`); the app needs no generated-wrapper globals;
`virtual:flue/server` resolves inside any module of the Vite graph the
plugin serves, including a user-authored entry. The fallback (post-build
injection into `dist/server.mjs`) is not needed.

---

## Question 2 - does the sandbox factory run before the first render?

### How measured

One scratch agent (`Spike`) in a `'use agent'` module: the function body
writes `[spike-log] t=+Nms render id=...` to stderr with a module-level
monotonic clock, calls `useModel`/`useSandbox`, and returns instructions.
Its factory's `createSandbox(options)` logs the same way, `mkdir`s the
conversation workspace, and delegates to `local({ cwd })` from
`@flue/runtime/node`. Model: `fauxProvider` registered with `setProvider` in
`app.ts` (ten queued steps so two turns cannot run dry). Two turns of one
conversation were sent over the real HTTP surface with the default server
entry, then repeated against the custom entry with identical ordering.

### The measurement

```
[flue] Server listening on http://localhost:4210
[spike-log] t=+3934ms render id=conv-q2
[spike-log] t=+3935ms createSandbox id=conv-q2
[spike-log] t=+3971ms render id=conv-q2
[spike-log] t=+8011ms render id=conv-q2
[spike-log] t=+8012ms createSandbox id=conv-q2
[spike-log] t=+8018ms render id=conv-q2
```

### What this means

- **The render runs first.** `createSandbox` follows the first render by
  about a millisecond. The render produces the config that carries the
  factory; the runtime then resolves it. This matches the 2.0.3 source:
  `initializeRootHarness` calls `renderAgentFunctionWithStructure` and only
  afterwards `resolveSandbox(...)`, which invokes `createSandbox({ id })`.
- **The factory runs again on the second turn** - once per turn, identically.
  "Called once per initialized harness" is technically true but the
  initialization happens per submission: each submission builds a fresh
  harness and a fresh environment slot. Re-renders within a submission do
  not re-create the sandbox (the runtime re-resolves only when `useSandbox`
  presence flips - `maybeSwapEnvironment`), but a new submission does.
- **Consequence for Phase 4:** `conversationTurnSettings(id)` is read in the
  render, before the factory has run on every turn. That is safe, because
  the read is the conversation index row the turn-settings middleware
  settles before admission, and the row does not depend on the factory's
  async work. So: `runtime.start()`, `runtime.reconcile()` and the three
  `ensureDirectory` calls move into `createSandbox(options)` (`options.id`
  carries the conversation id, as the workspace creation in the scratch
  factory shows), and the factory must stay idempotent per call - the
  runtime's project-keyed maps and recursive `mkdir` already are. No warmed
  cache is needed anywhere.

---

## Question 3 - does the build survive our shape?

- A module with the `'use agent'` directive (`src/agents/spike.ts`) was
  scanned and registered: the built shared chunk contains
  `identity: "Spike"`, and the agent answered real HTTP turns.
- `vite build` produced `dist/server.mjs` and `dist/app.mjs` (plus a shared
  user-code chunk). The supervisor started `dist/server.mjs` unchanged -
  same artifact path, same `node dist/server.mjs` start command, resolved by
  the supervisor's own candidate list.
- `flue.config.ts` with `defineConfig` from `@flue/runtime/config` was
  accepted, and the retirement is enforced, not merely allowed:
  `parseFlueConfig({ root: "./src", output: "./dist" })` throws with
  `` root: Invalid key: Expected never but received "root" ``.

### The working configs, verbatim

`flue.config.ts`:

```ts
import { defineConfig } from "@flue/runtime/config";

export default defineConfig({
  target: "node"
});
```

`vite.config.ts`:

```ts
import { flue } from "@flue/vite";
import { defineConfig, type PluginOption } from "vite";

/**
 * Claims the dist/server.mjs artifact back from the plugin's generated
 * entry. Listed after flue() so its config hook merges over flue's forced
 * input map: the `app` entry (the loadFlueNodeApplication bootstrap) stays,
 * the `server` entry becomes ours.
 */
function studioServerEntry(): PluginOption {
  return {
    name: "studio-server-entry",
    config: () => ({
      build: {
        rolldownOptions: {
          input: {
            server: "src/server.ts"
          }
        }
      }
    })
  };
}

export default defineConfig({
  plugins: [flue(), studioServerEntry()]
});
```

`src/server.ts` (the whole entry, carrying the four behaviours):

```ts
/**
 * Phase 0 scratch server entry: our own listen, carrying the four behaviours
 * the patched @flue/cli entry injects today. Compiled by vite build as the
 * dist/server.mjs artifact the Rust supervisor starts.
 */
import { closeSync, readFileSync, writeSync } from "node:fs";

import { serve } from "@hono/node-server";
import { loadFlueNodeApplication } from "virtual:flue/server";

import { setShutdownHook } from "./shutdown.js";

function isAdmissionBootstrap(
  value: object
): value is { credential: string; clientId: string; sessionId: string } {
  return (
    "credential" in value && typeof value["credential"] === "string" &&
    "clientId" in value && typeof value["clientId"] === "string" &&
    "sessionId" in value && typeof value["sessionId"] === "string"
  );
}

// Behaviour 1: admission bootstrap. One JSON frame over the descriptor the
// Host names; malformed frames throw rather than starting.
const bootstrapFd = Number.parseInt(process.env.PROJECT_STUDIO_ADMISSION_BOOTSTRAP_FD || "", 10);
if (Number.isInteger(bootstrapFd) && bootstrapFd >= 0) {
  const parsed: unknown = JSON.parse(readFileSync(bootstrapFd, "utf8"));
  if (bootstrapFd > 2) closeSync(bootstrapFd);
  if (
    parsed === null || typeof parsed !== "object" || Array.isArray(parsed) ||
    !isAdmissionBootstrap(parsed)
  ) {
    throw new Error("[flue] Invalid Project Studio admission bootstrap.");
  }
  process.env.PROJECT_STUDIO_ADMISSION_CREDENTIAL = parsed["credential"];
  process.env.PROJECT_STUDIO_ADMISSION_CLIENT_ID = parsed["clientId"];
  process.env.PROJECT_STUDIO_ADMISSION_SESSION_ID = parsed["sessionId"];
}

// Behaviour 2: loopback bind. Without the variable the server binds every
// interface, which ADR 0028 forbids; the supervisor always sets it.
const bindHostname = process.env.PROJECT_STUDIO_HARNESS_HOSTNAME;

const application = await loadFlueNodeApplication({ env: process.env });

async function stop(exitCode: number): Promise<void> {
  setTimeout(() => {
    console.error("[flue] Shutdown timed out, exiting.");
    process.exit(exitCode);
  }, 60_000).unref();
  await application.stop();
  process.exit(exitCode);
}

setShutdownHook(() => {
  void stop(0);
});
process.on("SIGINT", () => {
  void stop(130);
});
process.on("SIGTERM", () => {
  void stop(143);
});
process.on("disconnect", () => {
  void stop(0);
});

// Behaviour 3: the readiness frame, written by the owner of the listen. The
// bound address comes from serve()'s own callback.
const server = serve(
  {
    fetch: application.fetch,
    port: Number.parseInt(process.env.PORT || "3000", 10),
    ...(bindHostname === undefined ? {} : { hostname: bindHostname }),
    serverOptions: { requestTimeout: 0 }
  },
  (info) => {
    const readinessFd = Number.parseInt(process.env.PROJECT_STUDIO_READINESS_FD || "", 10);
    if (!Number.isInteger(readinessFd) || readinessFd < 0) return;
    process.env.PROJECT_STUDIO_BOUND_PORT = String(info.port);
    const readiness = {
      type: "project-studio.harness.ready",
      version: 1,
      pid: process.pid,
      host: info.address,
      port: info.port,
      clientId: process.env.PROJECT_STUDIO_ADMISSION_CLIENT_ID || "",
      sessionId: process.env.PROJECT_STUDIO_ADMISSION_SESSION_ID || ""
    };
    writeSync(readinessFd, JSON.stringify(readiness) + "\n");
    if (readinessFd > 2) closeSync(readinessFd);
  }
);

void server;
```

The scratch `app.ts` registered `fauxProvider` with `setProvider`, mounted
`createAgentRouter(Spike)` at `/agents/spike`, kept a bearer-equality
admission middleware (scratch stub, not Studio's verifier), a
`GET /api/mcp/servers` route, and a `POST /api/shutdown` route reaching the
entry through a one-function `shutdown.ts` seam - the seam Studio's
composition root already fills with its own drain-and-close.

---

## Where the brief and the docs were wrong

1. **"the factory may not [run on the second turn]"** - it does. The brief's
   framing ("called once per initialized harness") is literally what the
   runtime does, but a harness is initialized per submission, so the
   observable behaviour is one `createSandbox` per turn. Phase 4's design
   text now says idempotent-per-call, not once-per-conversation.
2. **`docs/guide/migration.md` POST body shape is misleading.** It says the
   body "becomes a bare message object - `{ "message": { "kind": "user",
   "body": "..." } }`". The code (`parseDeliveredInput` in the runtime) takes
   the delivered message at the top level of the request body -
   `{"kind":"user","body":"..."}` - and a `{"message": ...}` wrapper is
   rejected as malformed. The SDK's `send({ message })` does the wrapping
   into the bare shape. The spike hit this as a real 400 before reading the
   parser.
3. **"dist/server.mjs ... a non-listening dist/app.mjs it imports"** - not
   the literal chunk graph. The build emitted three files
   (`providers-<hash>.mjs`, `app.mjs`, `server.mjs`); both entries inline
   the bootstrap module, and the shared user code (app, scanned agents)
   lives in the providers chunk. The substance survives: `dist/app.mjs`
   exports `loadFlueNodeApplication`/`startFlueNodeServer` and is importable
   by a custom host (preview does exactly this), and `dist/server.mjs` is
   self-starting.
4. **"section 4's table" for the patch verdicts** - the table ("The patches,
   one at a time") sits at the end of section 3. The `@flue/cli` row was
   removed from that table as instructed; the deletion decision now lives in
   Phase 0's findings, Phase 3's text, and open question 2.
5. **Not wrong, but sharpened by measurement:** `@hono/node-server`'s
   `serve()` listener callback is typed `(info: AddressInfo) => void` in
   2.1.1 - the exact surface the patch's third hunk had to inject around.
   And the plugin's forced input map means a custom entry cannot be declared
   in `vite.config.ts`'s own `build.rolldownOptions.input` (it is silently
   overridden and warned about); it takes the one-key re-override from a
   plugin ordered after `flue()`.

## What could not be exercised

- **The Unix fd 3/4 transport.** This machine is Windows; WSL is present but
  has no node or cargo, and installing a toolchain into the user's WSL is
  outside a spike's remit. The Node-side bootstrap read and readiness write
  are descriptor-number-agnostic (`channel.rs` documents this, and the same
  `readFileSync`/`writeSync` calls were proven on descriptors 0/1); the fd
  mapping itself is Rust-side code this migration does not touch. Phase 3's
  proof run should include one Unix run of the same integration test.
- **The Tauri app wiring beyond the supervisor module** - `lib.rs`'s eager
  start, the services seam, and the bundled resource-dir resolution
  candidate. The copy ran the real supervisor and its integration test with
  the repo's own path-resolution logic (candidate 2 hit through the
  junction).
- **Studio's real admission verifier and scopes.** The scratch middleware is
  a bearer-equality stub; what is proven is the delivery property (credential
  over the pipe only; admitted request 200; unauthenticated 401), which is
  the part the handshake owns.
- **One anomaly left unexplained:** the first post-reconnection run of the
  custom entry hung silently with no output and was never reproduced after a
  rebuild; suspect is a partial artifact set from the interrupted session.
  Every subsequent run, including all supervisor runs, was instant.
