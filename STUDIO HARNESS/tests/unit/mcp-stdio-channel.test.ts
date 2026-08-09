import { describe, expect, it } from "vitest";

import { McpConnection } from "../../src/extend/mcp/connection.js";
import { StdioChannel } from "../../src/extend/mcp/stdio-channel.js";
import { ProcessError } from "../../src/process/errors.js";

/**
 * These tests start real processes, which is the point.
 *
 * Everything that decides anything is tested against a fake channel elsewhere.
 * What is left here is what only an operating system can answer: does the
 * program actually start, does the environment really exclude what we say it
 * excludes, does a program that dies immediately produce a usable failure.
 */

const NODE = process.execPath;

/** A one-line MCP-shaped server: reads NDJSON, answers every request. */
const ECHO_SERVER = `
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\\n")) !== -1) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (line.trim() === "") continue;
    const message = JSON.parse(line);
    process.stdout.write(
      JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { saw: message.method } }) + "\\n",
    );
  }
});
`;

describe("a local MCP server as a child process", () => {
  it("starts a program and carries a request and its answer", async () => {
    const channel = await StdioChannel.start({
      command: NODE,
      args: ["-e", ECHO_SERVER],
      cwd: process.cwd(),
      startupTimeoutMs: 300,
    });
    const connection = new McpConnection(channel);

    try {
      await expect(connection.request("tools/list")).resolves.toEqual({
        saw: "tools/list",
      });
    } finally {
      connection.close();
    }
  });

  it("reports a program that exits immediately as a failure to start", async () => {
    // The most common failure by a wide margin — a missing module, a bad
    // argument. Without the startup window it presents as a connection that
    // answers nothing, which is the hardest kind of report to act on.
    await expect(
      StdioChannel.start({
        command: NODE,
        args: ["-e", "process.exit(3)"],
        cwd: process.cwd(),
        startupTimeoutMs: 2_000,
      }),
    ).rejects.toThrow(/exit code 3/);
  });

  it("refuses a command that is not an absolute path", async () => {
    // The same check `shell` and `git` pass. Reused rather than restated, so
    // the rule cannot drift for MCP alone.
    await expect(
      StdioChannel.start({
        command: "node",
        args: [],
        cwd: process.cwd(),
      }),
    ).rejects.toThrow(ProcessError);
  });

  it("gives the server an empty PATH, so it cannot find tools nobody approved", async () => {
    const channel = await StdioChannel.start({
      command: NODE,
      args: [
        "-e",
        `process.stdout.write(JSON.stringify({ path: process.env.PATH ?? null }) + "\\n");
         process.stdin.resume();`,
      ],
      cwd: process.cwd(),
      startupTimeoutMs: 300,
    });

    const seen: unknown[] = [];
    channel.onData((chunk) => seen.push(String(chunk)));
    channel.onStderr(() => undefined);
    channel.onClose(() => undefined);

    await new Promise((resolve) => setTimeout(resolve, 200));
    channel.close();

    // Empty, not absent. Windows delivers PATH to a child whatever we pass, so
    // it is blanked explicitly — see `buildEnvironment`. What matters is that
    // the server cannot resolve a program by name, and an empty PATH is that.
    expect(seen.join("")).toContain('"path":""');
  });

  it("passes through only what it was given", async () => {
    const channel = await StdioChannel.start({
      command: NODE,
      args: [
        "-e",
        `process.stdout.write(JSON.stringify({ token: process.env.SERVER_TOKEN ?? null }) + "\\n");
         process.stdin.resume();`,
      ],
      cwd: process.cwd(),
      env: { SERVER_TOKEN: "from-the-keychain" },
      startupTimeoutMs: 300,
    });

    const seen: string[] = [];
    channel.onData((chunk) => seen.push(String(chunk)));
    channel.onStderr(() => undefined);
    channel.onClose(() => undefined);

    await new Promise((resolve) => setTimeout(resolve, 200));
    channel.close();

    expect(seen.join("")).toContain("from-the-keychain");
  });

  it("tells the connection when the server stops on its own", async () => {
    const channel = await StdioChannel.start({
      command: NODE,
      args: ["-e", "setTimeout(() => process.exit(0), 150);"],
      cwd: process.cwd(),
      startupTimeoutMs: 100,
    });
    const connection = new McpConnection(channel);

    // Nothing will ever answer this. The exit is what settles it, and without
    // that this promise never resolves and the agent appears to hang.
    const waiting = connection.request("tools/list");

    await expect(waiting).rejects.toThrow();
    expect(connection.closed).toBe(true);
  });
});
