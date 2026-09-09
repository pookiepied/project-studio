import { createInterface } from "node:readline";

import { BrowserSession } from "./session.js";
import { definitions, toolByName } from "./tools.js";

/**
 * The browser capability, as an MCP server in its own process.
 *
 * Not in-process tools, though that would have been simpler, and ADR 0049 §3
 * gives both reasons. **The MCP path should be exercised by something real** —
 * the registry, the supervisor, the catalog, discovery and `list_changed` are
 * all mechanisms whose only user would otherwise be a test, and a mechanism
 * nobody trusts is a mechanism nobody maintains. **And a browser is the thing
 * most likely to wedge** — a separate process that hangs is a process to
 * restart, while an in-process hang is the harness.
 *
 * It speaks the modern era (`server/discover`), which is what Studio's own
 * client prefers, and answers the legacy `initialize` too, because being the
 * one server in the world that cannot talk to an older client would be a
 * strange thing to ship on purpose.
 *
 * **Nothing here launches a browser.** Connecting, discovering and listing all
 * happen with no Chromium anywhere. The first `tools/call` is what costs
 * something, which is the fourth state in ADR 0049 §4 and the reason the other
 * three are cheap.
 */

const PROTOCOL_MODERN = "2026-07-28";
const PROTOCOL_LEGACY = "2025-06-18";

const INFO = { name: "studio-browser", version: "1.0.0" } as const;

/**
 * One browser per conversation, when the caller says which conversation.
 *
 * MCP carries no conversation identity of its own — a tool call is a name and
 * some arguments — so Studio's own client sends one in `_meta`, and it does
 * that only for servers it wrote itself. A caller that sends nothing shares
 * one session, which is what any other MCP client gets and is the honest
 * fallback rather than a pretence of isolation.
 *
 * The point of the split is that one conversation's pages must not appear in
 * another's: a signed-in session, a half-filled form, a tab left on an
 * internal page are all things the next conversation has no business seeing.
 */
const sessions = new Map<string, BrowserSession>();

function sessionFor(meta: unknown): BrowserSession {
  const key =
    isRecord(meta) && typeof meta["studio/conversation"] === "string"
      ? (meta["studio/conversation"])
      : "shared";
  const existing = sessions.get(key);
  if (existing !== undefined) return existing;
  const created = new BrowserSession(key);
  sessions.set(key, created);
  return created;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Says what actually went wrong, where the library's own words would mislead.
 *
 * A reference that is not on the page produces a ten-second timeout and a call
 * log about a selector the model never wrote, which reads as "the page is
 * slow" — and a model told a page is slow waits and tries again, forever. The
 * true story is almost always that the page navigated since it was read, and
 * the fix is to read it again, so that is what the sentence says.
 *
 * Only failures whose real cause is knowable are rewritten. Everything else is
 * passed through exactly as it came, because inventing an explanation for an
 * error we do not understand is worse than showing the error.
 */
function explain(message: string): string {
  const stale = /data-studio-ref="(\d+)"/.exec(message);
  if (stale !== null && message.includes("Timeout")) {
    return (
      `There is no ref_${stale[1] as string} on this page any more. ` +
      "References come from reading a page and stop meaning anything once it navigates. " +
      "Read the page again and use a reference from that reading."
    );
  }
  return message;
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

async function handle(message: Record<string, unknown>): Promise<void> {
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
        serverInfo: INFO,
        capabilities: { tools: {} },
      });
      return;
    }

    case "initialize": {
      if (isNotification) return;
      reply(id, {
        protocolVersion: PROTOCOL_LEGACY,
        serverInfo: INFO,
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
      reply(id, { tools: definitions() });
      return;
    }

    case "tools/call": {
      if (isNotification) return;
      const name = params["name"];
      if (typeof name !== "string") {
        fail(id, -32602, "A tool call needs a name.");
        return;
      }
      const tool = toolByName(name);
      if (tool === undefined) {
        fail(id, -32602, `There is no tool called "${name}".`);
        return;
      }
      const args = isRecord(params["arguments"]) ? params["arguments"] : {};
      try {
        const result = await tool.run(sessionFor(params["_meta"]), args);
        reply(id, result);
      } catch (error) {
        // Answered as a tool result rather than as a protocol error, on
        // purpose: a click that missed is something the model should read and
        // recover from, not a transport failure that ends the conversation
        // with the server. The protocol errors above are for messages this
        // server genuinely cannot make sense of.
        const said = error instanceof Error ? error.message : String(error);
        reply(id, { content: [{ type: "text", text: explain(said) }], isError: true });
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
 * browser call can take thirty seconds and a `ping` behind it must not wait
 * for it. Order is not promised by the protocol; the id is what pairs an
 * answer with its question.
 */
function main(): void {
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
    void handle(message).catch((error: unknown) => {
      const said = error instanceof Error ? error.message : String(error);
      if (message["id"] !== undefined) fail(message["id"], -32603, said);
    });
  });

  // stdin closing is the client going away, and a browser with nobody to
  // answer to is 300 megabytes doing nothing. Closing before exiting is what
  // keeps a Chromium out of the person's task manager after Studio quits.
  const finish = (): void => {
    void Promise.all([...sessions.values()].map((session) => session.close())).finally(() => {
      process.exit(0);
    });
  };
  lines.on("close", finish);
  process.on("SIGTERM", finish);
  process.on("SIGINT", finish);
}

main();
