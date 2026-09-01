import { HostError } from "./errors.js";

/**
 * The seam between the two owners of this process's end.
 *
 * Since Flue 2.0 the entrypoint is ours (`src/server.ts`, compiled to
 * `dist/server.mjs`), and it owns the listen, the signals and the Flue
 * runtime's own stop - while the composition root (`src/app.ts`) owns the
 * Studio drain: admission invalidation, the MCP servers, the databases, the
 * telemetry. Every exit path - the Studio Host's `POST /api/shutdown`, the
 * TypeScript launcher's IPC `shutdown` message, SIGINT/SIGTERM, the parent's
 * disconnect - must run BOTH halves in the same order, or one of them is
 * skipped and something is left running or unclosed. That is exactly the
 * drift this seam exists to make impossible: there is one `requestShutdown`,
 * and both owners register their half into it.
 *
 * A half that was never registered makes `requestShutdown` throw rather than
 * run a partial stop: a stop that closes the database but leaves Flue's
 * coordinator running (or the reverse) is a lie the process exits with.
 */

/** The composition root's drain: admission, MCP, databases, telemetry. */
let drain: (() => Promise<void>) | undefined;

/** The loaded Flue application's own graceful stop. */
let stopRuntime: (() => Promise<void>) | undefined;

/**
 * Registers the composition drain. Called once, from `src/app.ts`, after the
 * composition root finished building - the drain closure closes what the
 * composition opened.
 */
export function registerShutdownDrain(register: () => Promise<void>): void {
  if (drain !== undefined) {
    throw new HostError("already_registered", {
      message:
        "The shutdown drain has already been registered by the composition root.",
    });
  }
  drain = register;
}

/**
 * Registers the runtime half. Called once, from `src/server.ts`, once the
 * application is loaded - before the listen, so a shutdown request that
 * arrives during startup finds a complete stop path.
 */
export function registerRuntimeStop(stop: () => Promise<void>): void {
  if (stopRuntime !== undefined) {
    throw new HostError("already_registered", {
      message:
        "The runtime stop has already been registered by the server entry.",
    });
  }
  stopRuntime = stop;
}

/**
 * The one graceful stop. Runtime first, drain second, exit last: the runtime
 * stops admitting and running new work, then the composition closes what it
 * opened, then the process exits with the code the caller chose. The exit
 * codes follow the conventions the supervisor and the launcher already
 * expect (0 for an asked-for stop, 130/143 for the signals).
 */
export function requestShutdown(exitCode = 0): void {
  if (drain === undefined || stopRuntime === undefined) {
    throw new HostError("stop_not_armed");
  }
  void (async () => {
    // Every stop half is bounded by its own work; the timer below is the
    // backstop for a half that never settles. Flue's persistence close and
    // our MCP drain are each sub-second in practice; a minute covers a wedged
    // machine without turning a hung stop into a silent one.
    setTimeout(() => {
      console.error("[flue] Shutdown timed out, exiting.");
      process.exit(exitCode);
    }, 60_000).unref();
    try {
      await stopRuntime();
    } catch (error) {
      console.error(
        "[flue] Runtime stop failed:",
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
    }
    try {
      await drain();
    } catch (error) {
      // Guarded for the same reason the runtime half is: a drain that
      // rejects must not turn an asked-for stop into an unhandled rejection
      // with somebody else's exit code. The failure is said out loud and the
      // process still exits with the code the caller chose.
      console.error(
        "[flue] Shutdown drain failed:",
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
    }
    process.exit(exitCode);
  })();
}
