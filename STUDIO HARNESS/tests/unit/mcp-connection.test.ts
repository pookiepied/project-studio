import { describe, expect, it } from "vitest";

import { ExtendError } from "../../src/extend/errors.js";
import { McpConnection, type McpChannel } from "../../src/extend/mcp/connection.js";

/**
 * A channel with no process behind it.
 *
 * The point of injecting the channel: every rule about what happens when a
 * server misbehaves can be provoked exactly, in order, without spawning
 * anything. A test that needs a real server can only hope for the timing it
 * wants.
 */
class FakeChannel implements McpChannel {
  readonly sent: string[] = [];
  #data: ((chunk: string | Uint8Array) => void) | undefined;
  #stderr: ((chunk: string | Uint8Array) => void) | undefined;
  #close: ((reason?: unknown) => void) | undefined;
  closed = false;
  failSend = false;

  send(line: string): void {
    if (this.failSend) throw new ExtendError("disconnected");
    this.sent.push(line);
  }
  onData(listener: (chunk: string | Uint8Array) => void): void {
    this.#data = listener;
  }
  onStderr(listener: (chunk: string | Uint8Array) => void): void {
    this.#stderr = listener;
  }
  onClose(listener: (reason?: unknown) => void): void {
    this.#close = listener;
  }
  close(): void {
    this.closed = true;
  }

  /** Pretend the server wrote this to stdout. */
  emit(value: unknown): void {
    this.#data?.(`${JSON.stringify(value)}\n`);
  }
  raw(text: string): void {
    this.#data?.(text);
  }
  logs(text: string): void {
    this.#stderr?.(text);
  }
  die(reason?: unknown): void {
    this.#close?.(reason);
  }

  /** The last request we sent, parsed. */
  lastSent(): { id: number; method: string } {
    const line = this.sent[this.sent.length - 1] ?? "{}";
    return JSON.parse(line) as { id: number; method: string };
  }
}

describe("one conversation with one MCP server", () => {
  describe("a request finds its answer", () => {
    it("sends a well-formed request and resolves on the matching id", async () => {
      const channel = new FakeChannel();
      const connection = new McpConnection(channel);

      const waiting = connection.request("tools/list");
      const sent = channel.lastSent();

      expect(sent.method).toBe("tools/list");
      channel.emit({ jsonrpc: "2.0", id: sent.id, result: { tools: [] } });

      await expect(waiting).resolves.toEqual({ tools: [] });
      expect(connection.inFlight).toBe(0);
    });

    it("is registered before it is sent", async () => {
      // A server fast enough to answer synchronously would otherwise reply to
      // an id nothing is waiting for yet, and the answer would be dropped as
      // unknown.
      const channel = new FakeChannel();
      const connection = new McpConnection(channel);
      const original = channel.send.bind(channel);
      let inFlightAtSend = -1;

      channel.send = (line: string) => {
        inFlightAtSend = connection.inFlight;
        original(line);
      };

      const waiting = connection.request("tools/list");
      channel.emit({ jsonrpc: "2.0", id: channel.lastSent().id, result: 1 });
      await waiting;

      expect(inFlightAtSend).toBe(1);
    });

    it("rejects with the server's message on an error response", async () => {
      const channel = new FakeChannel();
      const connection = new McpConnection(channel);

      const waiting = connection.request("tools/call");
      channel.emit({
        jsonrpc: "2.0",
        id: channel.lastSent().id,
        error: { code: -32602, message: "That tool needs a path." },
      });

      await expect(waiting).rejects.toThrow("That tool needs a path.");
      expect(connection.inFlight).toBe(0);
    });

    it("fails immediately when the send itself fails", async () => {
      // Rather than waiting out the request timeout for an answer that was
      // never asked for.
      const channel = new FakeChannel();
      const connection = new McpConnection(channel);
      channel.failSend = true;

      await expect(connection.request("tools/list")).rejects.toThrow(ExtendError);
      expect(connection.inFlight).toBe(0);
    });
  });

  describe("one bad line does not end a good connection", () => {
    it("keeps answering after a line it cannot read", async () => {
      const channel = new FakeChannel();
      const connection = new McpConnection(channel);

      const waiting = connection.request("tools/list");
      channel.raw("this is not json\n");
      channel.emit({ jsonrpc: "2.0", id: channel.lastSent().id, result: "ok" });

      await expect(waiting).resolves.toBe("ok");
      expect(connection.closed).toBe(false);
    });

    it("records what it could not read, so silence is explainable", () => {
      const channel = new FakeChannel();
      const connection = new McpConnection(channel);

      channel.raw("not json at all\n");

      expect(connection.diagnostics.join(" ")).toContain("unreadable");
    });

    it("ignores an answer to an id nobody is waiting for", async () => {
      // A late response after a timeout is normal, not exceptional.
      const channel = new FakeChannel();
      const connection = new McpConnection(channel);

      expect(() =>
        channel.emit({ jsonrpc: "2.0", id: 999, result: "late" }),
      ).not.toThrow();
      expect(connection.closed).toBe(false);
    });

    it("records a server error that answers no request", () => {
      const channel = new FakeChannel();
      const connection = new McpConnection(channel);

      channel.emit({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32603, message: "internal boom" },
      });

      expect(connection.diagnostics.join(" ")).toContain("internal boom");
    });
  });

  describe("what the server says about itself", () => {
    it("keeps diagnostics so a failure can quote them", () => {
      const channel = new FakeChannel();
      const connection = new McpConnection(channel);

      channel.logs("Error: cannot find module 'mcp-sdk'\n");

      expect(connection.diagnostics).toContain(
        "Error: cannot find module 'mcp-sdk'",
      );
    });

    it("keeps the last lines rather than the first", () => {
      // A server logging in a loop must not grow our memory, and the lines
      // that say why it failed are at the end.
      const channel = new FakeChannel();
      const connection = new McpConnection(channel, { stderrLines: 3 });

      for (let i = 0; i < 10; i += 1) channel.logs(`line ${i}\n`);

      expect(connection.diagnostics).toEqual(["line 7", "line 8", "line 9"]);
    });

    it("quotes the last line when the server dies", async () => {
      const channel = new FakeChannel();
      const connection = new McpConnection(channel);

      const waiting = connection.request("tools/list");
      channel.logs("Error: port already in use\n");
      channel.die();

      await expect(waiting).rejects.toThrow(/port already in use/);
    });
  });

  describe("when the other end goes away", () => {
    it("fails everything that was waiting", async () => {
      // A dead channel with requests still in the map means promises that
      // never settle, which looks like an agent hanging with nothing in any
      // log to say why.
      const channel = new FakeChannel();
      const connection = new McpConnection(channel);

      const first = connection.request("a");
      const second = connection.request("b");
      channel.die();

      await expect(first).rejects.toThrow(ExtendError);
      await expect(second).rejects.toThrow(ExtendError);
      expect(connection.inFlight).toBe(0);
      expect(connection.closed).toBe(true);
    });

    it("refuses a new request once it is closed", async () => {
      const channel = new FakeChannel();
      const connection = new McpConnection(channel);
      channel.die();

      await expect(connection.request("a")).rejects.toThrow(ExtendError);
    });

    it("closes the channel when we close, and only once", () => {
      const channel = new FakeChannel();
      const connection = new McpConnection(channel);

      connection.close();
      connection.close();

      expect(channel.closed).toBe(true);
      expect(connection.closed).toBe(true);
    });

    it("drops a notification after close rather than throwing", () => {
      // Nothing is waiting on a notification, so there is no caller to mislead
      // and no reason to raise.
      const channel = new FakeChannel();
      const connection = new McpConnection(channel);
      connection.close();

      expect(() => connection.notify("cancelled")).not.toThrow();
    });
  });

  describe("a notification is not a request", () => {
    it("carries no id and registers nothing", () => {
      const channel = new FakeChannel();
      const connection = new McpConnection(channel);

      connection.notify("progress", { done: 1 });

      const sent = JSON.parse(channel.sent[0] as string) as Record<string, unknown>;
      expect("id" in sent).toBe(false);
      expect(sent.method).toBe("progress");
      expect(connection.inFlight).toBe(0);
    });
  });
});
