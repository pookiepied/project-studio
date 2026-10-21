import { describe, expect, it } from "vitest";

import { ExtendError } from "../../src/extend/errors.js";
import { McpConnection, oversizeResponseId, type McpChannel } from "../../src/extend/mcp/connection.js";
import { DEFAULT_MAX_MESSAGE_BYTES } from "../../src/extend/mcp/wire/framing.js";
import { diagnosticRecorder } from "../../src/observability/recorder.js";
import { createRootExecutionContext, runWithExecutionContext } from "../../src/execution/context.js";

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
  it("excludes manual browser input and live frames from scoped diagnostic content", async () => {
    diagnosticRecorder.clear();
    diagnosticRecorder.configure({ enabled: true, captureContent: true, conversations: ["selected"] });
    const channel = new FakeChannel();
    const connection = new McpConnection(channel);
    try {
      const pending = runWithExecutionContext(createRootExecutionContext({ flue: { instanceId: "selected" } }),
        () => connection.request("studio/browser", { input: { action: "text", text: "private password sentinel" } }));
      const id = channel.lastSent().id;
      channel.emit({ jsonrpc: "2.0", id, result: { frame: "private live frame sentinel" } });
      expect(await pending).toEqual({ frame: "private live frame sentinel" });
      const events = diagnosticRecorder.read().events;
      expect(events.some((event) => event.name === "mcp.send")).toBe(true);
      expect(events.some((event) => event.name === "mcp.receive")).toBe(true);
      expect(JSON.stringify(events)).not.toContain("sentinel");
    } finally {
      connection.close();
      diagnosticRecorder.configure({ enabled: false, captureContent: false, conversations: [] });
      diagnosticRecorder.clear();
    }
  });
  it("retains the first settling frame when duplicate replies arrive in one chunk", async () => {
    diagnosticRecorder.clear();
    diagnosticRecorder.configure({ enabled: true, captureContent: true, conversations: ["selected"] });
    const channel = new FakeChannel();
    const connection = new McpConnection(channel);
    try {
      const pending = runWithExecutionContext(createRootExecutionContext({ flue: { instanceId: "selected" } }),
        () => connection.request("tools/call", {}));
      const id = channel.lastSent().id;
      const first = { jsonrpc: "2.0", id, result: { text: "first answer" } };
      const duplicate = { jsonrpc: "2.0", id, error: { code: -32000, message: "duplicate failure" } };
      channel.raw(`${JSON.stringify(first)}\n${JSON.stringify(duplicate)}\n`);
      expect(await pending).toEqual(first.result);
      expect(diagnosticRecorder.read().events.find((event) => event.name === "mcp.receive")?.content).toEqual(first);
    } finally {
      connection.close();
      diagnosticRecorder.configure({ enabled: false, captureContent: false, conversations: [] });
      diagnosticRecorder.clear();
    }
  });
  it("captures the actual scoped frames without serializing tool arguments a second time", async () => {
    diagnosticRecorder.clear();
    diagnosticRecorder.configure({ enabled: true, captureContent: true, conversations: ["selected"] });
    const channel = new FakeChannel();
    const connection = new McpConnection(channel);
    let reads = 0;
    try {
      const pending = runWithExecutionContext(createRootExecutionContext({ flue: { instanceId: "selected" } }),
        () => connection.request("tools/call", { get argument() { reads++; return "hello"; }, authToken: "opaque" }));
      const id = channel.lastSent().id;
      channel.emit({ jsonrpc: "2.0", id, result: { text: "answer" } });
      expect(await pending).toEqual({ text: "answer" });
      expect(reads).toBe(1);
      const events = diagnosticRecorder.read().events;
      expect(events.find((event) => event.name === "mcp.send")?.content).toEqual({ jsonrpc: "2.0", id, method: "tools/call",
        params: { argument: "hello", authToken: "[REDACTED]" } });
      expect(events.find((event) => event.name === "mcp.receive")?.content).toEqual({ jsonrpc: "2.0", id, result: { text: "answer" } });
    } finally {
      connection.close();
      diagnosticRecorder.configure({ enabled: false, captureContent: false, conversations: [] });
      diagnosticRecorder.clear();
    }
  });
  it("does not assign shared incoming notifications to the conversation that launched it", () => {
    diagnosticRecorder.clear();
    diagnosticRecorder.configure({ enabled: true, captureContent: true, conversations: ["first"] });
    const channel = new FakeChannel();
    const execution = createRootExecutionContext({ flue: { instanceId: "first" } });
    const connection = runWithExecutionContext(execution, () => new McpConnection(channel, { serverId: "shared" }));
    try {
      runWithExecutionContext(execution, () => channel.emit({ jsonrpc: "2.0", method: "notifications/progress", params: { private: "other conversation" } }));
      const notification = diagnosticRecorder.read().events.find((event) => event.attributes.stage === "notification");
      expect(notification?.identity).toEqual({});
      expect(notification?.attributes.connectionId).toBe(connection.connectionId);
      expect(notification?.attributes.serverId).toBe("shared");
      expect(notification?.content).toBeUndefined();
      expect(notification?.contentState).toBe("out_of_scope");
    } finally {
      connection.close();
      diagnosticRecorder.configure({ enabled: false, captureContent: false, conversations: [] });
      diagnosticRecorder.clear();
    }
  });
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

    it("cancels a request when the caller aborts", async () => {
      const channel = new FakeChannel();
      const connection = new McpConnection(channel);
      const controller = new AbortController();

      const waiting = connection.request("tools/call", undefined, controller.signal);
      controller.abort();

      await expect(waiting).rejects.toBeDefined();
      expect(connection.inFlight).toBe(0);
    });
  });

  describe("a deadline ends the wait, not the connection", () => {
    it("settles a request nobody answers, and keeps serving afterwards", async () => {
      // The timeout half of 008.2, unproven until #66. The per-request
      // deadline is the whole answer to a server that stops answering without
      // dying: the channel stays up, so "the other end went away" never fires,
      // and without a deadline the caller waits forever inside a map that
      // still looks alive. The deadline here is short and real rather than
      // faked, because the property under test is that a real timer settles a
      // real wait — if the deadline were removed, this request would never
      // settle and the test would fail by hanging, which is the shape of the
      // defect itself.
      const channel = new FakeChannel();
      const connection = new McpConnection(channel, { requestTimeoutMs: 100 });

      // The envelope variant, so the timeout path also exercises the
      // wants-envelope cleanup: that id is removed however the request
      // settles, timeout included — a documented property that had no test.
      const waiting = connection.requestEnvelope("tools/call");
      const sent = channel.lastSent();

      await expect(waiting).rejects.toMatchObject({ kind: "timed_out" });
      expect(connection.inFlight).toBe(0);

      // An answer that arrives after its deadline is ignored rather than
      // fatal: a late response for an id that already timed out is normal
      // when a server is slow, and it must neither end the connection nor
      // leave anything behind in the map.
      channel.emit({ jsonrpc: "2.0", id: sent.id, result: "late" });
      expect(connection.closed).toBe(false);

      // And what the deadline retired was one exchange, not the connection —
      // the next request is registered, answered, and cleaned up as ever. A
      // timed-out call must not wedge the connection it happened on.
      const later = connection.request("tools/list");
      channel.emit({ jsonrpc: "2.0", id: channel.lastSent().id, result: { tools: [] } });
      await expect(later).resolves.toEqual({ tools: [] });
      expect(connection.inFlight).toBe(0);
    });
  });

  describe("an answer larger than one message may be", () => {
    it("fails its request at once instead of leaving it to wait out the deadline", async () => {
      // A full-display PNG screenshot over the line limit was dropped and the
      // model waited thirty seconds for "did not answer in time" (2026-10-21).
      const channel = new FakeChannel();
      const connection = new McpConnection(channel, { requestTimeoutMs: 60_000 });
      const waiting = connection.request("tools/call");
      const { id } = channel.lastSent();
      const started = Date.now();
      // Streamed in pieces, the way a pipe delivers it, without a newline yet.
      const head = `{"jsonrpc":"2.0","id":${String(id)},"result":{"content":[{"type":"image","data":"`;
      channel.raw(head);
      for (let sent = 0; sent <= DEFAULT_MAX_MESSAGE_BYTES; sent += 65_536) channel.raw("A".repeat(65_536));
      await expect(waiting).rejects.toMatchObject({ kind: "too_large" });
      expect(Date.now() - started).toBeLessThan(5_000);
      channel.raw('"}]}}\n');
      // The connection goes on answering.
      const later = connection.request("tools/list");
      channel.emit({ jsonrpc: "2.0", id: channel.lastSent().id, result: { tools: [] } });
      await expect(later).resolves.toEqual({ tools: [] });
      connection.close();
    });

    it("reads the id only where a response puts it, never from inside the result", () => {
      expect(oversizeResponseId('{"jsonrpc":"2.0","id":7,"result":{')).toBe(7);
      expect(oversizeResponseId('{"id":12,"jsonrpc":"2.0","result":')).toBe(12);
      expect(oversizeResponseId('{"jsonrpc":"2.0","result":{"id":3,"data":"')).toBeUndefined();
      expect(oversizeResponseId('{"jsonrpc":"2.0","method":"notify","params":{"id":3')).toBeUndefined();
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

    it("delivers server tool-list changes to the lifecycle owner", () => {
      const channel = new FakeChannel();
      const connection = new McpConnection(channel);
      const notifications: { method: string; params: unknown }[] = [];
      connection.onNotification((method, params) => notifications.push({ method, params }));

      channel.emit({
        jsonrpc: "2.0",
        method: "notifications/tools/list_changed",
        params: { reason: "changed" },
      });

      expect(notifications).toEqual([
        { method: "notifications/tools/list_changed", params: { reason: "changed" } },
      ]);
      expect(connection.diagnostics).toEqual([]);
    });
  });

  describe("the whole answer, for the one caller that needs it", () => {
    it("resolves an error response instead of rejecting it", async () => {
      // The era probe reads the code to tell a modern refusal from a legacy
      // server that does not know the method. `request` throws that code away.
      const channel = new FakeChannel();
      const connection = new McpConnection(channel);

      const waiting = connection.requestEnvelope("server/discover");
      const sent = channel.lastSent();
      channel.emit({
        jsonrpc: "2.0",
        id: sent.id,
        error: { code: -32022, message: "Unsupported protocol version" },
      });

      await expect(waiting).resolves.toEqual({
        jsonrpc: "2.0",
        id: sent.id,
        error: { code: -32022, message: "Unsupported protocol version" },
      });
    });

    it("resolves a success response whole, not just its result", async () => {
      const channel = new FakeChannel();
      const connection = new McpConnection(channel);

      const waiting = connection.requestEnvelope("server/discover");
      const sent = channel.lastSent();
      channel.emit({ jsonrpc: "2.0", id: sent.id, result: { tools: [] } });

      await expect(waiting).resolves.toHaveProperty("result", { tools: [] });
    });

    it("still unwraps every ordinary request", async () => {
      // The envelope is per request. One asking for it must not change what the
      // next one gets.
      const channel = new FakeChannel();
      const connection = new McpConnection(channel);

      const envelope = connection.requestEnvelope("server/discover");
      const first = channel.lastSent();
      channel.emit({ jsonrpc: "2.0", id: first.id, result: { ok: true } });
      await envelope;

      const ordinary = connection.request("tools/list");
      const second = channel.lastSent();
      channel.emit({ jsonrpc: "2.0", id: second.id, result: { tools: [] } });

      await expect(ordinary).resolves.toEqual({ tools: [] });
    });

    it("still rejects when the connection dies with one waiting", async () => {
      // An error from the server is an answer; a dead connection is not.
      const channel = new FakeChannel();
      const connection = new McpConnection(channel);

      const waiting = connection.requestEnvelope("server/discover");
      channel.die();

      await expect(waiting).rejects.toThrow(ExtendError);
    });
  });

  describe("something has to learn that the connection ended", () => {
    it("tells its listener once, with the reason", () => {
      const channel = new FakeChannel();
      const connection = new McpConnection(channel);
      const reasons: unknown[] = [];
      connection.onClose((reason) => reasons.push(reason));

      channel.die(new ExtendError("disconnected", { message: "it crashed" }));
      channel.die(new ExtendError("disconnected", { message: "again" }));

      expect(reasons).toHaveLength(1);
      expect((reasons[0] as Error).message).toBe("it crashed");
    });

    it("tells a listener that arrives after the end", () => {
      // A connection that died between being built and being watched is
      // otherwise a server nothing ever restarts.
      const channel = new FakeChannel();
      const connection = new McpConnection(channel);
      channel.die();

      let told = false;
      connection.onClose(() => {
        told = true;
      });

      expect(told).toBe(true);
    });

    it("has already failed everything waiting by the time it tells anyone", () => {
      // A listener that reacts by starting a replacement must not find a dead
      // connection that still has requests in its map.
      const channel = new FakeChannel();
      const connection = new McpConnection(channel);
      let inFlightWhenTold = -1;
      connection.onClose(() => {
        inFlightWhenTold = connection.inFlight;
      });

      void connection.request("tools/list").catch(() => undefined);
      channel.die();

      expect(inFlightWhenTold).toBe(0);
    });
  });
});
