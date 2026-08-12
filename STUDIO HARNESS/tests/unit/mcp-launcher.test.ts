import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { InMemoryCredentialStore } from "../../src/credentials/memory-store.js";
import { McpConnection } from "../../src/extend/mcp/connection.js";
import { createMcpLauncher } from "../../src/extend/mcp/launcher.js";
import { McpServerRegistry, type McpServerRecord } from "../../src/extend/mcp/registry.js";
import { McpSupervisor } from "../../src/extend/mcp/supervisor.js";
import { openDatabase } from "../../src/storage/database.js";
import { isStudioError } from "../../src/contracts/errors.js";

/**
 * The secret is the point of this file.
 *
 * A launcher that starts servers is easy to write and easy to get right. The
 * part that is neither is the rule it exists to keep: the value is read from the
 * credential store at the moment of the launch, reaches exactly the one place it
 * is meant to, and appears nowhere else — not in the record, not in a failure,
 * not in the diagnostics a failure quotes.
 */

const SECRET = "sk-do-not-leak-0123456789";

const servers: Server[] = [];
const directories: string[] = [];
const closers: (() => void)[] = [];

async function workspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "studio-mcp-launch-"));
  directories.push(directory);
  return directory;
}

/**
 * A local MCP server that answers one thing: what it was given.
 *
 * Written to a file rather than mocked, because what is under test is the
 * handover — the working directory a child actually gets and the environment it
 * actually sees. A fake would assert what we passed, not what arrived.
 */
async function stdioServerScript(directory: string): Promise<string> {
  const path = join(directory, "server.mjs");
  await writeFile(
    path,
    `
let buffer = "";
// Closing stdin is how an MCP server is told to stop, and a well-behaved one
// exits. Without this the child outlives the test and holds its directory.
process.stdin.on("end", () => process.exit(0));
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  let index;
  while ((index = buffer.indexOf("\\n")) !== -1) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (line.trim() === "") continue;
    const message = JSON.parse(line);
    if (message.id === undefined) continue;
    process.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: { cwd: process.cwd(), env: process.env },
      }) + "\\n",
    );
  }
});
`,
    "utf8",
  );
  return path;
}

interface RemoteServer {
  readonly url: string;
  readonly received: IncomingMessage["headers"][];
}

async function httpServer(): Promise<RemoteServer> {
  const received: IncomingMessage["headers"][] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on("end", () => {
      received.push(request.headers);
      const id = (JSON.parse(body) as { id?: unknown }).id;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id, result: { ok: true } }));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${address.port}/mcp`, received };
}

function record(overrides: Partial<McpServerRecord> = {}): McpServerRecord {
  return {
    id: "probe",
    title: "Probe",
    transport: "stdio",
    args: [],
    env: {},
    auth: "none",
    ...overrides,
  };
}

afterEach(async () => {
  while (closers.length > 0) closers.pop()?.();
  while (servers.length > 0) {
    const server = servers.pop();
    if (server === undefined) continue;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory === undefined) continue;
    // The child has been asked to stop and may not have gone yet. On Windows a
    // running process holds its working directory, so this waits rather than
    // failing a test for a reason that has nothing to do with what it asserts.
    await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
  }
});

describe("createMcpLauncher", () => {
  describe("a local server", () => {
    it("starts it in the project's root, not ours", async () => {
      const project = await workspace();
      const script = await stdioServerScript(project);
      const launch = createMcpLauncher({
        credentials: new InMemoryCredentialStore(),
        projectRoot: () => project,
      });

      const channel = await launch.open(
        record({ command: process.execPath, args: [script] }),
      );
      closers.push(() => channel.close());
      const connection = new McpConnection(channel);

      const answer = (await connection.request("probe")) as { cwd: string };
      // Compared with `realpath` semantics in mind: the temporary directory is
      // reached through a symlink on macOS, so the child reports the resolved
      // path and the test compares the ends.
      expect(answer.cwd.endsWith(project.split(/[\\/]/).pop() ?? "")).toBe(true);
      expect(answer.cwd).not.toBe(process.cwd());
    });

    it("reads the root at the moment of the launch, not when it was built", async () => {
      const first = await workspace();
      const second = await workspace();
      const script = await stdioServerScript(first);
      let current = first;
      const launch = createMcpLauncher({
        credentials: new InMemoryCredentialStore(),
        projectRoot: () => current,
      });

      current = second;
      const channel = await launch.open(
        record({ command: process.execPath, args: [script] }),
      );
      closers.push(() => channel.close());
      const connection = new McpConnection(channel);

      const answer = (await connection.request("probe")) as { cwd: string };
      expect(answer.cwd.endsWith(second.split(/[\\/]/).pop() ?? "")).toBe(true);
    });

    it("puts the secret in the named variable and nowhere else", async () => {
      const project = await workspace();
      const script = await stdioServerScript(project);
      const credentials = new InMemoryCredentialStore();
      await credentials.set({ scope: "mcp", id: "probe" }, SECRET);

      const launch = createMcpLauncher({ credentials, projectRoot: () => project });
      const stored = record({
        command: process.execPath,
        args: [script],
        auth: "bearer",
        authEnvVar: "PROBE_TOKEN",
        env: { PROBE_MODE: "test" },
      });

      const channel = await launch.open(stored);
      closers.push(() => channel.close());
      const connection = new McpConnection(channel);

      const answer = (await connection.request("probe")) as {
        env: Record<string, string>;
      };
      expect(answer.env.PROBE_TOKEN).toBe(SECRET);
      expect(answer.env.PROBE_MODE).toBe("test");

      // The variable it was asked for, and no other. A second copy is a second
      // place it can be read from and a second place it can be logged.
      const carrying = Object.entries(answer.env)
        .filter(([, value]) => value === SECRET)
        .map(([name]) => name);
      expect(carrying).toEqual(["PROBE_TOKEN"]);

      // And nothing was written back onto the record.
      expect(JSON.stringify(stored)).not.toContain(SECRET);
    });

    it("does not inherit our own environment", async () => {
      const project = await workspace();
      const script = await stdioServerScript(project);
      process.env.STUDIO_LAUNCHER_PROBE = "should-not-travel";
      closers.push(() => {
        delete process.env.STUDIO_LAUNCHER_PROBE;
      });

      const launch = createMcpLauncher({
        credentials: new InMemoryCredentialStore(),
        projectRoot: () => project,
      });
      const channel = await launch.open(
        record({ command: process.execPath, args: [script] }),
      );
      closers.push(() => channel.close());
      const connection = new McpConnection(channel);

      const answer = (await connection.request("probe")) as {
        env: Record<string, string>;
      };
      expect(answer.env.STUDIO_LAUNCHER_PROBE).toBeUndefined();
    });
  });

  describe("a remote server", () => {
    it("signs in with the stored secret", async () => {
      const remote = await httpServer();
      const credentials = new InMemoryCredentialStore();
      await credentials.set({ scope: "mcp", id: "probe" }, SECRET);

      const launch = createMcpLauncher({
        credentials,
        projectRoot: () => process.cwd(),
      });
      const channel = await launch.open(
        record({ transport: "http", url: remote.url, auth: "bearer" }),
      );
      closers.push(() => channel.close());
      const connection = new McpConnection(channel);

      await connection.request("probe");
      expect(remote.received[0]?.authorization).toBe(`Bearer ${SECRET}`);
    });

    it("uses the server's own header when it has one", async () => {
      const remote = await httpServer();
      const credentials = new InMemoryCredentialStore();
      await credentials.set({ scope: "mcp", id: "probe" }, SECRET);

      const launch = createMcpLauncher({
        credentials,
        projectRoot: () => process.cwd(),
      });
      const channel = await launch.open(
        record({
          transport: "http",
          url: remote.url,
          auth: "header",
          authHeader: "x-api-key",
        }),
      );
      closers.push(() => channel.close());
      const connection = new McpConnection(channel);

      await connection.request("probe");
      expect(remote.received[0]?.["x-api-key"]).toBe(SECRET);
      expect(remote.received[0]?.authorization).toBeUndefined();
    });

    it("sends nothing when the server needs no sign-in", async () => {
      const remote = await httpServer();
      const credentials = new InMemoryCredentialStore();
      // Stored anyway. A record that says `none` must not pick one up.
      await credentials.set({ scope: "mcp", id: "probe" }, SECRET);

      const launch = createMcpLauncher({
        credentials,
        projectRoot: () => process.cwd(),
      });
      const channel = await launch.open(
        record({ transport: "http", url: remote.url, auth: "none" }),
      );
      closers.push(() => channel.close());
      const connection = new McpConnection(channel);

      await connection.request("probe");
      expect(remote.received[0]?.authorization).toBeUndefined();
      expect(JSON.stringify(remote.received[0])).not.toContain(SECRET);
    });
  });

  describe("when the secret is missing", () => {
    it("says so, names the server, and never starts it", async () => {
      const launch = createMcpLauncher({
        credentials: new InMemoryCredentialStore(),
        projectRoot: () => process.cwd(),
      });

      const thrown = await launch.open(
        record({ transport: "http", url: "http://127.0.0.1:1/mcp", auth: "bearer" }),
      ).catch((error: unknown) => error);

      expect(isStudioError(thrown)).toBe(true);
      expect((thrown as Error).message).toContain("Probe");
      expect((thrown as Error).message).toMatch(/settings/i);
    });

    it("does not put the secret in any failure it raises", async () => {
      const credentials = new InMemoryCredentialStore();
      await credentials.set({ scope: "mcp", id: "probe" }, SECRET);
      const launch = createMcpLauncher({
        credentials,
        projectRoot: () => process.cwd(),
      });

      // A refused destination, which is the failure most likely to quote what
      // it was given.
      const thrown = await launch.open(
        record({ transport: "http", url: "http://169.254.169.254/mcp", auth: "bearer" }),
      ).catch((error: unknown) => error);

      expect(thrown).toBeInstanceOf(Error);
      const report = isStudioError(thrown)
        ? JSON.stringify(thrown.toReport())
        : String(thrown);
      expect(report).not.toContain(SECRET);
      expect((thrown as Error).message).not.toContain(SECRET);
    });
  });

  /**
   * The condition `L-04` was written against, end to end.
   *
   * Every piece below has been tested against a fake. This is the first time a
   * row saved the way settings will save it is started the way the reconciler
   * will start it, and the class of bug it can find is the one no fake can:
   * two pieces that each work and do not fit.
   */
  it("starts a server that was saved the way settings will save it", async () => {
    const project = await workspace();
    const script = await stdioServerScript(project);
    const db = openDatabase({ path: ":memory:" });
    closers.push(() => db.close());

    const registry = new McpServerRegistry(db);
    registry.save({
      id: "probe",
      title: "Probe",
      transport: "stdio",
      command: process.execPath,
      args: [script],
      auth: "none",
    });

    const supervisor = new McpSupervisor({
      launch: createMcpLauncher({
        credentials: new InMemoryCredentialStore(),
        projectRoot: () => project,
      }),
    });
    closers.push(() => supervisor.stopAll());

    const saved = registry.get("probe");
    expect(saved).toBeDefined();
    const connection = await supervisor.ensure(saved as McpServerRecord);

    const answer = (await connection.request("probe")) as { cwd: string };
    expect(answer.cwd.endsWith(project.split(/[\\/]/).pop() ?? "")).toBe(true);
    expect(supervisor.status("probe")?.state).toBe("ready");
  });

  /**
   * `C-18`, second half: when two projects may share one process.
   *
   * The failure this prevents has no error message. A filesystem server started
   * in project A and handed to project B answers every call correctly, with the
   * wrong project's files — the folder wall failing silently, which is the one
   * shape of that failure nobody notices.
   */
  describe("what makes two launches the same launch", () => {
    it("gives two projects two processes for one local server", async () => {
      const first = await workspace();
      const second = await workspace();
      const script = await stdioServerScript(first);
      let current = first;

      const supervisor = new McpSupervisor({
        launch: createMcpLauncher({
          credentials: new InMemoryCredentialStore(),
          projectRoot: () => current,
        }),
      });
      closers.push(() => supervisor.stopAll());

      const stored = record({ command: process.execPath, args: [script] });
      const one = await supervisor.ensure(stored);
      current = second;
      const two = await supervisor.ensure(stored);

      expect(one).not.toBe(two);
      expect(supervisor.statuses()).toHaveLength(2);

      const firstRoot = ((await one.request("probe")) as { cwd: string }).cwd;
      const secondRoot = ((await two.request("probe")) as { cwd: string }).cwd;
      expect(firstRoot).not.toBe(secondRoot);
    });

    it("shares one process when nothing about the launch differs", async () => {
      const project = await workspace();
      const script = await stdioServerScript(project);
      const supervisor = new McpSupervisor({
        launch: createMcpLauncher({
          credentials: new InMemoryCredentialStore(),
          projectRoot: () => project,
        }),
      });
      closers.push(() => supervisor.stopAll());

      const stored = record({ command: process.execPath, args: [script] });
      expect(await supervisor.ensure(stored)).toBe(await supervisor.ensure(stored));
      expect(supervisor.statuses()).toHaveLength(1);
    });

    it("shares one connection to a remote server, which has no root", async () => {
      const remote = await httpServer();
      let current = "/project/one";
      const supervisor = new McpSupervisor({
        launch: createMcpLauncher({
          credentials: new InMemoryCredentialStore(),
          projectRoot: () => current,
        }),
      });
      closers.push(() => supervisor.stopAll());

      const stored = record({ transport: "http", url: remote.url });
      const one = await supervisor.ensure(stored);
      current = "/project/two";
      const two = await supervisor.ensure(stored);

      // Nothing project-shaped exists at the far end, so a second connection
      // would buy nothing and cost a session.
      expect(one).toBe(two);
      expect(supervisor.statuses()).toHaveLength(1);
    });

    it("stops every process of a server, not the one that matched first", async () => {
      const first = await workspace();
      const second = await workspace();
      const script = await stdioServerScript(first);
      let current = first;

      const supervisor = new McpSupervisor({
        launch: createMcpLauncher({
          credentials: new InMemoryCredentialStore(),
          projectRoot: () => current,
        }),
      });
      closers.push(() => supervisor.stopAll());

      const stored = record({ command: process.execPath, args: [script] });
      const one = await supervisor.ensure(stored);
      current = second;
      const two = await supervisor.ensure(stored);

      // Uninstalling, editing, and switching off all mean the server — never
      // "the copy rooted in one particular folder". A sibling left running is a
      // server the user believes is gone.
      supervisor.stop("probe");

      expect(supervisor.statuses()).toHaveLength(0);
      expect(one.closed).toBe(true);
      expect(two.closed).toBe(true);
    });
  });

  it("refuses a record the registry would never have written", async () => {
    const launch = createMcpLauncher({
      credentials: new InMemoryCredentialStore(),
      projectRoot: () => process.cwd(),
    });

    await expect(launch.open(record({ transport: "stdio" }))).rejects.toThrow(/command/);
    await expect(launch.open(record({ transport: "http" }))).rejects.toThrow(/address/);
  });
});
