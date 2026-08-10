import { describe, expect, it } from "vitest";

import { ExtendError } from "../../src/extend/errors.js";
import {
  CLIENT_INFO,
  handshake,
  LEGACY_PROTOCOL_VERSIONS,
  MODERN_PROTOCOL_VERSIONS,
  type McpHandshakePeer,
} from "../../src/extend/mcp/handshake.js";

/**
 * A peer with no connection behind it.
 *
 * Three functions instead of a process, which is the whole reason the handshake
 * takes a peer. Every branch below — a server that refuses our version, a server
 * that answers with a protocol nobody speaks, a server that says nothing at all
 * — is a thing a real server would have to be persuaded to do on cue.
 */
type Answer = (method: string, params: unknown, call: number) => unknown;

class ScriptedPeer implements McpHandshakePeer {
  readonly asked: { method: string; params: unknown }[] = [];
  readonly notified: string[] = [];
  readonly #answer: Answer;
  #discoverCalls = 0;

  constructor(answer: Answer) {
    this.#answer = answer;
  }

  async requestEnvelope(method: string, params?: unknown): Promise<unknown> {
    return this.#ask(method, params, this.#discoverCalls++);
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    return this.#ask(method, params, 0);
  }

  notify(method: string): void {
    this.notified.push(method);
  }

  /** An `Error` in the script is thrown rather than returned. */
  #ask(method: string, params: unknown, call: number): unknown {
    this.asked.push({ method, params });
    const value = this.#answer(method, params, call);
    if (value instanceof Error) throw value;
    return value;
  }
}

const MODERN = MODERN_PROTOCOL_VERSIONS[0];
const LEGACY = LEGACY_PROTOCOL_VERSIONS[0];

/** What a legacy server says to a method it has never heard of. */
function methodNotFound(): unknown {
  return { jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Unknown method" } };
}

function discovered(result: unknown): unknown {
  return { jsonrpc: "2.0", id: 1, result };
}

describe("the first exchange with an MCP server", () => {
  describe("a modern server", () => {
    it("asks server/discover first and reports the modern era", async () => {
      const peer = new ScriptedPeer((method) =>
        method === "server/discover"
          ? discovered({
              protocolVersion: MODERN,
              capabilities: { tools: {} },
              serverInfo: { name: "blender", version: "2.0.0" },
            })
          : new Error("nothing else should be asked"),
      );

      const session = await handshake(peer);

      expect(peer.asked[0]?.method).toBe("server/discover");
      expect(session.era).toBe("modern");
      expect(session.protocolVersion).toBe(MODERN);
      expect(session.capabilities).toEqual({ tools: {} });
      expect(session.serverName).toBe("blender");
      expect(session.serverVersion).toBe("2.0.0");
    });

    it("never sends initialize, which the modern era removed", async () => {
      const peer = new ScriptedPeer(() => discovered({ protocolVersion: MODERN }));

      await handshake(peer);

      expect(peer.asked.map((entry) => entry.method)).toEqual(["server/discover"]);
      expect(peer.notified).toEqual([]);
    });

    it("works when the server sends no serverInfo", async () => {
      // Optional in practice whatever the specification says, and not a reason
      // to refuse a server that otherwise answers correctly.
      const peer = new ScriptedPeer(() => discovered({ protocolVersion: MODERN }));

      const session = await handshake(peer);

      expect(session.serverName).toBeUndefined();
      expect(session.capabilities).toEqual({});
    });

    it("stays modern for any error in the reserved band, not just the version one", async () => {
      // Keying on -32022 alone would read every other modern refusal as legacy
      // and send an initialize to a server that removed it.
      const peer = new ScriptedPeer((method) =>
        method === "server/discover"
          ? { jsonrpc: "2.0", id: 1, error: { code: -32050, message: "Busy" } }
          : new Error("initialize must not be sent to a modern server"),
      );

      const session = await handshake(peer);

      expect(session.era).toBe("modern");
      expect(peer.notified).toEqual([]);
    });
  });

  describe("a modern server that refuses our version", () => {
    it("retries with a version it named and does not fall back to legacy", async () => {
      const peer = new ScriptedPeer((method, _params, call) => {
        if (method !== "server/discover") return new Error("must not fall back");
        return call === 0
          ? {
              jsonrpc: "2.0",
              id: 1,
              error: {
                code: -32022,
                message: "Unsupported protocol version",
                data: { supported: ["2030-01-01", MODERN] },
              },
            }
          : discovered({ protocolVersion: MODERN });
      });

      const session = await handshake(peer);

      expect(session.era).toBe("modern");
      expect(peer.asked.map((entry) => entry.method)).toEqual([
        "server/discover",
        "server/discover",
      ]);
      expect(peer.asked[1]?.params).toEqual({ protocolVersion: MODERN });
    });

    it("fails with both version lists when nothing is in common", async () => {
      const peer = new ScriptedPeer(() => ({
        jsonrpc: "2.0",
        id: 1,
        error: {
          code: -32022,
          message: "Unsupported protocol version",
          data: { supported: ["2030-01-01"] },
        },
      }));

      // Naming both sides is the difference between a message a user can act on
      // and one that only says something failed.
      await expect(handshake(peer)).rejects.toThrow(/2030-01-01/);
      await expect(handshake(peer)).rejects.toThrow(new RegExp(MODERN));
    });

    it("fails clearly when a server offers a version and then refuses it", async () => {
      const peer = new ScriptedPeer(() => ({
        jsonrpc: "2.0",
        id: 1,
        error: {
          code: -32022,
          message: "Unsupported protocol version",
          data: { supported: [MODERN] },
        },
      }));

      await expect(handshake(peer)).rejects.toThrow(/offered .* and then refused it/);
    });
  });

  describe("a legacy server", () => {
    it("falls back to initialize when server/discover is unknown", async () => {
      const peer = new ScriptedPeer((method) =>
        method === "server/discover"
          ? methodNotFound()
          : { protocolVersion: LEGACY, capabilities: { tools: {} } },
      );

      const session = await handshake(peer);

      expect(peer.asked.map((entry) => entry.method)).toEqual([
        "server/discover",
        "initialize",
      ]);
      expect(session.era).toBe("legacy");
      expect(session.protocolVersion).toBe(LEGACY);
    });

    it("introduces itself and says when it is ready", async () => {
      // A legacy server may send nothing until the notification arrives, so
      // skipping it produces a server that connected and then stays silent —
      // which reads as a hang rather than as a missing message.
      const peer = new ScriptedPeer((method) =>
        method === "server/discover" ? methodNotFound() : { protocolVersion: LEGACY },
      );

      await handshake(peer);

      const initialize = peer.asked[1]?.params as { clientInfo: unknown };
      expect(initialize.clientInfo).toEqual(CLIENT_INFO);
      expect(peer.notified).toEqual(["notifications/initialized"]);
    });

    it("accepts an older revision the server chose", async () => {
      const older = LEGACY_PROTOCOL_VERSIONS[LEGACY_PROTOCOL_VERSIONS.length - 1];
      const peer = new ScriptedPeer((method) =>
        method === "server/discover" ? methodNotFound() : { protocolVersion: older },
      );

      const session = await handshake(peer);

      expect(session.protocolVersion).toBe(older);
    });

    it("refuses a revision nobody here speaks, rather than continuing", async () => {
      // Continuing would mean sending messages in a shape the other end never
      // agreed to, and those failures arrive later looking like anything but a
      // version mismatch.
      const peer = new ScriptedPeer((method) =>
        method === "server/discover" ? methodNotFound() : { protocolVersion: "1999-01-01" },
      );

      await expect(handshake(peer)).rejects.toThrow(/1999-01-01/);
      expect(peer.notified).toEqual([]);
    });

    it("treats silence as legacy, because that is what old servers do", async () => {
      const peer = new ScriptedPeer((method) =>
        method === "server/discover"
          ? new ExtendError("timed_out")
          : { protocolVersion: LEGACY },
      );

      const session = await handshake(peer);

      expect(session.era).toBe("legacy");
    });
  });

  it("does not call a dead connection legacy", async () => {
    // A server that is gone is not an old server. Sending initialize to a
    // closed connection would replace an accurate failure with a confusing one.
    const peer = new ScriptedPeer(() => new ExtendError("disconnected"));

    await expect(handshake(peer)).rejects.toThrow(ExtendError);
    expect(peer.asked.map((entry) => entry.method)).toEqual(["server/discover"]);
  });
});
