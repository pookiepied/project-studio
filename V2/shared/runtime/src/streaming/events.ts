import {
  RUNTIME_PROTOCOL_VERSION,
  type RunState,
  type RuntimeClientMessage,
  type RuntimeEvent,
  type RuntimeServerControl,
} from "@studio/v2-contracts";

/**
 * WebSocket message shapes (Studio Runtime Protocol, RUNTIME-CHECKLIST.md §5).
 * Connections are a live view over the durable event log — a client
 * subscribes with the last sequence it processed and receives a snapshot plus
 * replay. Execution never depends on a connection staying open, and the
 * socket is a subscription: control commands live on the HTTP surface.
 */

export function snapshotMessage(
  run: RunState | null,
  latestSequence: number,
): string {
  const frame: RuntimeServerControl = {
    type: "connection.snapshot",
    protocolVersion: RUNTIME_PROTOCOL_VERSION,
    run,
    latestSequence,
  };
  return JSON.stringify(frame);
}

export function closeMessage(reason: string): string {
  const frame: RuntimeServerControl = { type: "connection.end", reason };
  return JSON.stringify(frame);
}

export function pongMessage(): string {
  const frame: RuntimeServerControl = { type: "pong" };
  return JSON.stringify(frame);
}

/** Parse a client frame; unknown or malformed input is ignored (null). */
export function parseClientMessage(
  raw: ArrayBuffer | string,
): RuntimeClientMessage | null {
  if (typeof raw !== "string") return null;
  try {
    const msg = JSON.parse(raw) as RuntimeClientMessage;
    if (msg.type === "subscribe" || msg.type === "ack" || msg.type === "ping") {
      return msg;
    }
    return null;
  } catch {
    return null;
  }
}

export function broadcast(sockets: WebSocket[], event: RuntimeEvent): void {
  const message = JSON.stringify(event);
  for (const ws of sockets) {
    try {
      ws.send(message);
    } catch {
      // A dead socket must never fail the run; hibernation reaps it.
    }
  }
}
