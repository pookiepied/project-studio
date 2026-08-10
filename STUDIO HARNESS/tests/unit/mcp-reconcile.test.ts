import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ExtendError } from "../../src/extend/errors.js";
import type { McpChannel } from "../../src/extend/mcp/connection.js";
import { LEGACY_PROTOCOL_VERSIONS } from "../../src/extend/mcp/handshake.js";
import { createMcpReconciler } from "../../src/extend/mcp/reconcile.js";
import { McpServerRegistry, type McpServerInput } from "../../src/extend/mcp/registry.js";
import { McpSupervisor } from "../../src/extend/mcp/supervisor.js";
import type { KindReconciler } from "../../src/extend/reconcile.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";

/** A channel that completes a legacy handshake and does nothing else. */
class ScriptedChannel implements McpChannel {
  closed = false;
  #data: ((chunk: string | Uint8Array) => void) | undefined;

  send(line: string): void {
    const message = JSON.parse(line) as { id?: number; method: string };
    if (message.id === undefined) return;

    this.#data?.(
      `${JSON.stringify(
        message.method === "server/discover"
          ? { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Unknown" } }
          : {
              jsonrpc: "2.0",
              id: message.id,
              result: { protocolVersion: LEGACY_PROTOCOL_VERSIONS[0], capabilities: {} },
            },
      )}\n`,
    );
  }

  onData(listener: (chunk: string | Uint8Array) => void): void {
    this.#data = listener;
  }
  onStderr(): void {
    // Nothing writes diagnostics here.
  }
  onClose(): void {
    // Nothing ends on its own here.
  }
  close(): void {
    this.closed = true;
  }
}

function server(id: string, command: string): McpServerInput {
  return {
    id,
    title: id,
    transport: "stdio",
    command,
    args: [],
    env: {},
    auth: "none",
  };
}

const NODE = "C:\\tools\\node.exe";

let db: StudioDatabase;
let registry: McpServerRegistry;
let supervisor: McpSupervisor;
let reconcile: KindReconciler;
let launched: string[];
let channels: Map<string, ScriptedChannel>;

beforeEach(() => {
  db = openDatabase({ path: ":memory:" });
  registry = new McpServerRegistry(db);
  launched = [];
  channels = new Map();
  supervisor = new McpSupervisor({
    launch: {
      // One process per id, which is the arrangement these rules were written
      // against. Telling two projects' launches apart is `C-18` and belongs to
      // the launcher, which has its own tests for it.
      key: (record) => record.id,
      open: async (record) => {
        launched.push(record.id);
        const channel = new ScriptedChannel();
        channels.set(record.id, channel);
        return channel;
      },
    },
    backoff: { random: () => 0 },
  });
  reconcile = createMcpReconciler({ registry, supervisor });
});

afterEach(() => {
  supervisor.stopAll();
  db.close();
});

describe("bringing MCP servers into line with what a project chose", () => {
  it("starts what is switched on", async () => {
    registry.save(server("blender", NODE));

    await reconcile(["blender"]);

    expect(launched).toEqual(["blender"]);
    expect(supervisor.status("blender")?.state).toBe("ready");
  });

  it("stops what is switched off", async () => {
    registry.save(server("blender", NODE));
    await reconcile(["blender"]);

    await reconcile([]);

    expect(supervisor.status("blender")).toBeUndefined();
    expect(channels.get("blender")?.closed).toBe(true);
  });

  it("does nothing at all on a second pass with the same answer", async () => {
    // Idempotent, which is what lets this run at startup, at a turn boundary,
    // on a timer, and after a crash with one implementation.
    registry.save(server("blender", NODE));

    await reconcile(["blender"]);
    await reconcile(["blender"]);

    expect(launched).toEqual(["blender"]);
  });

  it("restarts a server whose command was edited", async () => {
    // Not visible in the desired set — the id is in both lists, so the plan
    // says do nothing and the old process keeps running with the old command.
    registry.save(server("blender", NODE));
    await reconcile(["blender"]);
    const first = channels.get("blender");

    registry.save(server("blender", "C:\\tools\\other.exe"));
    await reconcile(["blender"]);

    expect(launched).toEqual(["blender", "blender"]);
    expect(first?.closed).toBe(true);
    expect(supervisor.status("blender")?.state).toBe("ready");
  });

  it("leaves a server alone when only its title changed", async () => {
    // The user approved a tool, not a label.
    registry.save(server("blender", NODE));
    await reconcile(["blender"]);

    registry.save({ ...server("blender", NODE), title: "Blender 4" });
    await reconcile(["blender"]);

    expect(launched).toEqual(["blender"]);
  });

  it("does not ask again for a server that is being retried", async () => {
    // Asking on every turn boundary would reset the backoff delay to nothing,
    // which turns a growing wait into a tight loop.
    registry.save(server("broken", NODE));
    supervisor = new McpSupervisor({
      launch: {
        key: (record) => record.id,
        open: async () => {
          launched.push("broken");
          throw new ExtendError("internal", { message: "will not start" });
        },
      },
      backoff: { random: () => 0, baseDelayMs: 60_000, maxAttempts: 5 },
    });
    reconcile = createMcpReconciler({ registry, supervisor });

    await reconcile(["broken"]);
    await reconcile(["broken"]);
    await reconcile(["broken"]);

    expect(launched).toEqual(["broken"]);
    expect(supervisor.status("broken")?.state).toBe("failed");
  });

  it("starts the others when one will not start", async () => {
    // One broken server must not switch off every working one.
    registry.save(server("broken", NODE));
    registry.save(server("blender", NODE));
    supervisor = new McpSupervisor({
      launch: {
        key: (record) => record.id,
        open: async (record) => {
          if (record.id === "broken") {
            throw new ExtendError("internal", { message: "will not start" });
          }
          launched.push(record.id);
          return new ScriptedChannel();
        },
      },
      backoff: { random: () => 0, maxAttempts: 0 },
    });
    reconcile = createMcpReconciler({ registry, supervisor });

    await expect(reconcile(["broken", "blender"])).resolves.toBeUndefined();

    expect(launched).toEqual(["blender"]);
    expect(supervisor.status("blender")?.state).toBe("ready");
    expect(supervisor.status("broken")?.state).toBe("given-up");
  });

  it("ignores a selection for a server that is no longer installed", async () => {
    await expect(reconcile(["ghost"])).resolves.toBeUndefined();

    expect(launched).toEqual([]);
    expect(supervisor.status("ghost")).toBeUndefined();
  });
});
