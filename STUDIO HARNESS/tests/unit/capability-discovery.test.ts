import { afterEach, describe, expect, it } from "vitest";

import type { CapabilityInventoryEntry } from "../../src/context/capability-inventory.js";
import type { McpTool } from "../../src/extend/mcp/capabilities.js";
import type { McpServerRecord } from "../../src/extend/mcp/registry.js";
import type { Resolution } from "../../src/extend/selection.js";
import { createRootExecutionContext, runWithExecutionContext } from "../../src/execution/context.js";
import { diagnosticRecorder } from "../../src/observability/recorder.js";
import { LocalSandbox } from "../../src/sandbox/local-sandbox.js";
import { createSandboxPolicy } from "../../src/sandbox/policy.js";
import { createDiscoverTool, type DiscoverToolRegistration } from "../../src/tools/discover/discover.js";
import { ToolError } from "../../src/tools/errors.js";
import type { ToolContext } from "../../src/tools/types.js";
import { TOOLS as browserTools } from "../../src/browser/tools.js";
import { TOOLS as computerTools } from "../../src/computer/tools.js";

const CAMERA_SCHEMA = { type: "object", properties: { text: { type: "string" } } };

function fakeTool(name: string, description = "Add a camera.", inputSchema: unknown = CAMERA_SCHEMA, server = "blender"): McpTool {
  return {
    descriptor: {
      id: { namespace: `mcp:${server}`, name }, title: name, description, inputSchema,
      effects: ["execute", "network"],
      provenance: { origin: "mcp", sourceId: server, author: "third-party" }, idempotent: false,
    },
    resourceKind: "command", parse: (input) => ({ input }), resource: () => undefined,
    execute: async () => ({}),
  };
}

interface FakeExtension {
  readonly id: string;
  readonly resolution: Resolution;
  readonly tools: readonly McpTool[];
  readonly provenance?: McpServerRecord["provenance"];
}

function blender(overrides: Partial<FakeExtension> = {}): FakeExtension {
  return { id: "blender", resolution: { enabled: true }, tools: [fakeTool("add_camera"), fakeTool("add_light", "Add a light.")], ...overrides };
}

function manyTools(count: number): readonly McpTool[] {
  return Array.from({ length: count }, (_, index) => fakeTool(`t${String(index).padStart(3, "0")}`));
}

function world(extensions: readonly FakeExtension[] = [blender()]) {
  const adopted: McpTool[] = [];
  const loaded = new Map<string, McpTool>();
  const entries: readonly CapabilityInventoryEntry[] = extensions.filter((item) => item.resolution.enabled).map((item) => ({
    id: `mcp:${item.id}`, description: "Scene tools.", toolNames: item.tools.map((tool) => tool.descriptor.id.name), builtIn: item.provenance === "system",
  }));
  const registration: DiscoverToolRegistration = {
    entries: () => entries,
    server: (serverId) => {
      const extension = extensions.find((item) => item.id === serverId);
      if (extension === undefined) return undefined;
      return {
        record: {
          id: serverId, title: serverId, description: "Scene tools.", provenance: extension.provenance ?? "user",
          transport: "stdio", command: "/tools/program", args: [], env: {}, auth: "none", needsNetwork: true,
        },
        resolution: extension.resolution,
      };
    },
    tools: (serverId) => extensions.find((item) => item.id === serverId)?.tools ?? [],
    loaded: () => [...loaded.values()],
    adopt: (tool) => { adopted.push(tool); loaded.set(`${tool.descriptor.id.namespace}/${tool.descriptor.id.name}`, tool); },
  };
  const discover = createDiscoverTool(registration);
  return { adopted, loaded, discover };
}

const CONTEXT: ToolContext = {
  scope: { agentId: "studio", conversationId: "conversation", projectId: "project" },
  sandbox: new LocalSandbox(createSandboxPolicy({ workspaceRoot: process.cwd() })), signal: undefined,
};

async function answered(discover: ReturnType<typeof createDiscoverTool>, input: unknown, context = CONTEXT): Promise<string> {
  return discover.execute(discover.parse(input), context);
}

function nextCursor(answer: string): string {
  const cursor = /Next cursor: ([A-Za-z0-9_-]+)/.exec(answer)?.[1];
  if (cursor === undefined) throw new Error("The result has no next cursor.");
  return cursor;
}

afterEach(() => {
  diagnosticRecorder.configure({ enabled: false, captureContent: false, conversations: [] });
  diagnosticRecorder.clear();
});

describe("browsing MCP tools", () => {
  it("lists enabled servers without loading their tools, including an empty inventory", async () => {
    const { discover, adopted } = world();
    expect(await answered(discover, {})).toContain("mcp:blender");
    expect(await answered(discover, undefined)).toContain("mcp:blender");
    expect(adopted).toEqual([]);
    expect(await answered(world([]).discover, {})).toContain("No MCP servers are switched on");
  });

  it("defaults to eight summaries and pages through the remaining names without schemas", async () => {
    const { discover, adopted } = world([blender({ tools: manyTools(20) })]);
    const first = await answered(discover, { server: "mcp:blender" });
    expect(first).toContain("Showing 8 of 20");
    expect(first).toContain("t007");
    expect(first).not.toContain("t008");
    expect(first).not.toContain(JSON.stringify(CAMERA_SCHEMA));
    const second = await answered(discover, { server: "mcp:blender", cursor: nextCursor(first) });
    expect(second).toContain("t008");
    expect(second).not.toContain("t007");
    const third = await answered(discover, { server: "mcp:blender", cursor: nextCursor(second) });
    expect(third).toContain("t019");
    expect(third).not.toContain("Next cursor:");
    expect(adopted).toEqual([]);
  });

  it("accepts a larger browse limit and searches names and descriptions", async () => {
    const { discover } = world([blender({ tools: [...manyTools(60), fakeTool("camera", "Creates a PORTRAIT.")] })]);
    expect(await answered(discover, { server: "mcp:blender", limit: 50 })).toContain("Showing 50 of 61");
    const result = await answered(discover, { server: "mcp:blender", query: "portrait" });
    expect(result).toContain("camera");
    expect(result).not.toContain("t000");
    expect(await answered(discover, { server: "mcp:blender", query: "t059" })).toContain("t059");
    expect(await answered(discover, { server: "mcp:blender", query: "missing" })).toContain("Showing 0 of 0");
  });

  it("sorts catalog names and rejects cursors from another search or changed catalog", async () => {
    const tools = [...manyTools(12)].reverse();
    const { discover } = world([blender({ tools })]);
    const first = await answered(discover, { server: "mcp:blender" });
    expect(first.indexOf("t000")).toBeLessThan(first.indexOf("t001"));
    await expect(answered(discover, { server: "mcp:blender", query: "other", cursor: nextCursor(first) })).rejects.toThrow(ToolError);
    tools.push(fakeTool("new_tool"));
    await expect(answered(discover, { server: "mcp:blender", cursor: nextCursor(first) })).rejects.toThrow(ToolError);
  });

  it("keeps third-party framing before descriptions and identifies native MCP", async () => {
    const thirdParty = await answered(world().discover, { server: "mcp:blender" });
    expect(thirdParty.indexOf("extension's own words")).toBeLessThan(thirdParty.indexOf("Add a camera."));
    const native = await answered(world([blender({ provenance: "system" })]).discover, { server: "mcp:blender" });
    expect(native).toContain("Native MCP");
    expect(native).not.toContain("extension's own words");
    const nativeServers = await answered(world([blender({ provenance: "system" })]).discover, {});
    expect(nativeServers).toContain("shipped by Studio");
    expect(nativeServers).not.toContain("claims");
  });

  it("bounds descriptions and reports a server with no known tools honestly", async () => {
    const result = await answered(world([blender({ tools: [fakeTool("camera", "x".repeat(20_000))] })]).discover, { server: "mcp:blender" });
    expect(result.length).toBeLessThan(2000);
    expect(result).toContain("...");
    expect(await answered(world([blender({ tools: [] })]).discover, { server: "mcp:blender" })).toContain("0 tools");
  });
});

describe("loading and inspecting MCP tools", () => {
  it("loads exactly fifty selected tools from a hundred, in one call", async () => {
    const tools = manyTools(100);
    const { discover, adopted } = world([blender({ tools })]);
    const names = tools.filter((_, index) => index % 2 === 0).map((tool) => tool.descriptor.id.name);
    const result = await answered(discover, { action: "load", server: "mcp:blender", tools: names });
    expect(adopted.map((tool) => tool.descriptor.id.name)).toEqual(names);
    expect(result).toContain("50 tools");
    expect(result).toContain("next step");
    expect(result).not.toContain(JSON.stringify(CAMERA_SCHEMA));
    expect(result).not.toContain("wait for the person");
  });

  it.each(["user", "system"] as const)("loads all tools on explicit request for %s servers", async (provenance) => {
    const tools = manyTools(100);
    const { discover, adopted } = world([blender({ tools, provenance })]);
    expect(await answered(discover, { action: "load", server: "mcp:blender", tools: "all" })).toContain("100 tools");
    expect(adopted).toEqual(tools);
  });

  it.each([["studio-browser", browserTools], ["studio-computer", computerTools]] as const)("loads the complete shipped %s catalog within the budget", async (server, catalog) => {
    const tools = catalog.map((tool) => fakeTool(tool.name, tool.description, tool.inputSchema, server));
    const { discover, adopted } = world([{ id: server, tools, resolution: { enabled: true }, provenance: "system" }]);
    await answered(discover, { action: "load", server: `mcp:${server}`, tools: "all" });
    expect(adopted).toEqual(tools);
    expect(adopted.length).toBeGreaterThan(8);
  });

  it("deduplicates requested names and keeps previous loads available", async () => {
    const { discover, adopted, loaded } = world();
    await answered(discover, { action: "load", server: "mcp:blender", tools: ["add_camera", "add_camera"] });
    await answered(discover, { action: "load", server: "mcp:blender", tools: ["add_camera", "add_light"] });
    expect(adopted).toHaveLength(2);
    expect(loaded.size).toBe(2);
  });

  it("inspects full definitions without adopting them", async () => {
    const { discover, adopted } = world();
    const result = await answered(discover, { action: "inspect", server: "mcp:blender", tools: ["add_camera"] });
    expect(result).toContain(JSON.stringify(CAMERA_SCHEMA));
    expect(result).toContain("mcp:blender/add_camera");
    expect(result).toContain("No tools were loaded");
    expect(adopted).toEqual([]);
  });

  it("loads nothing when any requested name is wrong", async () => {
    const { discover, adopted } = world();
    await expect(answered(discover, { action: "load", server: "mcp:blender", tools: ["add_camera", "add_lite"] })).rejects.toMatchObject({
      kind: "invalid_input", message: expect.stringContaining("add_lite"),
    });
    expect(adopted).toEqual([]);
  });

  it("refuses oversized definitions before any adoption and bounds inspection results", async () => {
    const tools = [fakeTool("small"), fakeTool("large", "Large.", { description: "x".repeat(600_000) })];
    const { discover, adopted } = world([blender({ tools })]);
    await expect(answered(discover, { action: "load", server: "mcp:blender", tools: "all" })).rejects.toThrow(/budget/);
    await expect(answered(discover, { action: "inspect", server: "mcp:blender", tools: ["large"] })).rejects.toThrow(/result/);
    expect(adopted).toEqual([]);
  });

  it("counts existing definitions across calls and servers against the schema budget", async () => {
    const large = { description: "x".repeat(300_000) };
    const { discover, adopted } = world([
      blender({ tools: [fakeTool("first", "First.", large)] }),
      { id: "second", resolution: { enabled: true }, tools: [fakeTool("second", "Second.", large, "second")] },
    ]);
    await answered(discover, { action: "load", server: "mcp:blender", tools: "all" });
    await expect(answered(discover, { action: "load", server: "mcp:second", tools: "all" })).rejects.toThrow(/budget/);
    expect(adopted).toHaveLength(1);
  });

  it("stops inspecting definitions as soon as the result budget is exceeded", async () => {
    let tailReads = 0;
    const tools = [
      fakeTool("first", "", { description: "x".repeat(40_000) }),
      fakeTool("second", "", { description: "x".repeat(40_000) }),
      fakeTool("tail", "", { get description() { tailReads++; return "tail"; } }),
    ];
    const { discover, adopted } = world([blender({ tools })]);
    await expect(answered(discover, { action: "inspect", server: "mcp:blender", tools: ["first", "second", "tail"] })).rejects.toThrow(/result/);
    expect(tailReads).toBe(0);
    expect(adopted).toEqual([]);
  });

  it("preserves cancellation before adoption", async () => {
    const { discover, adopted } = world();
    const controller = new AbortController();
    const failure = new Error("stopped");
    controller.abort(failure);
    await expect(answered(discover, { action: "load", server: "mcp:blender", tools: "all" }, { ...CONTEXT, signal: controller.signal })).rejects.toBe(failure);
    expect(adopted).toEqual([]);
  });

  it("does not include tools from another server in an all request", async () => {
    const own = fakeTool("own");
    const { discover, adopted } = world([blender({ tools: [own, fakeTool("foreign", "Foreign.", CAMERA_SCHEMA, "other")] })]);
    await answered(discover, { action: "load", server: "mcp:blender", tools: "all" });
    expect(adopted).toEqual([own]);
  });

  it("refuses an oversized confirmation before adoption", async () => {
    const tools = Array.from({ length: 1000 }, (_, index) => fakeTool(`t${String(index).padStart(63, "0")}`, "", {}));
    const { discover, adopted } = world([blender({ tools })]);
    await expect(answered(discover, { action: "load", server: "mcp:blender", tools: "all" })).rejects.toThrow(/result/);
    expect(adopted).toEqual([]);
  });

  it("preserves the original registration error", async () => {
    const failure = new Error("registration failed");
    const tool = fakeTool("camera");
    const discover = createDiscoverTool({
      entries: () => [], server: () => ({
        record: { id: "blender", title: "Blender", description: "", provenance: "system", transport: "stdio", command: "/tools/program", args: [], env: {}, auth: "none", needsNetwork: false },
        resolution: { enabled: true },
      }),
      tools: () => [tool], loaded: () => [], adopt: () => { throw failure; },
    });
    await expect(answered(discover, { action: "load", server: "mcp:blender", tools: "all" })).rejects.toBe(failure);
  });
});

describe("discovery validation and enablement", () => {
  it.each([
    null, [], 1, { action: "unknown" }, { scope: "mcp:blender/add_camera" },
    { action: "load", server: "mcp:blender" }, { action: "load", tools: "all" },
    { action: "load", server: "mcp:blender", tools: [] },
    { action: "load", server: "mcp:blender", tools: [1] },
    { action: "load", server: "mcp:blender", tools: "all", limit: 50 },
    { action: "load", server: "mcp:blender", tools: "all", query: "camera" },
    { action: "inspect", server: "mcp:blender", tools: "all" },
    { tools: ["add_camera"] }, { server: "blender" }, { server: "native/read" },
    { server: "mcp:blender/add_camera" }, { server: "mcp:" },
    { limit: 0 }, { limit: 1.5 }, { limit: 101 }, { query: 1 }, { cursor: 3 }, { unknown: true },
  ].map((input) => [input]))("rejects invalid input without loading tools: %j", async (input) => {
    const { discover, adopted } = world();
    await expect(answered(discover, input)).rejects.toThrow(ToolError);
    expect(adopted).toEqual([]);
  });

  it.each(["list", "load", "inspect"])("does not expose definitions when a server is switched off: %s", async (action) => {
    for (const [resolution, remedy] of [
      [{ enabled: false, decidedAt: "project" }, "this project's extension setting"],
      [{ enabled: false, decidedAt: "global" }, "the global extension setting"],
      [{ enabled: false, decidedAt: "conversation" }, "this conversation's extension setting"],
      [{ enabled: false }, "no saved setting turns it on"],
    ] satisfies readonly [Resolution, string][]) {
      const { discover, adopted } = world([blender({ resolution })]);
      const result = await answered(discover, { action, server: "mcp:blender", ...(action === "list" ? {} : { tools: ["add_camera"] }) });
      expect(result).toContain("installed, but switched off");
      expect(result).toContain(remedy);
      expect(result).not.toContain("Add a camera.");
      expect(result).not.toContain(JSON.stringify(CAMERA_SCHEMA));
      expect(adopted).toEqual([]);
    }
  });

  it("distinguishes missing servers from disabled ones", async () => {
    expect(await answered(world().discover, { server: "mcp:ghost" })).toContain("No MCP server mcp:ghost is installed");
  });

  it("records stages under the existing parent without tool content in attributes", async () => {
    diagnosticRecorder.configure({ enabled: true, captureContent: false });
    const parent = createRootExecutionContext();
    const { discover } = world([blender({ tools: [fakeTool("private_name", "private_description")] })]);
    await runWithExecutionContext(parent, () => answered(discover, { action: "load", server: "mcp:blender", tools: "all" }));
    const events = diagnosticRecorder.read().events;
    expect(events.find((event) => event.name === "discover.load" && event.phase === "start")?.identity.parentOperationId).toBe(parent.operationId);
    expect(JSON.stringify(events)).not.toContain("private_name");
    expect(JSON.stringify(events)).not.toContain("private_description");
    expect(events.every((event) => event.content === undefined)).toBe(true);
  });

  it("records a failed load without leaking the invalid name", async () => {
    diagnosticRecorder.configure({ enabled: true, captureContent: false });
    const parent = createRootExecutionContext();
    await expect(runWithExecutionContext(parent, () => answered(world().discover, {
      action: "load", server: "mcp:blender", tools: ["private_missing_name"],
    }))).rejects.toThrow(ToolError);
    const events = diagnosticRecorder.read().events;
    expect(events.find((event) => event.name === "discover.load" && event.phase === "end")?.outcome).toBe("failed");
    expect(JSON.stringify(events)).not.toContain("private_missing_name");
  });
});
