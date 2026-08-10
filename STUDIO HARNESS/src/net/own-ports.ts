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

export function isOwnPort(port: number): boolean {
  return ports.has(port);
}
