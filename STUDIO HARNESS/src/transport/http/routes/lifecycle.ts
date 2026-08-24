import { Hono } from "hono";

import { authContext, type AdmissionEnv } from "../middleware/admission.js";

export interface LifecycleRoutesOptions {
  /**
   * Begins this process's graceful shutdown. Fire-and-forget on purpose: the
   * caller is the Studio Host, which does not read a completion state off this
   * response — it watches the process exit. The composition root owns what
   * "shut down" means (drain, close, exit); this route only decides who may
   * ask for it.
   */
  readonly requestShutdown: () => void;
}

/**
 * The one route that ends the process, and why it is HTTP rather than a signal.
 *
 * The Host cannot use the polite channels the process already has. `SIGTERM`
 * is not deliverable on Windows — `process.kill` there maps to
 * `TerminateProcess`, which runs no handler, so the database is never closed
 * and its WAL never checkpointed (a hot `-wal` beside every stopped harness).
 * `SIGINT`/`SIGBREAK` arrive, but sending them from a GUI process means
 * `GenerateConsoleCtrlEvent`, which needs the child in the caller's console
 * and process group and is unreliable from a windowed app. The parent-owned
 * `"shutdown"` message needs Node's IPC channel, which `std::process::Command`
 * cannot create. Admission-protected HTTP needs none of that: the Host already
 * holds the per-launch bearer and already speaks this transport.
 *
 * Restricted to the `studio-host` client type rather than an admission scope:
 * the scope list is ADR 0028's to change, and the distinction this route needs
 * — "the process that owns this process" versus "a UI consuming it" — is
 * exactly what the client-type model already says. Note what this check can
 * and cannot do: production mints exactly one credential, typed
 * `studio-host` and shared by the Host and its webview, so from in here they
 * are indistinguishable. Keeping the desktop UI off this route is enforced
 * one hop earlier, at the Studio's own service seam
 * (`STUDIO/src-tauri/src/services/mod.rs`), which refuses the path for the
 * webview; this check distinguishes among HTTP clients a Host does not
 * control, and costs nothing.
 */
export function createLifecycleRoutes(
  options: LifecycleRoutesOptions,
): Hono<AdmissionEnv> {
  const routes = new Hono<AdmissionEnv>();

  routes.post("/shutdown", (context) => {
    if (authContext(context).clientType !== "studio-host") {
      return context.json(
        {
          error: "Only the Studio host may stop the harness process.",
          code: "admission.client_type_required",
          clientType: "studio-host",
        },
        403,
      );
    }

    options.requestShutdown();
    // Accepted, not completed: the drain happens after this response is on the
    // wire, and the Host's confirmation is the process exiting, not this body.
    return context.json({ accepted: true }, 202);
  });

  return routes;
}
