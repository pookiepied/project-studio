import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { McpConnection } from "../../src/extend/mcp/connection.js";
import { handshake } from "../../src/extend/mcp/handshake.js";
import { HttpChannel } from "../../src/extend/mcp/http-channel.js";
import { DestinationError } from "../../src/net/destination.js";

/**
 * Driven through a real `McpConnection` wherever it can be.
 *
 * The claim this file exists to check is not "the channel moves bytes" — it is
 * that the seam holds: the connection, the framing, and the handshake work over
 * HTTP with no HTTP-shaped special case anywhere in them. A test that spoke to
 * the channel directly would pass while that claim was false.
 */

interface Received {
  readonly method: string;
  readonly headers: IncomingMessage["headers"];
  readonly body: string;
}

interface Running {
  readonly url: string;
  readonly received: Received[];
}

type Handler = (request: Received, response: ServerResponse) => void;

const servers: Server[] = [];
const channels: HttpChannel[] = [];

async function serve(handler: Handler): Promise<Running> {
  const received: Received[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on("end", () => {
      const entry = { method: request.method ?? "", headers: request.headers, body };
      received.push(entry);
      handler(entry, response);
    });
  });
  servers.push(server);

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${address.port}/mcp`, received };
}

/** Answers a JSON-RPC request with a result, as a plain JSON body. */
function answerJson(response: ServerResponse, id: unknown, result: unknown): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
}

/** The same answer, delivered as one event on a stream. */
function answerStream(response: ServerResponse, id: unknown, result: unknown): void {
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.write(`data: ${JSON.stringify({ jsonrpc: "2.0", id, result })}\n\n`);
  response.end();
}

function idOf(body: string): unknown {
  return (JSON.parse(body) as { id?: unknown }).id;
}

function methodOf(body: string): string {
  return (JSON.parse(body) as { method?: string }).method ?? "";
}

async function open(options: Parameters<typeof HttpChannel.open>[0]): Promise<HttpChannel> {
  const channel = await HttpChannel.open(options);
  channels.push(channel);
  return channel;
}

afterEach(async () => {
  while (channels.length > 0) channels.pop()?.close();
  while (servers.length > 0) {
    const server = servers.pop();
    if (server === undefined) continue;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe("HttpChannel", () => {
  it("carries a request and its answer through a real connection", async () => {
    const server = await serve((request, response) => {
      answerJson(response, idOf(request.body), { tools: [] });
    });
    const connection = new McpConnection(await open({ url: server.url }));

    await expect(connection.request("tools/list")).resolves.toEqual({ tools: [] });
    expect(server.received[0]?.method).toBe("POST");
    expect(methodOf(server.received[0]?.body ?? "")).toBe("tools/list");
  });

  it("reads an answer that arrives as an event stream", async () => {
    const server = await serve((request, response) => {
      answerStream(response, idOf(request.body), { ok: true });
    });
    const connection = new McpConnection(await open({ url: server.url }));

    await expect(connection.request("tools/list")).resolves.toEqual({ ok: true });
  });

  it("reassembles an event split across chunks and ignores keep-alives", async () => {
    const server = await serve((request, response) => {
      const message = JSON.stringify({
        jsonrpc: "2.0",
        id: idOf(request.body),
        result: { ok: true },
      });
      response.writeHead(200, { "content-type": "text/event-stream" });
      // A comment line is a keep-alive and carries nothing. The event itself
      // arrives in two writes, which is the ordinary case for a real stream.
      response.write(": still here\n\n");
      response.write(`data: ${message.slice(0, 10)}`);
      setTimeout(() => {
        response.write(`${message.slice(10)}\n\n`);
        response.end();
      }, 20);
    });
    const connection = new McpConnection(await open({ url: server.url }));

    await expect(connection.request("tools/list")).resolves.toEqual({ ok: true });
  });

  it("completes a real handshake with no HTTP-shaped special case", async () => {
    const server = await serve((request, response) => {
      const id = idOf(request.body);
      if (methodOf(request.body) === "server/discover") {
        answerJson(response, id, {
          protocolVersion: "2026-07-28",
          capabilities: { tools: {} },
          serverInfo: { name: "remote", version: "1.0.0" },
        });
        return;
      }
      response.writeHead(202);
      response.end();
    });
    const connection = new McpConnection(await open({ url: server.url }));

    const session = await handshake(connection);
    expect(session.era).toBe("modern");
    expect(session.protocolVersion).toBe("2026-07-28");
    expect(session.serverName).toBe("remote");
  });

  describe("the address", () => {
    it("refuses an endpoint the policy never allows, before anything is sent", async () => {
      await expect(
        HttpChannel.open({ url: "http://169.254.169.254/mcp" }),
      ).rejects.toBeInstanceOf(DestinationError);
    });

    it("allows an address on this machine, which is the ordinary case", async () => {
      const server = await serve((request, response) => {
        answerJson(response, idOf(request.body), { ok: true });
      });
      const connection = new McpConnection(await open({ url: server.url }));

      await expect(connection.request("ping")).resolves.toEqual({ ok: true });
    });
  });

  describe("signing in", () => {
    it("sends a bearer token by default", async () => {
      const server = await serve((request, response) => {
        answerJson(response, idOf(request.body), {});
      });
      const connection = new McpConnection(await open({ url: server.url, secret: "s3cret" }));

      await connection.request("ping");
      expect(server.received[0]?.headers.authorization).toBe("Bearer s3cret");
    });

    it("sends the secret raw when the server uses its own header", async () => {
      const server = await serve((request, response) => {
        answerJson(response, idOf(request.body), {});
      });
      const connection = new McpConnection(
        await open({ url: server.url, secret: "s3cret", authHeaderName: "x-api-key" }),
      );

      await connection.request("ping");
      expect(server.received[0]?.headers["x-api-key"]).toBe("s3cret");
      expect(server.received[0]?.headers.authorization).toBeUndefined();
    });
  });

  describe("sessions", () => {
    it("echoes a session id a legacy server hands out, and never invents one", async () => {
      const server = await serve((request, response) => {
        response.setHeader("mcp-session-id", "abc123");
        answerJson(response, idOf(request.body), {});
      });
      const connection = new McpConnection(await open({ url: server.url }));

      await connection.request("first");
      // The first request cannot carry an id nobody has given us yet.
      expect(server.received[0]?.headers["mcp-session-id"]).toBeUndefined();

      await connection.request("second");
      expect(server.received[1]?.headers["mcp-session-id"]).toBe("abc123");
    });

    it("ends the connection when the server says the session is gone", async () => {
      const server = await serve((request, response) => {
        if (server.received.length === 1) {
          response.setHeader("mcp-session-id", "abc123");
          answerJson(response, idOf(request.body), {});
          return;
        }
        response.writeHead(404);
        response.end();
      });
      const connection = new McpConnection(await open({ url: server.url }));

      await connection.request("first");
      await expect(connection.request("second")).rejects.toThrow();
      expect(connection.closed).toBe(true);
    });

    it("tells the server the session is over when the channel closes", async () => {
      const server = await serve((request, response) => {
        response.setHeader("mcp-session-id", "abc123");
        if (request.method === "DELETE") {
          response.writeHead(204);
          response.end();
          return;
        }
        answerJson(response, idOf(request.body), {});
      });
      const channel = await open({ url: server.url });
      const connection = new McpConnection(channel);

      await connection.request("first");
      channel.close();

      await expect
        .poll(() => server.received.some((entry) => entry.method === "DELETE"))
        .toBe(true);
    });
  });

  describe("when the exchange goes wrong", () => {
    it("answers the request that failed rather than letting it time out", async () => {
      const server = await serve((_request, response) => {
        response.writeHead(502);
        response.end();
      });
      const connection = new McpConnection(await open({ url: server.url }));

      // The point: this settles at once. A channel that only recorded the
      // status would leave it waiting the full request timeout.
      await expect(connection.request("tools/list")).rejects.toThrow(/502/);
      expect(connection.diagnostics.join("\n")).toMatch(/502/);
    });

    it("does not answer a notification, which nothing is waiting for", async () => {
      const server = await serve((_request, response) => {
        response.writeHead(502);
        response.end();
      });
      const channel = await open({ url: server.url });
      const connection = new McpConnection(channel);

      connection.notify("notifications/initialized");
      await expect
        .poll(() => connection.diagnostics.some((line) => line.includes("502")))
        .toBe(true);
      // Nothing was waiting, so nothing was answered and nothing was invented.
      // An answer with no id would arrive as a message the connection cannot
      // place, and it says so — which is how this assertion can tell the
      // difference between "nothing was sent" and "something unusable was".
      expect(connection.inFlight).toBe(0);
      expect(connection.closed).toBe(false);
      expect(connection.diagnostics.join("\n")).not.toMatch(/server error|unhandled message/);
    });

    it("keeps the channel when one answer is too large, and refuses that call", async () => {
      const server = await serve((_request, response) => {
        response.writeHead(200, { "content-type": "application/json" });
        for (let index = 0; index < 64; index += 1) response.write("x".repeat(1024));
        response.end();
      });
      const channel = await open({ url: server.url, maxBytes: 2_048 });
      const connection = new McpConnection(channel);

      await expect(connection.request("tools/list")).rejects.toThrow(/more than can be read/);
      expect(connection.closed).toBe(false);
    });

    it("ends the channel when the server cannot be reached at all", async () => {
      const running = await serve((_request, response) => {
        response.end();
      });
      // The address stays valid and stops answering, which is the shape of a
      // server that has gone away rather than one call going badly. The
      // supervisor's job from here is to back off and try again, and it only
      // gets that chance if the channel ends.
      const server = servers.pop();
      server?.closeAllConnections();
      await new Promise<void>((resolve) => server?.close(() => resolve()));

      const channel = await open({ url: running.url });
      const connection = new McpConnection(channel);

      await expect(connection.request("tools/list")).rejects.toThrow();
      expect(connection.closed).toBe(true);
    });

    it("refuses to send once it has ended", async () => {
      const server = await serve((_request, response) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end("{}");
      });
      const channel = await open({ url: server.url });
      channel.close();

      expect(() => channel.send('{"jsonrpc":"2.0","id":1,"method":"ping"}\n')).toThrow();
    });
  });
});
