import { describe, expect, it } from "vitest";

import {
  capabilityInventoryBlock,
  type CapabilityInventoryEntry,
} from "../../src/context/capability-inventory.js";
import type { McpTool } from "../../src/extend/mcp/capabilities.js";
import type { McpServerRecord } from "../../src/extend/mcp/registry.js";
import type { Resolution } from "../../src/extend/selection.js";
import { LocalSandbox } from "../../src/sandbox/local-sandbox.js";
import { createSandboxPolicy } from "../../src/sandbox/policy.js";
import {
  createDiscoverTool,
  type DiscoverInput,
  type DiscoverToolRegistration,
} from "../../src/tools/discover/discover.js";
import type { ToolContext } from "../../src/tools/types.js";
import { ToolError } from "../../src/tools/errors.js";

/**
 * What the discovery answers, against a harness that answers nothing.
 *
 * Every answer here is model-facing prose, and prose is cheap to assert
 * against: the question this file pins is what the model is TOLD, because the
 * answers carry the mechanism's promises - that the inventory's wording is
 * honoured, that a switched-off extension is said so rather than said missing,
 * that the definition comes back, and that the tool joins the array from the
 * next step and not this one. That last promise is the trap ADR 0048 §2 warns
 * about: the tool list was built when the turn started, and a model that
 * calls its discovery's tool in the same turn meets "no such tool" unless the
 * answer said so first. Whether the harness actually behaves that way is the
 * integration test's question; here it is the wording's.
 */

const CAMERA_SCHEMA = { type: "object", properties: { text: { type: "string" } } };

function fakeTool(name: string, description: string, inputSchema: Record<string, unknown>): McpTool {
  return {
    descriptor: {
      id: { namespace: "mcp:blender", name },
      title: name,
      description,
      inputSchema,
      effects: ["execute", "network"],
      provenance: { origin: "mcp", sourceId: "blender", author: "third-party" },
      idempotent: false,
    },
    resourceKind: "command",
    parse: (input) => (input ?? {}) as Record<string, unknown>,
    resource: () => undefined,
    execute: async () => ({}),
  };
}

/**
 * The registry row, as the discovery's `server` closure would supply it. Only
 * the id and the description are read; the rest of the record exists because
 * the type says a record has it, and a saved row always does.
 */
function fakeRecord(id: string, description: string, provenance: McpServerRecord["provenance"] = "user"): McpServerRecord {
  return {
    id,
    title: id,
    description,
    provenance,
    transport: "stdio",
    command: process.platform === "win32" ? "C:/tools/program.exe" : "/tools/program",
    args: [],
    env: {},
    auth: "none",
    needsNetwork: true,
  };
}

interface FakeExtension {
  readonly id: string;
  readonly description: string;
  readonly resolution: Resolution;
  readonly tools: readonly McpTool[];
  readonly provenance?: McpServerRecord["provenance"];
}

/** A capability Studio wrote, as the browser and the computer are registered. */
function studioComputer(): FakeExtension {
  const tool = fakeTool("studio_computer_screenshot", "See what is on a display.", { type: "object", properties: {} });
  return {
    id: "studio-computer",
    description: "Uses this computer's screen, mouse and keyboard.",
    resolution: { enabled: true },
    provenance: "system",
    tools: [
      {
        ...tool,
        descriptor: {
          ...tool.descriptor,
          id: { namespace: "mcp:studio-computer", name: "studio_computer_screenshot" },
          provenance: { origin: "mcp", sourceId: "studio-computer", author: "studio" },
        },
      },
    ],
  };
}

function blender(overrides: Partial<FakeExtension> = {}): FakeExtension {
  return {
    id: "blender",
    description: "Blender scene and object manipulation.",
    resolution: { enabled: true },
    tools: [
      fakeTool("add_camera", "Add a camera to the scene.", CAMERA_SCHEMA),
      fakeTool("add_light", "Add a light to the scene.", { type: "object", properties: {} }),
    ],
    ...overrides,
  };
}

const INVENTORY_ENTRIES: readonly CapabilityInventoryEntry[] = [
  {
    id: "mcp:blender",
    description: "Blender scene and object manipulation.",
    toolNames: ["add_camera", "add_light"],
  },
];

/**
 * A discovery standing in front of a harness made of plain records. `adopted`
 * collects what the tool promised to the registration - which is everything
 * the registration could act on, since the adoption is the tool's whole side
 * effect at this layer.
 */
function world(extensions: readonly FakeExtension[], entries: readonly CapabilityInventoryEntry[]) {
  const adopted: McpTool[] = [];
  const byId = new Map(extensions.map((extension) => [extension.id, extension] as const));
  const registration: DiscoverToolRegistration = {
    entries: () => entries,
    server: (serverId) => {
      const extension = byId.get(serverId);
      return extension === undefined
        ? undefined
        : {
            record: fakeRecord(extension.id, extension.description, extension.provenance),
            resolution: extension.resolution,
          };
    },
    tools: (serverId) => byId.get(serverId)?.tools ?? [],
    adopt: (tool) => {
      adopted.push(tool);
    },
  };
  return { adopted, discover: createDiscoverTool(registration) };
}

/**
 * The execution context, which the discovery never reads - it answers from the
 * registration alone - but the definition's signature demands. A real sandbox
 * over the process's own directory, because constructing one is cheaper than
 * arguing about what a tool may assume its caller withheld.
 */
const CONTEXT: ToolContext = {
  scope: { agentId: "studio", conversationId: "conversation", projectId: "project" },
  sandbox: new LocalSandbox(createSandboxPolicy({ workspaceRoot: process.cwd() })),
  signal: undefined,
};

/** The one way every answer here is asked for: the raw definition, its inputs. */
function answered(
  discover: ReturnType<typeof createDiscoverTool>,
  input: DiscoverInput,
): Promise<string> {
  return discover.execute(input, CONTEXT);
}

describe("the discovery's answers", () => {
  it("answers the scope-less question with the inventory's own block", async () => {
    // Not a rendering of the same facts - the same function, therefore the
    // same bytes. The question an inventory scrolled out of a conversation
    // asks is the one the inventory answers, and a second prose here would be
    // a second thing to keep honest.
    const { discover } = world([blender()], INVENTORY_ENTRIES);
    const answer = await answered(discover, { scope: undefined });

    expect(answer).toBe(capabilityInventoryBlock(INVENTORY_ENTRIES));
  });

  it("answers the scope-less question with a sentence when nothing is switched on", async () => {
    // The system block's rule - the empty answer is the empty string - is a
    // rule about the cached prefix, not about tool results. A discovery that
    // answered nothing here would leave the model to guess why.
    const { discover } = world([], []);
    const answer = await answered(discover, { scope: undefined });

    expect(answer).toContain("No extensions are switched on for this conversation");
  });

  it("lists an extension's tools in the extension's own words, and registers nothing", async () => {
    const { discover, adopted } = world([blender()], INVENTORY_ENTRIES);
    const answer = await answered(discover, { scope: "mcp:blender" });

    expect(answer).toContain("mcp:blender - 2 tools.");
    expect(answer).toContain("add_camera - Add a camera to the scene.");
    // The remedy that makes the next question unneeded: the joined id, shown
    // in the spelling the discovery expects back.
    expect(answer).toContain("mcp:blender/add_camera");
    // Whose words these are, said before any of them appear - the same
    // ordering rule the inventory keeps.
    expect(answer.indexOf("extension's own words")).toBeLessThan(
      answer.indexOf("Blender scene and object manipulation."),
    );
    expect(adopted).toEqual([]);
  });

  it("describes a capability Studio wrote in Studio's voice, with no third-party framing", async () => {
    // ADR 0055: the browser and the computer are Studio's own. Telling the
    // model to distrust their descriptions would be telling it to distrust
    // the harness, so the note is for a third party's words alone.
    const { discover } = world([studioComputer()], [
      { id: "mcp:studio-computer", description: "Uses this computer's screen, mouse and keyboard.", toolNames: ["studio_computer_screenshot"], builtIn: true },
    ]);
    const listing = await answered(discover, { scope: "mcp:studio-computer" });
    expect(listing).toContain("Built into Studio.");
    expect(listing).not.toContain("extension's own words");

    const definition = await answered(discover, { scope: "mcp:studio-computer/studio_computer_screenshot" });
    expect(definition).toContain("mcp:studio-computer/studio_computer_screenshot");
    expect(definition).not.toContain("extension's own words");
  });

  it("returns one tool's definition, and adopts exactly the tool it promised", async () => {
    const { discover, adopted } = world([blender()], INVENTORY_ENTRIES);
    const answer = await answered(discover, { scope: "mcp:blender/add_camera" });

    expect(answer).toContain("mcp:blender/add_camera");
    expect(answer).toContain(JSON.stringify(CAMERA_SCHEMA));
    // The promise, stated where the model reads it. The integration test
    // proves the harness keeps it; this test proves it is made, and made
    // accurately: the tool arrives on the next STEP, so the answer must not
    // tell the model to wait for the person. An earlier wording said the tool
    // "cannot be called in this turn", which would have cost a round trip on
    // every discovery for a boundary that is not there.
    expect(answer).toContain("next step");
    expect(answer).toContain("do not have to wait for the person");
    expect(answer).not.toContain("cannot be called in this turn");
    expect(adopted).toHaveLength(1);
    expect(adopted[0]?.descriptor.id.name).toBe("add_camera");
  });

  it("says where the switch is for a switched-off extension, without pretending it is missing", async () => {
    // Never "no such extension": the person can see this extension in their
    // settings, so the only useful answer names the decision that turned it
    // off - which is also where the model would tell the person to look.
    // Each scope the resolution can name, plus the no-opinion default.
    const cases: readonly [Resolution, string][] = [
      [{ enabled: false, decidedAt: "project" }, "this project's extension setting"],
      [{ enabled: false, decidedAt: "global" }, "the global extension setting"],
      [{ enabled: false, decidedAt: "conversation" }, "this conversation's extension setting"],
      [{ enabled: false }, "no saved setting turns it on"],
    ];

    for (const [resolution, remedy] of cases) {
      const { discover, adopted } = world([blender({ resolution })], INVENTORY_ENTRIES);
      const answer = await answered(discover, { scope: "mcp:blender/add_camera" });

      expect(answer).toContain("installed, but switched off for this conversation");
      expect(answer).toContain(remedy);
      // Nothing was reached, so nothing was loaded - the enablement test, at
      // the answer's own level.
      expect(answer).not.toContain("Add a camera to the scene.");
      expect(answer).not.toContain(JSON.stringify(CAMERA_SCHEMA));
      expect(adopted).toEqual([]);
    }
  });

  it("says an extension it does not know, and names the ones it does", async () => {
    const { discover } = world([blender()], INVENTORY_ENTRIES);
    const answer = await answered(discover, { scope: "mcp:ghost" });

    expect(answer).toContain("No extension mcp:ghost is installed");
    // The remedy: what this conversation actually has, because that is what a
    // plausible mistype would have meant.
    expect(answer).toContain("mcp:blender");

    const bare = world([], []);
    const none = await answered(bare.discover, { scope: "mcp:ghost" });
    expect(none).toContain("no other extension switched on either");
  });

  it("answers a wrong tool name with the ones that exist", async () => {
    const { discover, adopted } = world([blender()], INVENTORY_ENTRIES);
    const answer = await answered(discover, { scope: "mcp:blender/add_camra" });

    expect(answer).toContain('no tool named "add_camra"');
    expect(answer).toContain("add_camera, add_light");
    expect(adopted).toEqual([]);
  });

  it("loads several tools of one extension in one call", async () => {
    // The bulk form exists because a model that knows its pipeline needs
    // three tools should pay one round trip, not three - and should not stall
    // half way through a task to fetch the next schema. It stays explicit:
    // every tool loaded was named, and there is no wildcard.
    const { discover, adopted } = world([blender()], INVENTORY_ENTRIES);
    const answer = await answered(discover, { scope: "mcp:blender/add_camera,add_light" });

    expect(answer).toContain("2 tools");
    expect(answer).toContain("mcp:blender/add_camera");
    expect(answer).toContain("mcp:blender/add_light");
    expect(answer).toContain(JSON.stringify(CAMERA_SCHEMA));
    expect(answer).toContain("next step");
    expect(adopted.map((tool) => tool.descriptor.id.name)).toEqual(["add_camera", "add_light"]);
  });

  it("loads nothing at all when one of several names is wrong", async () => {
    // All or nothing, deliberately. A partial load would leave the model
    // believing it holds a tool it does not, which is the belief the whole
    // mechanism exists to prevent; one corrected call is the cheaper failure.
    const { discover, adopted } = world([blender()], INVENTORY_ENTRIES);
    const answer = await answered(discover, { scope: "mcp:blender/add_camera,add_lite" });

    expect(answer).toContain('no tool named "add_lite"');
    expect(answer).toContain("Nothing was loaded");
    expect(adopted).toEqual([]);
  });

  it("refuses a call that names more tools than it will load", async () => {
    const { discover, adopted } = world([blender()], INVENTORY_ENTRIES);
    const many = Array.from({ length: 9 }, (_, index) => `t${index}`).join(",");

    await expect(answered(discover, { scope: `mcp:blender/${many}` })).rejects.toThrow(ToolError);
    expect(adopted).toEqual([]);
  });

  it("refuses a scope that names an extension and then no tool", async () => {
    // "mcp:blender/" is a shape a model can produce, and the empty name is
    // dropped rather than guessed at, so this would otherwise reach the
    // answer with nothing to describe.
    const { discover, adopted } = world([blender()], INVENTORY_ENTRIES);

    await expect(answered(discover, { scope: "mcp:blender/" })).rejects.toThrow(ToolError);
    expect(adopted).toEqual([]);
  });

  it("says honestly when a switched-on extension has answered no tools yet", async () => {
    // A server that has not come back from tools/list still gets its line -
    // the inventory's own reasoning, that silence about an enabled extension
    // reads as the setting doing nothing.
    const { discover, adopted } = world([blender({ tools: [] })], INVENTORY_ENTRIES);
    const answer = await answered(discover, { scope: "mcp:blender" });

    expect(answer).toContain("mcp:blender - 0 tools.");
    expect(answer).toContain("has not answered");
    expect(adopted).toEqual([]);
  });

  it("refuses a scope that is not a discovery scope, and says what would have been", async () => {
    // A bare extension name, or a native id: neither is one of the two shapes
    // the inventory puts in front of the model. The native case needs its own
    // sentence, because the schema the model is asking for is already in its
    // array, and the refusal is what tells it so.
    const { discover } = world([blender()], INVENTORY_ENTRIES);

    await expect(answered(discover, { scope: "blender" })).rejects.toMatchObject({
      kind: "invalid_input",
      message: expect.stringContaining("mcp:blender/add_camera"),
    });
    await expect(answered(discover, { scope: "native/read" })).rejects.toMatchObject({
      kind: "invalid_input",
      message: expect.stringContaining("Native tools are not discovered"),
    });
    // The empty string is an argument, not the absence of one, and the
    // distinction is the difference between "list them" and a mistake.
    await expect(answered(discover, { scope: "" })).rejects.toBeInstanceOf(ToolError);
  });
});
