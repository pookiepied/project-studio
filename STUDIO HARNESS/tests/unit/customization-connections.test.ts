import { mkdirSync, mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CUSTOMIZATION_SERVER_ID,
  customizationServerPath,
  registerBuiltInServers,
} from "../../src/extend/mcp/builtin.js";
import { McpServerRegistry } from "../../src/extend/mcp/registry.js";
import { ExtensionSelectionStore, GLOBAL_SCOPE } from "../../src/extend/selection.js";
import { connectionTools } from "../../src/customization/tools.js";
import {
  bundledNpmCli,
  connectionDirectory,
  installPackage,
} from "../../src/customization/installer.js";
import { managementChildEnv } from "../../src/extend/mcp/launcher.js";
import type { ToolResult } from "../../src/serve/stdio.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";

/** The one text block of a tool result, when there is one. */
function textOf(result: ToolResult): string {
  const first = result.content[0];
  return first !== undefined && first["type"] === "text" && typeof first["text"] === "string"
    ? (first["text"])
    : "";
}

/**
 * The connection tools, against a recording stand-in for the harness's own
 * management routes.
 *
 * What is under test is what these answers *say*, because that is the part
 * the model reads: which calls a verb makes and in what order, that the
 * secret rides the credential route and never the record, that a switch
 * answers with what it now resolves to rather than what was stored, and
 * that the two timing truths - it starts in the background, inherit is not
 * off - are said every time they matter.
 */

interface RecordedCall {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

type Responder = (call: RecordedCall, index: number) => Response;

function recordingFetch(respond: Responder): {
  readonly calls: readonly RecordedCall[];
  readonly fetch: typeof fetch;
} {
  const calls: RecordedCall[] = [];
  const undici: typeof fetch = (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const call: RecordedCall = {
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined,
    };
    const index = calls.length;
    calls.push(call);
    return Promise.resolve(respond(call, index));
  };
  return { calls, fetch: undici };
}

function json(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const connectionTool = (name: string) => {
  const tool = connectionTools.find((candidate) => candidate.definition.name === name);
  if (tool === undefined) throw new Error(`No connection tool called ${name}.`);
  return tool;
};

const callsOf = (call: RecordedCall): string =>
  `${call.method} ${new URL(call.url).pathname}${new URL(call.url).search}`;

async function answered(
  respond: Responder,
  conversationId: string,
  input: Record<string, unknown>,
  name: string = "add_connection",
): Promise<string> {
  const recorded = recordingFetch(respond);
  vi.stubGlobal("fetch", recorded.fetch);
  process.env.STUDIO_MANAGEMENT_URL = "http://127.0.0.1:1";
  process.env.STUDIO_MANAGEMENT_CREDENTIAL = "token-1";
  try {
    const result = await connectionTool(name).run(conversationId, input);
    return textOf(result);
  } finally {
    vi.unstubAllGlobals();
    delete process.env.STUDIO_MANAGEMENT_URL;
    delete process.env.STUDIO_MANAGEMENT_CREDENTIAL;
  }
}

describe("the connection tools, against the management routes they speak", () => {
  it("installs an address connection: record, then switch, secretless when it has none", async () => {
    let answer: string | undefined;
    const harness = recordingFetch(() => json({ id: "blender", title: "Blender" }));
    vi.stubGlobal("fetch", harness.fetch);
    process.env.STUDIO_MANAGEMENT_URL = "http://127.0.0.1:1";
    process.env.STUDIO_MANAGEMENT_CREDENTIAL = "token-1";
    try {
      const result = await connectionTool("add_connection").run("cnv_1", {
        id: "blender",
        title: "Blender",
        description: "Three-dee control.",
        kind: "address",
        url: "https://blender.example/mcp",
        // No auth: the secret implies bearer, which is the fix the review
        // asked for - the default-with-secret case is the one that broke.
        secret: "s3kr3t",
      });
      answer = textOf(result);
    } finally {
      vi.unstubAllGlobals();
      delete process.env.STUDIO_MANAGEMENT_URL;
      delete process.env.STUDIO_MANAGEMENT_CREDENTIAL;
    }

    expect(harness.calls.map(callsOf)).toEqual([
      "POST /api/mcp/servers",
      "PUT /api/mcp/servers/blender/credential",
      "PUT /api/mcp/extensions/mcp/blender",
    ]);
    const record = harness.calls[0]?.body as Record<string, unknown>;
    expect(record["transport"]).toBe("http");
    expect(record["provenance"]).toBe("user");
    // Implied, because a secret was given and the credential route refuses
    // an auth-less record: nobody had to say "bearer" for this to work.
    expect(record["auth"]).toBe("bearer");
    expect(record["secret"]).toBeUndefined();
    expect(harness.calls[1]?.body).toEqual({ secret: "s3kr3t" });
    expect(harness.calls[2]?.body).toEqual({ enabled: true });
    expect(answer).toContain("Installed Blender as blender");
    expect(answer).toContain("Its address: https://blender.example/mcp");
    expect(answer).toContain("Its secret: saved to this machine's credential store");
    expect(answer).toContain("Switched on for every conversation, as the user's default");
    expect(answer).toContain("connection_status blender");
  });

  it("installs a command connection, and tells the model to resolve its path first", async () => {
    const answer = await answered(
      () => json({ id: "tagsn.clipboard" }),
      "cnv_1",
      {
        id: "tagsn.clipboard",
        title: "Clipboard",
        description: "Reads this machine's clipboard.",
        kind: "command",
        command: "C:/tools/clipboard.js",
      },
    );
    expect(answer).toContain("Its program: C:/tools/clipboard.js");

    // The absolute-path rule is the service's to enforce (it refuses a bare
    // name at save time); what the tool owes the model is the instruction,
    // which is what its schema says.
    const schema = JSON.stringify(connectionTool("add_connection").definition.inputSchema);
    expect(schema).toContain("ABSOLUTE");
    expect(schema).toContain("resolve it with your shell first");
  });

  it("answers the refusal with which step failed and the harness's own words", async () => {
    await expect(
      answered(
        () => json({ error: 'MCP server "ghost" is not installed.' }, 400),
        "cnv_1",
        { id: "ghost" },
        "connection_status",
      ),
    ).rejects.toThrow(/reading the connection: MCP server "ghost" is not installed\./);
  });

  it("lists connections, saying what each is and how its switch resolves here", async () => {
    const answer = await answered(
      () =>
        json([
          {
            id: "blender",
            title: "Blender",
            description: "Three-dee control.",
            provenance: "user",
            transport: "stdio",
            args: [],
            command: "C:/tools/relays/blender.js",
            needsNetwork: true,
            enabledByDefault: false,
            status: { state: "ready", attempts: 0, diagnostics: [] },
            conversation: { decision: null, resolved: true, decidedAt: "global" },
          },
          {
            id: "sleepy",
            title: "Sleepy",
            description: "",
            provenance: "user",
            transport: "http",
            url: "https://sleepy.example",
            args: [],
            needsNetwork: false,
            enabledByDefault: true,
            status: { state: "failed", attempts: 3, lastError: "the door was shut", diagnostics: [] },
            conversation: { decision: false, resolved: false, decidedAt: "conversation" },
          },
        ]),
      "cnv_1",
      {},
      "list_connections",
    );

    expect(answer).toContain(
      "blender  Blender  blender.js  running; inherits: on here, by the user's default.",
    );
    expect(answer).toContain(
      "sleepy  Sleepy  https://sleepy.example  failed: the door was shut; off here, by this conversation's own decision.",
    );
    expect(answer).toContain("connection_status names one's whole story");
  });

  it("says when there is nothing installed yet, and what would start one", async () => {
    const answer = await answered(() => json([]), "cnv_1", {}, "list_connections");
    expect(answer).toContain("This installation has no MCP connections.");
    expect(answer).toContain("add_connection starts one");
  });

  it("tells one connection's whole story: what it runs, why it failed, what it printed", async () => {
    const answer = await answered(
      () =>
        json({
          id: "sleepy",
          title: "Sleepy",
          description: "A slow one.",
          provenance: "user",
          transport: "http",
          url: "https://sleepy.example",
          args: [],
          auth: "bearer",
          needsNetwork: true,
          enabledByDefault: true,
          status: {
            state: "given-up",
            attempts: 2,
            lastError: "the door was shut",
            diagnostics: ["a", "b", "c", "d"],
          },
          conversation: { decision: null, resolved: false, decidedAt: "global" },
        }),
      "cnv_1",
      { id: "sleepy" },
      "connection_status",
    );

    expect(answer).toContain("Sleepy (sleepy) - gave up: the door was shut.");
    expect(answer).toContain("https://sleepy.example, bearer authentication");
    expect(answer).toContain("Purpose: A slow one.");
    expect(answer).toContain("Failed starts: 2. Last reason: the door was shut.");
    expect(answer).toContain("  c");
    expect(answer).toContain("  d");
    expect(answer).not.toContain("  a\n");
  });

  it("answers a switch with what now applies, and inherit gives the decision back", async () => {
    const answer = await answered(
      (call) =>
        callsOf(call).includes("/status")
          ? json({
              id: "blender",
              title: "Blender",
              description: "",
              provenance: "user",
              transport: "http",
              url: "https://blender.example/mcp",
              args: [],
              needsNetwork: true,
              enabledByDefault: true,
              status: undefined,
              conversation: { decision: null, resolved: false, decidedAt: "global" },
            })
          : json({}),
      "cnv_1",
      { id: "blender", state: "inherit", scope: "everywhere" },
      "set_connection",
    );

    expect(answer).toContain(
      "blender: inherit at every conversation, as the user's default. it now reads off here, by the user's default.",
    );
    expect(answer).toContain("Inherit is not the same as off");

    await expect(
      answered(
        () => json({}),
        "cnv_1",
        { id: "x", state: "on", scope: "project" },
        "set_connection",
      ),
    ).rejects.toThrow(/needs the project's id/);
  });

  it("restarts, and says how to learn whether it came back", async () => {
    const harness = recordingFetch(() =>
      json({ id: "blender", title: "Blender", status: { state: "starting", attempts: 0, diagnostics: [] } }),
    );
    vi.stubGlobal("fetch", harness.fetch);
    process.env.STUDIO_MANAGEMENT_URL = "http://127.0.0.1:1";
    process.env.STUDIO_MANAGEMENT_CREDENTIAL = "token-1";
    try {
      const result = await connectionTool("restart_connection").run("cnv_1", { id: "blender" });
      const answer = textOf(result);
      expect(harness.calls.map(callsOf)).toEqual(["POST /api/mcp/servers/blender/restart"]);
      expect(answer).toContain("stopped and told to come back");
      expect(answer).toContain("connection_status blender shows when it is ready");
    } finally {
      vi.unstubAllGlobals();
      delete process.env.STUDIO_MANAGEMENT_URL;
      delete process.env.STUDIO_MANAGEMENT_CREDENTIAL;
    }
  });

  it("removes everything, and sweeps the download", async () => {
    const home = mkdtempSync(join(tmpdir(), "studio-connections-"));
    const previousHome = process.env.PROJECT_STUDIO_HOME;
    process.env.PROJECT_STUDIO_HOME = home;
    const downloaded = connectionDirectory("blender");
    mkdirSync(downloaded, { recursive: true });

    try {
      const harness = recordingFetch(() => new Response(null, { status: 204 }));
      vi.stubGlobal("fetch", harness.fetch);
      process.env.STUDIO_MANAGEMENT_URL = "http://127.0.0.1:1";
      process.env.STUDIO_MANAGEMENT_CREDENTIAL = "token-1";
      try {
        const result = await connectionTool("remove_connection").run("cnv_1", { id: "blender" });
        const answer = textOf(result);
        expect(harness.calls.map(callsOf)).toEqual(["DELETE /api/mcp/servers/blender"]);
        expect(answer).toContain("Removed blender");
        expect(answer).toContain("Its downloaded copy, if it was installed from a package, went with it");
        expect(existsSync(downloaded)).toBe(false);
      } finally {
        vi.unstubAllGlobals();
        delete process.env.STUDIO_MANAGEMENT_URL;
        delete process.env.STUDIO_MANAGEMENT_CREDENTIAL;
      }
    } finally {
      if (previousHome === undefined) delete process.env.PROJECT_STUDIO_HOME;
      else process.env.PROJECT_STUDIO_HOME = previousHome;
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("says when this process was launched without the harness behind it", async () => {
    const recorded = recordingFetch(() => json({}));
    vi.stubGlobal("fetch", recorded.fetch);
    try {
      await expect(
        connectionTool("list_connections").run("cnv_1", {}),
      ).rejects.toThrow(/without the harness's management endpoint/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

/**
 * The package installer, against a recording stand-in for npm and real
 * fixture files - the derivation is the code; the download itself is npm's.
 */
describe("installing a connection by package", () => {
  let home: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "studio-packages-"));
    previousHome = process.env.PROJECT_STUDIO_HOME;
    process.env.PROJECT_STUDIO_HOME = home;
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.PROJECT_STUDIO_HOME;
    else process.env.PROJECT_STUDIO_HOME = previousHome;
    previousHome = undefined;
    rmSync(home, { recursive: true, force: true });
  });

  function fixture(id: string, packageName: string, manifest: Record<string, unknown>): void {
    const packageDirectory = join(
      connectionDirectory(id),
      "node_modules",
      ...packageName.split("/"),
    );
    mkdirSync(packageDirectory, { recursive: true });
    rmSync(join(packageDirectory, "package.json"), { force: true });
    rmSync(home, { recursive: true, force: true });
    mkdirSync(join(connectionDirectory(id), "node_modules", ...packageName.split("/")), {
      recursive: true,
    });
    writeFileSync(
      join(connectionDirectory(id), "node_modules", ...packageName.split("/"), "package.json"),
      JSON.stringify(manifest),
    );
    if (typeof manifest["bin"] === "string") {
      writeFileSync(join(packageDirectory, manifest["bin"]), "entry");
    }
    if (manifest["bin"] !== undefined && typeof manifest["bin"] === "object") {
      for (const relative of Object.values(manifest["bin"] as Record<string, string>)) {
        writeFileSync(join(packageDirectory, relative), "entry");
      }
    }
  }

  it("launches a single-string bin by the harness's own node", () => {
    fixture("c1", "leftpad", { bin: "launch.js" });
    const launches: string[][] = [];
    const outcome = installPackage("leftpad", "c1", process.execPath, (_command, args) => {
      launches.push([...args]);
      return { status: 0, stderr: "" };
    });

    expect(outcome).toEqual({
      command: process.execPath,
      args: [join(connectionDirectory("c1"), "node_modules", "leftpad", "launch.js")],
    });
    expect(launches[0]).toContain("--prefix");
    expect(launches[0]).toContain(connectionDirectory("c1"));
    expect(launches[0]).toContain("leftpad");
  });

  it("launches a one-command bin map, and refuses to guess between several", () => {
    fixture("c2", "onepunch", { bin: { serve: "m.js" } });
    expect(installPackage("onepunch", "c2", process.execPath, () => ({ status: 0, stderr: "" })).args[0]).toBe(
      join(connectionDirectory("c2"), "node_modules", "onepunch", "m.js"),
    );

    fixture("c3", "twopunch", { bin: { alpha: "a.js", beta: "b.js" } });
    expect(() =>
      installPackage("twopunch", "c3", process.execPath, () => ({ status: 0, stderr: "" })),
    ).toThrow(/carries several commands \(alpha, beta\)/);
  });

  it("refuses a package with no binary, and tells the truth about a broken download", () => {
    fixture("c4", "flatpack", {});
    expect(() =>
      installPackage("flatpack", "c4", process.execPath, () => ({ status: 0, stderr: "" })),
    ).toThrow(/has no "bin" in its package\.json/);

    const packageDirectory = join(connectionDirectory("c5"), "node_modules", "crunchy");
    mkdirSync(packageDirectory, { recursive: true });
    writeFileSync(join(packageDirectory, "package.json"), "{not json");
    expect(() =>
      installPackage("crunchy", "c5", process.execPath, () => ({ status: 0, stderr: "" })),
    ).toThrow(/package\.json could not be read/);
  });

  it("answers with npm's own words when the download fails", () => {
    expect(() =>
      installPackage("leftpad", "c6", process.execPath, () => ({ status: 1, stderr: "boom\n" })),
    ).toThrow(/Downloading leftpad failed: boom/);
    expect(() =>
      installPackage("leftpad", "c7", process.execPath, () => ({
        status: 1,
        stderr: "",
        error: new Error("npm never started"),
      })),
    ).toThrow(/npm never started/);
  });

  it("knows when this installation carries no npm, and says what to do instead", () => {
    const nowhere = join(home, "nowhere", "node.exe");
    expect(bundledNpmCli(process.execPath)).toBeDefined();
    expect(bundledNpmCli(nowhere)).toBeUndefined();
    expect(() =>
      installPackage("leftpad", "c8", nowhere, () => ({ status: 0, stderr: "" })),
    ).toThrow(/carries no npm/);
  });
});

/** The third built-in, registered like the other two: an ordinary row, on by the user's default. */
describe("the customization server, as an installed capability", () => {
  it("registers as a system row, switched on at the global scope, idempotently", () => {
    const db: StudioDatabase = openDatabase({ path: ":memory:" });
    try {
      const registry = new McpServerRegistry(db);
      const selection = new ExtensionSelectionStore(db);

      registerBuiltInServers(registry, selection);
      const record = customizationServerPath() === undefined ? undefined : registry.get(CUSTOMIZATION_SERVER_ID);
      if (customizationServerPath() === undefined) {
        expect(record).toBeUndefined();
        return;
      }

      expect(record?.provenance).toBe("system");
      expect(record?.command).toBe(process.execPath);
      expect(record?.args[0]).toBe(customizationServerPath());
      expect(
        selection.decisionAt({
          kind: "mcp",
          extensionId: CUSTOMIZATION_SERVER_ID,
          scope: GLOBAL_SCOPE,
        }),
      ).toBe(true);

      registerBuiltInServers(registry, selection);
      expect(registry.get(CUSTOMIZATION_SERVER_ID)).toEqual(record);
    } finally {
      db.close();
    }
  });

  it("brackets a scoped-IPv6 hostname, which the URL parser otherwise rejects", () => {
    expect(
      managementChildEnv({
        PROJECT_STUDIO_ADMISSION_CREDENTIAL: "c",
        PROJECT_STUDIO_BOUND_PORT: "1",
        PROJECT_STUDIO_HARNESS_HOSTNAME: "::1",
      }).STUDIO_MANAGEMENT_URL,
    ).toBe("http://[::1]:1");
  });
});
