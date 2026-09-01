/**
 * Project Studio's own harness entrypoint - the artifact the Rust supervisor
 * starts (`dist/server.mjs`, compiled from this file by `vite build`).
 *
 * Flue 2.0 no longer ships an entrypoint we can patch: the `@flue/cli` patch
 * that injected the four behaviours below into a generated entry died with
 * the 1.0 line, and Phase 0 proved the better shape - we write the entry
 * ourselves and own the listen. Everything the Rust host cannot flex lives
 * here, in ordinary code with tests, instead of in a patch against a bundle:
 *
 * 1. The admission bootstrap - `src/host/bootstrap.ts`, imported FIRST below
 *    so it evaluates before the application module does (the composition
 *    reads the credential while the app module evaluates).
 * 2. The loopback bind. The Host always sets `PROJECT_STUDIO_HARNESS_HOSTNAME`
 *    (ADR 0028: the harness must never bind every interface). Absent - a dev
 *    run, a test harness that forgot - the bind FALLS BACK to 127.0.0.1
 *    rather than 0.0.0.0: a misconfiguration must fail safe toward the
 *    private address, not open the port to the LAN. The supervisor refuses
 *    any readiness frame naming a non-loopback host anyway, so a non-loopback
 *    bind is unusable by the desktop app by construction.
 * 3. The readiness frame, one line of JSON on the descriptor the Host names
 *    over `PROJECT_STUDIO_READINESS_FD` (fd 3 on Unix, fd 1 on Windows,
 *    shared with ordinary logging - which is why the Host's reader skips
 *    non-frame lines rather than trusting the first one). The frame's shape
 *    is fixed by `STUDIO/src-tauri/src/harness/endpoint.rs` and mirrored in
 *    `src/host/readiness.ts`; `PROJECT_STUDIO_BOUND_PORT` is set beside it.
 * 4. The graceful stop. One sequence for every exit path - the Host's
 *    authenticated `POST /api/shutdown`, SIGINT/SIGTERM, the parent's
 *    disconnect, the launcher's IPC message: the Flue application stops
 *    first, the composition drain second, the process exits last. See
 *    `src/host/shutdown.ts` for the seam.
 *
 * This file does not change the Rust side. The frame, the descriptors and
 * the variable names are a contract with `harness/channel.rs`,
 * `harness/bootstrap.rs` and `harness/endpoint.rs`, and the parity tests on
 * both sides hold it.
 */
import "./host/bootstrap.js";

import { closeSync, writeSync } from "node:fs";

import { serve } from "@hono/node-server";
import { loadFlueNodeApplication } from "virtual:flue/server";

import {
  registerRuntimeStop,
  requestShutdown,
} from "./host/shutdown.js";

/**
 * Behaviour 2: the loopback bind. See the module docblock for why an absent
 * hostname falls back to loopback rather than every interface.
 */
const bindHostname = process.env.PROJECT_STUDIO_HARNESS_HOSTNAME ?? "127.0.0.1";

const application = await loadFlueNodeApplication({ env: process.env });

// Behaviour 4, registration half: the runtime's own stop joins the unified
// sequence before the listen, so every exit path finds a complete stop.
registerRuntimeStop(() => application.stop());

for (const [signal, exitCode] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
  ["disconnect", 0],
] as const) {
  process.once(signal, () => {
    requestShutdown(exitCode);
  });
}

/**
 * Behaviour 3: the readiness frame, written by the owner of the listen. The
 * bound address comes from `serve()`'s own listening callback, which is the
 * surface the patched 1.0 entry had to inject around
 * (`startFlueNodeServer`'s `onReady` carries nothing).
 */
const server = serve(
  {
    fetch: application.fetch,
    // 0 lets the OS assign; the readiness frame reports what was bound. The
    // Host sets PORT deliberately, after clearing the environment.
    port: Number.parseInt(process.env.PORT || "3000", 10),
    hostname: bindHostname,
    // Long-lived streams (a turn can run for minutes) must not be cut by an
    // idle timeout.
    serverOptions: { requestTimeout: 0 },
  },
  (info) => {
    const readinessFd = Number.parseInt(
      process.env.PROJECT_STUDIO_READINESS_FD || "",
      10,
    );
    if (!Number.isInteger(readinessFd) || readinessFd < 0) return;
    process.env.PROJECT_STUDIO_BOUND_PORT = String(info.port);
    const readiness = {
      type: "project-studio.harness.ready",
      version: 1,
      pid: process.pid,
      host: info.address,
      port: info.port,
      clientId: process.env.PROJECT_STUDIO_ADMISSION_CLIENT_ID || "",
      sessionId: process.env.PROJECT_STUDIO_ADMISSION_SESSION_ID || "",
    };
    writeSync(readinessFd, JSON.stringify(readiness) + "\n");
    if (readinessFd > 2) closeSync(readinessFd);
  },
);

void server;
