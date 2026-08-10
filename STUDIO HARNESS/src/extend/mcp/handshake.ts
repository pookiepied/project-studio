import { ExtendError } from "../errors.js";
import { readEraProbe, type McpEra } from "./wire/era.js";

/**
 * The first exchange with an MCP server, and the only one that decides which
 * protocol the rest of the conversation uses.
 *
 * `era.ts` reads one answer and names an era. This sends the messages that
 * produce that answer, and then completes whichever handshake the answer
 * selected. Kept apart from the supervisor because the supervisor's subject is
 * a *process* — starting it, retrying it, giving up on it — and this one's is a
 * *conversation*. A server that runs perfectly and speaks a protocol we do not
 * have is a different failure from a server that will not start, and merging
 * the two would report the first as the second.
 *
 * **It takes a peer, not a connection.** Three methods, all of which
 * `McpConnection` already has. That is what lets every branch below be driven
 * by a scripted peer rather than by a server that would have to be persuaded to
 * misbehave on cue.
 *
 * **Nothing here decides permission.** A completed handshake means we can talk
 * to a server, not that it may do anything. What its tools are allowed to do is
 * the kernel's, per call, and a server whose project has not switched it on is
 * never reached by this code at all.
 */

/**
 * The modern protocol, which replaced the `initialize` handshake with
 * `server/discover`.
 *
 * A list of one today. Written as a list because the retry path below has to
 * pick from what a server says it supports, and that code should not need
 * rewriting the first time there are two.
 */
export const MODERN_PROTOCOL_VERSIONS = ["2026-07-28"] as const;

/**
 * The legacy revisions, newest first.
 *
 * Order is load-bearing: the first entry is what we offer, and the rest are
 * what we will accept if a server answers with something older. A server
 * downloaded today is overwhelmingly likely to speak one of these.
 */
export const LEGACY_PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
] as const;

/** How we introduce ourselves. Servers log this, and some branch on it. */
export const CLIENT_INFO = {
  name: "project-studio",
  version: "0.1.0",
} as const;

/** What a completed handshake established. Derived, so it is never stored. */
export interface McpSession {
  readonly era: McpEra;
  /** The revision both sides agreed on. */
  readonly protocolVersion: string;
  /** What the server says it can do. Read as data; nothing branches on it yet. */
  readonly capabilities: Readonly<Record<string, unknown>>;
  readonly serverName?: string;
  readonly serverVersion?: string;
}

/**
 * The part of a connection a handshake uses.
 *
 * Narrow on purpose. `McpConnection` satisfies it structurally, so nothing has
 * to be adapted, and a test can supply three functions instead of a process.
 */
export interface McpHandshakePeer {
  request(method: string, params?: unknown): Promise<unknown>;
  requestEnvelope(method: string, params?: unknown): Promise<unknown>;
  notify(method: string, params?: unknown): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(source: unknown, key: string): string | undefined {
  if (!isRecord(source)) return undefined;
  const value = source[key];
  return typeof value === "string" ? value : undefined;
}

function readCapabilities(result: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(result)) return {};
  const capabilities = result["capabilities"];
  return isRecord(capabilities) ? capabilities : {};
}

/**
 * Builds a session from whatever the server sent back.
 *
 * Every field is optional in practice, whatever the specification says, and a
 * missing `serverInfo` is not a reason to refuse a server that otherwise works.
 * The agreed version is the one thing we supply ourselves when the server did
 * not, because a session with no version cannot be described in a log line.
 */
function sessionFrom(
  era: McpEra,
  agreed: string,
  result: unknown,
): McpSession {
  const info = isRecord(result) ? result["serverInfo"] : undefined;
  const name = readString(info, "name");
  const version = readString(info, "version");

  return {
    era,
    protocolVersion: readString(result, "protocolVersion") ?? agreed,
    capabilities: readCapabilities(result),
    ...(name === undefined ? {} : { serverName: name }),
    ...(version === undefined ? {} : { serverVersion: version }),
  };
}

/**
 * Asks one question and returns the whole answer, or `undefined` for silence.
 *
 * A timeout is turned into `undefined` because that is exactly what
 * `readEraProbe` calls `no_answer`, and a server too old or too broken to
 * answer `server/discover` is the ordinary legacy case rather than a fault. A
 * connection that *died* is not translated: the server is gone, and calling it
 * legacy would send us on to an `initialize` that has nothing to talk to.
 */
async function askOrSilence(
  peer: McpHandshakePeer,
  method: string,
  params: unknown,
): Promise<unknown> {
  try {
    return await peer.requestEnvelope(method, params);
  } catch (error) {
    if (error instanceof ExtendError && error.kind === "timed_out") {
      return undefined;
    }
    throw error;
  }
}

/**
 * Completes the handshake and reports what was agreed.
 *
 * The order is decided in `era.ts` and followed exactly: `server/discover`
 * first, because the modern era is the one we prefer and asking the legacy
 * question first would make every modern server pay for a handshake it removed.
 */
export async function handshake(peer: McpHandshakePeer): Promise<McpSession> {
  const offered = MODERN_PROTOCOL_VERSIONS[0];
  const probe = readEraProbe(
    await askOrSilence(peer, "server/discover", { protocolVersion: offered }),
  );

  if (probe.era === "legacy") {
    return legacyHandshake(peer);
  }

  if (!("unsupportedVersion" in probe)) {
    return sessionFrom("modern", offered, probe.result);
  }

  // Modern, and it refused this version. Falling back to legacy here is the
  // mistake `era.ts` names: the server has already demonstrated it knows the
  // modern vocabulary, so an `initialize` would fail a second time and the user
  // would be shown the legacy failure for a modern server.
  const agreed = MODERN_PROTOCOL_VERSIONS.find((version) =>
    probe.supported.includes(version),
  );

  if (agreed === undefined) {
    throw new ExtendError("internal", {
      message:
        `That server speaks ${probe.supported.join(", ") || "no version we recognise"}, ` +
        `and Project Studio speaks ${MODERN_PROTOCOL_VERSIONS.join(", ")}. ` +
        `Updating one of them is the only fix.`,
    });
  }

  const retry = readEraProbe(
    await askOrSilence(peer, "server/discover", { protocolVersion: agreed }),
  );

  if (retry.era !== "modern" || "unsupportedVersion" in retry) {
    throw new ExtendError("internal", {
      message: `That server offered ${agreed} and then refused it.`,
    });
  }

  return sessionFrom("modern", agreed, retry.result);
}

/**
 * The pre-2026 handshake: `initialize`, then a notification that we are ready.
 *
 * The notification is not optional and is not decoration. A legacy server is
 * permitted to send nothing until it arrives, so skipping it produces a server
 * that connected, answered `initialize`, and then stays silent forever — which
 * reads as a hang rather than as a missing message.
 */
async function legacyHandshake(peer: McpHandshakePeer): Promise<McpSession> {
  const offered = LEGACY_PROTOCOL_VERSIONS[0];

  const result = await peer.request("initialize", {
    protocolVersion: offered,
    capabilities: {},
    clientInfo: CLIENT_INFO,
  });

  const agreed = readString(result, "protocolVersion") ?? offered;

  // The legacy rule is explicit: the server names the version, and a client
  // that does not speak it disconnects. Continuing anyway would mean sending
  // messages in a shape the other end never agreed to, and the failures from
  // that arrive later and look like anything but a version mismatch.
  if (!(LEGACY_PROTOCOL_VERSIONS as readonly string[]).includes(agreed)) {
    throw new ExtendError("internal", {
      message:
        `That server answered with protocol ${agreed}, which Project Studio does not speak. ` +
        `It speaks ${LEGACY_PROTOCOL_VERSIONS.join(", ")}.`,
    });
  }

  peer.notify("notifications/initialized");

  return sessionFrom("legacy", agreed, result);
}
