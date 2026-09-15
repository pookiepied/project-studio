import { createInterface } from "node:readline";

/**
 * An MCP server over stdio, for the capabilities Studio ships as its own.
 *
 * The browser wrote this first (ADR 0049 §3), and the computer capability is
 * its second user: two bundled servers with two copies of the handshake and
 * the error-to-result rule would drift the first time one of them learned
 * something. What lives here is only the protocol - both eras' handshakes,
 * `tools/list` in one page, `tools/call` dispatched by name with the caller's
 * `_meta` carried through, and a thrown error answered as an `isError` result
 * rather than a dead transport. What a tool *does* is the caller's, handed
 * in as functions.
 *
 * It speaks the modern era (`server/discover`), which is what Studio's own
 * client prefers, and answers the legacy `initialize` too, because being the
 * one server in the world that cannot talk to an older client would be a
 * strange thing to ship on purpose.
 */

const PROTOCOL_MODERN = "2026-07-28";
const PROTOCOL_LEGACY = "2025-06-18";

export interface ToolResultContent {
  readonly type: string;
  readonly [key: string]: unknown;
}

export interface ToolResult {
  readonly content: readonly ToolResultContent[];
  readonly isError?: boolean;
}

export interface StdioServerOptions {
  /** The `serverInfo` both handshakes answer with. */
  readonly info: { readonly name: string; readonly version: string };
  /** Every tool definition, answered whole to `tools/list`. */
  readonly definitions: () => readonly Record<string, unknown>[];
  /** Whether a tool of this name exists; `call` is only reached when it does. */
  readonly has: (name: string) => boolean;
  /**
   * Runs one tool. `meta` is the caller's `_meta`, which for Studio's own
   * client carries the conversation the call belongs to.
   */
  readonly call: (name: string, args: Record<string, unknown>, meta: unknown) => Promise<ToolResult>;
  /**
   * Rewrites an error message where the library's own words would mislead
   * the model. Identity by default: inventing an explanation for an error
   * we do not understand is worse than showing it.
   */
  readonly explain?: (message: string) => string;
  /** Runs when stdin closes or the process is told to stop, before exit. */
  readonly finish: () => Promise<void>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function send(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function reply(id: unknown, result: unknown): void {
  send({ jsonrpc: "2.0", id, result });
}

function fail(id: unknown, code: number, message: string): void {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handle(options: StdioServerOptions, message: Record<string, unknown>): Promise<void> {
  const method = message["method"];
  const id = message["id"];
  const params = isRecord(message["params"]) ? message["params"] : {};

  if (typeof method !== "string") return;

  // A notification has no id and gets no answer, ever. Answering one is a
  // protocol violation that some clients tolerate and others hang on.
  const isNotification = id === undefined || id === null;

  switch (method) {
    case "server/discover": {
      if (isNotification) return;
      const asked = params["protocolVersion"];
      if (typeof asked === "string" && asked !== PROTOCOL_MODERN) {
        // -32022 is the code the client reads to mean "I know this
        // vocabulary and not that version", which is what keeps it from
        // falling back to a legacy handshake this server would also answer.
        fail(id, -32022, `This server speaks ${PROTOCOL_MODERN}.`);
        return;
      }
      reply(id, {
        protocolVersion: PROTOCOL_MODERN,
        serverInfo: options.info,
        capabilities: { tools: {} },
      });
      return;
    }

    case "initialize": {
      if (isNotification) return;
      reply(id, {
        protocolVersion: PROTOCOL_LEGACY,
        serverInfo: options.info,
        capabilities: { tools: {} },
      });
      return;
    }

    case "notifications/initialized":
    case "notifications/cancelled":
      return;

    case "ping": {
      if (!isNotification) reply(id, {});
      return;
    }

    case "tools/list": {
      if (isNotification) return;
      // Every tool, in one page. Twenty-odd definitions are not worth a
      // cursor, and a client that asks for one gets `nextCursor` absent,
      // which is how the protocol says "that was all of them".
      reply(id, { tools: options.definitions() });
      return;
    }

    case "tools/call": {
      if (isNotification) return;
      const name = params["name"];
      if (typeof name !== "string") {
        fail(id, -32602, "A tool call needs a name.");
        return;
      }
      if (!options.has(name)) {
        fail(id, -32602, `There is no tool called "${name}".`);
        return;
      }
      const args = isRecord(params["arguments"]) ? params["arguments"] : {};
      try {
        reply(id, await options.call(name, args, params["_meta"]));
      } catch (error) {
        // Answered as a tool result rather than as a protocol error, on
        // purpose: a click that missed is something the model should read and
        // recover from, not a transport failure that ends the conversation
        // with the server. The protocol errors above are for messages this
        // server genuinely cannot make sense of.
        const said = error instanceof Error ? error.message : String(error);
        const explained = options.explain === undefined ? said : options.explain(said);
        reply(id, { content: [{ type: "text", text: explained }], isError: true });
      }
      return;
    }

    default: {
      if (!isNotification) fail(id, -32601, `Unknown method "${method}".`);
    }
  }
}

/**
 * Line-delimited JSON on stdin, which is what MCP over stdio is.
 *
 * Messages are handled as they arrive rather than one at a time, because a
 * call can take thirty seconds and a `ping` behind it must not wait for it.
 * Order is not promised by the protocol; the id is what pairs an answer with
 * its question.
 *
 * stdin closing is the client going away, and a capability with nobody to
 * answer to is a process doing nothing - or, for the browser, 300 megabytes
 * doing nothing. `finish` runs before exit so that nothing outlives Studio.
 */
export function serveStdio(options: StdioServerOptions): void {
  const lines = createInterface({ input: process.stdin });

  lines.on("line", (line) => {
    const trimmed = line.trim();
    if (trimmed === "") return;
    let message: unknown;
    try {
      message = JSON.parse(trimmed);
    } catch {
      send({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "That was not JSON." },
      });
      return;
    }
    if (!isRecord(message)) return;
    void handle(options, message).catch((error: unknown) => {
      const said = error instanceof Error ? error.message : String(error);
      if (message["id"] !== undefined) fail(message["id"], -32603, said);
    });
  });

  const finish = (): void => {
    void options.finish().finally(() => {
      process.exit(0);
    });
  };
  lines.on("close", finish);
  process.on("SIGTERM", finish);
  process.on("SIGINT", finish);
}

/** The conversation a call belongs to, from Studio's own client, or "shared". */
export function conversationKey(meta: unknown): string {
  return isRecord(meta) && typeof meta["studio/conversation"] === "string"
    ? meta["studio/conversation"]
    : "shared";
}
