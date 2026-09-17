import { afterEach, describe, expect, it } from "vitest";

import { McpManagementService } from "../../src/application/mcp-management.js";
import type { AuthContext } from "../../src/admission/context.js";
import { McpServerRegistry } from "../../src/extend/mcp/registry.js";
import type { McpSupervisor } from "../../src/extend/mcp/supervisor.js";
import { ExtensionSelectionStore } from "../../src/extend/selection.js";
import { PermissionGrantStore } from "../../src/permissions/grant-store.js";
import { openDatabase } from "../../src/storage/database.js";

/**
 * Restart, the newest verb of the management surface.
 *
 * Its whole design is that it adds nothing: the supervisor's record of how
 * to launch a connection *is* the record, so stopping and asking for what
 * should be running is the entire mechanism. What this pins is the order -
 * the connection stops before the reconciler is woken, or the wake finds it
 * still launching and does the next ten seconds' work twice - and the one
 * asymmetry with editing: Studio's own connections are restartable, because
 * a restart launches what the row already says, which is the only thing the
 * provenance refusal guards.
 */

const COMMAND = process.platform === "win32" ? "C:\\tools\\node.exe" : "/usr/bin/node";

interface Harness {
  readonly service: McpManagementService;
  readonly registry: McpServerRegistry;
  readonly order: string[];
}

function harness(supervisorStatus: McpSupervisor["status"]): Harness {
  const db = openDatabase({ path: ":memory:" });
  const order: string[] = [];
  const service = new McpManagementService({
    registry: new McpServerRegistry(db),
    grants: new PermissionGrantStore(db),
    selection: new ExtensionSelectionStore(db),
    extensions: {
      changed: () => {
        order.push("marked");
      },
    },
    supervisor: {
      stop: async (id: string) => {
        order.push(`stopped ${id}`);
      },
      status: supervisorStatus,
    },
    reconcile: () => order.push("reconciled"),
    projectId: "workspace-root",
  });
  return { service, registry: new McpServerRegistry(db), order };
}

const nobody: AuthContext = { clientId: "test", sessionId: "test", clientType: "test", scopes: [] };

afterEach(() => {
  // One database per harness call; nothing here closes it because the
  // in-memory store dies with the test. (openDatabase(":memory:") keeps no
  // handles beyond the connection itself.)
});

describe("restarting a connection", () => {
  it("stops it, marks the set changed, and wakes the reconciler, in that order", async () => {
    const state = harness((id: string) => ({ id, key: `${id}#1`, state: "idle", attempts: 0, diagnostics: [] }));
    state.service.save(
      {
        id: "echo",
        title: "Echo",
        transport: "stdio",
        command: COMMAND,
        args: [],
        env: {},
        auth: "none",
      },
      nobody,
    );

    const view = await state.service.restart("echo", nobody);

    // The save's own wake came first; this pins the restart's half.
    expect(state.order.slice(-3)).toEqual(["stopped echo", "marked", "reconciled"]);
    expect(view.id).toBe("echo");
    expect(view.status).toEqual({ id: "echo", key: "echo#1", state: "idle", attempts: 0, diagnostics: [] });
  });

  it("answers for an uninstalled connection", async () => {
    const state = harness(() => undefined);
    await expect(state.service.restart("ghost", nobody)).rejects.toThrow(
      /MCP server "ghost" is not installed\./,
    );
    expect(state.order).toEqual([]);
  });

  it("restarts Studio's own connections, which editing may not touch", async () => {
    const state = harness((id: string) => ({ id, key: `${id}#1`, state: "ready", attempts: 0, diagnostics: [] }));
    state.service.save(
      {
        id: "studio-customization",
        title: "Studio Customization",
        description: "Ours.",
        provenance: "system",
        transport: "stdio",
        command: COMMAND,
        args: ["customization.mjs"],
        env: {},
        auth: "none",
      },
      nobody,
    );

    const view = await state.service.restart("studio-customization", nobody);
    expect(view.provenance).toBe("system");
    expect(state.order.slice(-3)).toEqual([
      "stopped studio-customization",
      "marked",
      "reconciled",
    ]);

    // The contrast, in the same test: the same row cannot be edited or
    // removed from outside, which is exactly what restart does not do.
    await expect(state.service.remove("studio-customization", nobody)).rejects.toThrow(
      /cannot be removed/,
    );
  });
});
