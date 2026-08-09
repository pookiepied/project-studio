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
 * Nothing registers a port yet. The check is complete against an empty set, so
 * the rule is in place before the first server is wired up.
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
