/**
 * Connection management — public surface.
 *
 * Cross-folder consumers (runtime/*) import connectionManager and
 * CONNECTION_TIMEOUTS from here. The event/state types and MAX_RECENT_EVENTS are
 * consumed either inside this folder (ConnectionManager.ts) or deep-imported by
 * app/hooks/useConnectionManager.ts; they are not re-exported here (RT-020).
 *
 * NOTE (RT-030): that deep import bypasses this barrel, so the "import only from
 * here" rule this header used to state is not actually enforced.
 */

export { connectionManager } from "./ConnectionManager";
export { CONNECTION_TIMEOUTS } from "./types";
