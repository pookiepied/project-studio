/**
 * The ports this process listens on.
 *
 * The model must never reach them, even if some loopback is later allowed. A
 * port known here turns a loopback destination into `own-port`, which is
 * refused before the permission question and is never offered as a grant.
 *
 * Live state, not durable state. A listening socket exists while the process
 * does; persisting it would keep a port marked as ours after the socket closed
 * or after a restart where nothing is listening.
 *
 * `src/auth/google-login.ts` registers the loopback port it binds for a sign-in
 * callback, and unregisters it when that server closes. **Any listener added
 * later registers too** — a listening port that is not in this set is a port the
 * `own-port` class cannot protect, and the guard then defends nothing while
 * still looking present. See `L-01`.
 */

const ports = new Set<number>();

export function registerOwnPort(port: number): void {
  ports.add(port);
}

export function unregisterOwnPort(port: number): void {
  ports.delete(port);
}

/**
 * The port the main listener bound, as published by the Flue entrypoint patch.
 *
 * The launcher passes `PORT: "0"`, so the port is chosen by the kernel when
 * the socket binds — after every module in this process has finished
 * importing. No `registerOwnPort` call can exist for it, because nothing
 * inside `src/` is ever told the number; the one place that has it is the
 * `onReady` callback in the generated entrypoint, which records it here.
 */
const BOUND_PORT_VARIABLE = "PROJECT_STUDIO_BOUND_PORT";

export function isOwnPort(port: number): boolean {
  // Read on every call rather than captured at import: the variable is set
  // after this module initializes, so a value captured once would always be
  // absent — the exact failure the entrypoint recording exists to close.
  const bound = Number.parseInt(process.env[BOUND_PORT_VARIABLE] ?? "", 10);
  return ports.has(port) || (Number.isInteger(bound) && bound === port);
}
