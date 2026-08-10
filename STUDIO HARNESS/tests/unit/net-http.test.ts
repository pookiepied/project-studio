import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DestinationError } from "../../src/net/destination.js";
import { registerOwnPort, unregisterOwnPort } from "../../src/net/own-ports.js";

/**
 * The resolver is mocked rather than seamed into the client.
 *
 * Pinning is only meaningful against a name, and a name that resolves to a
 * refused address cannot be arranged with a real resolver without depending on
 * somebody else's DNS. Mocking the module keeps the production code free of a
 * hook that exists only for tests — the seam would be the thing most likely to
 * be left pointing at the wrong resolver.
 */
const resolved = vi.hoisted(() => ({
  answer: undefined as readonly { address: string; family: number }[] | undefined,
  fail: false,
}));

vi.mock("node:dns/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:dns/promises")>();
  return {
    ...actual,
    lookup: async (host: string, options: unknown) => {
      if (resolved.fail) throw new Error("getaddrinfo ENOTFOUND");
      if (resolved.answer !== undefined) return resolved.answer;
      return actual.lookup(host, options as never);
    },
  };
});

const { HttpError, requestDirect } = await import("../../src/net/http.js");

interface Running {
  readonly server: Server;
  readonly port: number;
  /** Every connection the server accepted, which is what "never opened" means. */
  readonly connections: { count: number };
  readonly requests: IncomingMessage[];
}

const running: Running[] = [];

async function serve(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<Running> {
  const requests: IncomingMessage[] = [];
  const connections = { count: 0 };
  const server = createServer((request, response) => {
    requests.push(request);
    handler(request, response);
  });
  server.on("connection", () => {
    connections.count += 1;
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const entry: Running = { server, port: address.port, connections, requests };
  running.push(entry);
  return entry;
}

beforeEach(() => {
  resolved.answer = undefined;
  resolved.fail = false;
});

afterEach(async () => {
  while (running.length > 0) {
    const entry = running.pop();
    if (entry === undefined) continue;
    entry.server.closeAllConnections();
    await new Promise<void>((resolve) => entry.server.close(() => resolve()));
  }
});

describe("requestDirect", () => {
  it("returns the status, headers, and body of a real answer", async () => {
    const target = await serve((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("hello");
    });

    const answer = await requestDirect({
      url: `http://127.0.0.1:${target.port}/page`,
      author: "user",
    });

    expect(answer.status).toBe(200);
    expect(answer.body).toBe("hello");
    expect(answer.headers["content-type"]).toBe("text/plain");
    expect(target.requests[0]?.url).toBe("/page");
  });

  it("sends a request body and the method it was given", async () => {
    const bodies: string[] = [];
    const target = await serve((request, response) => {
      let received = "";
      request.on("data", (chunk: Buffer) => {
        received += chunk.toString();
      });
      request.on("end", () => {
        bodies.push(received);
        response.writeHead(200);
        response.end("ok");
      });
    });

    await requestDirect({
      url: `http://127.0.0.1:${target.port}/rpc`,
      author: "user",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"jsonrpc":"2.0"}',
    });

    expect(target.requests[0]?.method).toBe("POST");
    expect(bodies[0]).toBe('{"jsonrpc":"2.0"}');
  });

  describe("pinning", () => {
    it("connects to the address it judged and sends the name as Host", async () => {
      const target = await serve((_request, response) => {
        response.writeHead(200);
        response.end("pinned");
      });
      resolved.answer = [{ address: "127.0.0.1", family: 4 }];

      const answer = await requestDirect({
        url: `http://pinned.test:${target.port}/`,
        author: "user",
      });

      expect(answer.body).toBe("pinned");
      // The socket went to the pinned address; the server was still told which
      // name was asked for, which is what a virtual host needs.
      expect(target.requests[0]?.headers.host).toBe(`pinned.test:${target.port}`);
    });

    it("never opens a socket when the name resolves to a refused address", async () => {
      const target = await serve((_request, response) => {
        response.writeHead(200);
        response.end("reached");
      });
      resolved.answer = [{ address: "169.254.169.254", family: 4 }];

      await expect(
        requestDirect({ url: `http://sneaky.test:${target.port}/`, author: "user" }),
      ).rejects.toBeInstanceOf(DestinationError);

      expect(target.connections.count).toBe(0);
    });

    it("refuses when any one of several addresses is refused", async () => {
      // The passing address is first, so an implementation that took the first
      // entry and judged only that one would let this through.
      resolved.answer = [
        { address: "203.0.113.7", family: 4 },
        { address: "169.254.169.254", family: 4 },
      ];

      await expect(
        requestDirect({ url: "http://mixed.test/", author: "user" }),
      ).rejects.toBeInstanceOf(DestinationError);
    });

    it("reports a name that does not resolve as unreachable", async () => {
      resolved.fail = true;

      await expect(
        requestDirect({ url: "http://missing.test/", author: "user" }),
      ).rejects.toBeInstanceOf(HttpError);
    });
  });

  describe("the policy", () => {
    it("refuses a private address a model chose and allows one a person typed", async () => {
      resolved.answer = [{ address: "10.1.2.3", family: 4 }];

      await expect(
        requestDirect({ url: "http://intranet.test/", author: "model" }),
      ).rejects.toBeInstanceOf(DestinationError);

      // The same address for a person gets past the policy and fails later, on
      // the connection — which is the point: it was allowed.
      await expect(
        requestDirect({
          url: "http://intranet.test/",
          author: "user",
          timeoutMs: 500,
        }),
      ).rejects.not.toBeInstanceOf(DestinationError);
    });

    it("refuses one of our own listening ports", async () => {
      const target = await serve((_request, response) => {
        response.end("control plane");
      });
      registerOwnPort(target.port);

      try {
        await expect(
          requestDirect({ url: `http://127.0.0.1:${target.port}/`, author: "user" }),
        ).rejects.toBeInstanceOf(DestinationError);
        expect(target.connections.count).toBe(0);
      } finally {
        unregisterOwnPort(target.port);
      }
    });
  });

  describe("redirects", () => {
    it("follows a redirect and returns the address that answered", async () => {
      const destination = await serve((_request, response) => {
        response.writeHead(200);
        response.end("arrived");
      });
      const start = await serve((_request, response) => {
        response.writeHead(302, {
          location: `http://127.0.0.1:${destination.port}/there`,
        });
        response.end();
      });

      const answer = await requestDirect({
        url: `http://127.0.0.1:${start.port}/here`,
        author: "user",
      });

      expect(answer.body).toBe("arrived");
      expect(answer.url).toBe(`http://127.0.0.1:${destination.port}/there`);
    });

    it("judges the redirect target and refuses a bad one mid-request", async () => {
      const start = await serve((_request, response) => {
        response.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
        response.end();
      });

      await expect(
        requestDirect({ url: `http://127.0.0.1:${start.port}/`, author: "user" }),
      ).rejects.toBeInstanceOf(DestinationError);
    });

    it("judges a redirect as the far end's choice, not the person's", async () => {
      // The caller is a person, who may reach a private address. The server it
      // reached may not send it to one.
      resolved.answer = undefined;
      const start = await serve((_request, response) => {
        response.writeHead(302, { location: "http://10.9.9.9/inside" });
        response.end();
      });

      await expect(
        requestDirect({ url: `http://127.0.0.1:${start.port}/`, author: "user" }),
      ).rejects.toBeInstanceOf(DestinationError);
    });

    it("drops credentials when a redirect changes origin", async () => {
      const destination = await serve((_request, response) => {
        response.writeHead(200);
        response.end("arrived");
      });
      const start = await serve((_request, response) => {
        response.writeHead(302, { location: `http://127.0.0.1:${destination.port}/` });
        response.end();
      });

      await requestDirect({
        url: `http://127.0.0.1:${start.port}/`,
        author: "user",
        headers: { authorization: "Bearer secret", accept: "text/plain" },
      });

      expect(start.requests[0]?.headers.authorization).toBe("Bearer secret");
      expect(destination.requests[0]?.headers.authorization).toBeUndefined();
      // Only the origin-bound ones go. An ordinary header is still the caller's
      // intent and survives the hop.
      expect(destination.requests[0]?.headers.accept).toBe("text/plain");
    });

    it("turns a redirected POST into a GET with no body", async () => {
      const destination = await serve((_request, response) => {
        response.writeHead(200);
        response.end("arrived");
      });
      const start = await serve((_request, response) => {
        response.writeHead(303, { location: `http://127.0.0.1:${destination.port}/` });
        response.end();
      });

      await requestDirect({
        url: `http://127.0.0.1:${start.port}/`,
        author: "user",
        method: "POST",
        body: "payload",
      });

      expect(destination.requests[0]?.method).toBe("GET");
    });

    it("stops after the redirect limit", async () => {
      const loop = await serve((_request, response) => {
        response.writeHead(302, { location: "/again" });
        response.end();
      });

      const thrown = await requestDirect({
        url: `http://127.0.0.1:${loop.port}/`,
        author: "user",
        maxRedirects: 2,
      }).catch((error: unknown) => error);

      expect(thrown).toBeInstanceOf(HttpError);
      expect((thrown as InstanceType<typeof HttpError>).kind).toBe("too_many_redirects");
      // Three requests: the first, then two allowed hops.
      expect(loop.requests.length).toBe(3);
    });
  });

  describe("limits", () => {
    it("drops the connection when the body passes the ceiling", async () => {
      const target = await serve((_request, response) => {
        response.writeHead(200);
        const block = "x".repeat(1024);
        for (let index = 0; index < 64; index += 1) response.write(block);
        response.end();
      });

      const thrown = await requestDirect({
        url: `http://127.0.0.1:${target.port}/`,
        author: "user",
        maxBytes: 2_048,
      }).catch((error: unknown) => error);

      expect(thrown).toBeInstanceOf(HttpError);
      expect((thrown as InstanceType<typeof HttpError>).kind).toBe("too_large");
    });

    it("gives up when the deadline passes", async () => {
      const target = await serve(() => {
        // Answers nothing, ever.
      });

      const thrown = await requestDirect({
        url: `http://127.0.0.1:${target.port}/`,
        author: "user",
        timeoutMs: 200,
      }).catch((error: unknown) => error);

      expect(thrown).toBeInstanceOf(HttpError);
      expect((thrown as InstanceType<typeof HttpError>).kind).toBe("timeout");
    });

    it("reports the caller's own stop as the caller's, not as a timeout", async () => {
      const target = await serve(() => {
        // Answers nothing, ever.
      });
      const controller = new AbortController();
      const stop = new Error("the user pressed stop");
      setTimeout(() => controller.abort(stop), 50);

      await expect(
        requestDirect({
          url: `http://127.0.0.1:${target.port}/`,
          author: "user",
          signal: controller.signal,
          timeoutMs: 30_000,
        }),
      ).rejects.toBe(stop);
    });
  });
});
