import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ALL_ADMISSION_SCOPES } from "../../src/admission/scopes.js";
import { McpManagementService } from "../../src/application/mcp-management.js";
import { InMemoryCredentialStore } from "../../src/credentials/memory-store.js";
import { PermissionGrantStore } from "../../src/permissions/grant-store.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";
import { ExtensionSelectionStore, projectScope } from "../../src/extend/selection.js";
import type { McpSupervisor } from "../../src/extend/mcp/supervisor.js";
import { McpServerRegistry } from "../../src/extend/mcp/registry.js";

const COMMAND = process.platform === "win32" ? "C:\\tools\\node.exe" : "/usr/bin/node";

const SCOPE = {
  conversationId: "conversation",
  projectId: "project",
  agentId: "studio",
} as const;

const AUTH_CONTEXT = {
  clientId: "test-client",
  clientType: "test",
  sessionId: "test-session",
  scopes: ALL_ADMISSION_SCOPES,
} as const;

function server(title = "Server") {
  return {
    id: "example",
    title,
    transport: "stdio" as const,
    command: COMMAND,
    args: [],
    env: {},
    auth: "none" as const,
  };
}

describe("MCP management", () => {
  let db: StudioDatabase;
  let registry: McpServerRegistry;
  let grants: PermissionGrantStore;
  let selection: ExtensionSelectionStore;
  let changed: number;
  let stopped: string[];
  let credentials: InMemoryCredentialStore;
  let management: McpManagementService;

  beforeEach(() => {
    db = openDatabase({ path: ":memory:" });
    registry = new McpServerRegistry(db);
    grants = new PermissionGrantStore(db);
    selection = new ExtensionSelectionStore(db);
    changed = 0;
    stopped = [];
    credentials = new InMemoryCredentialStore();
    management = new McpManagementService({
      registry,
      grants,
      selection,
      extensions: { changed: () => changed += 1 },
      supervisor: {
        stop: async (id) => { stopped.push(id); },
        status: () => ({ state: "idle" }) as ReturnType<McpSupervisor["status"]>,
      },
      credentials,
    });
  });

  afterEach(() => {
    db.close();
  });

  it("revokes approvals when reach changes", () => {
    management.save(server(), AUTH_CONTEXT);
    grants.grant(
      { namespace: "mcp:example", name: "search" },
      SCOPE,
      "always",
    );

    management.save({ ...server(), command: process.platform === "win32" ? "C:\\tools\\other.exe" : "/usr/bin/other" }, AUTH_CONTEXT);

    expect(grants.find({ namespace: "mcp:example", name: "search" }, SCOPE)).toBeUndefined();
    expect(changed).toBe(2);
  });

  it("does not revoke approvals for a title-only edit", () => {
    management.save(server(), AUTH_CONTEXT);
    grants.grant(
      { namespace: "mcp:example", name: "search" },
      SCOPE,
      "always",
    );

    management.save(server("Renamed"), AUTH_CONTEXT);

    expect(grants.find({ namespace: "mcp:example", name: "search" }, SCOPE)).toBeDefined();
    expect(changed).toBe(2);
  });

  it("revokes, forgets selection, and stops on removal", async () => {
    management.save(server(), AUTH_CONTEXT);
    selection.set({ kind: "mcp", extensionId: "example", scope: projectScope("project") }, true);
    grants.grant(
      { namespace: "mcp:example", name: "search" },
      SCOPE,
      "always",
    );

    expect(await management.remove("example", AUTH_CONTEXT)).toBe(true);

    expect(grants.find({ namespace: "mcp:example", name: "search" }, SCOPE)).toBeUndefined();
    // Undefined, not false. Removal FORGETS the decision rather than recording
    // an off, and the two are now different answers: an off would override a
    // wider scope, so a reinstall would find the server explicitly disabled
    // here by a decision nobody made. This assertion got stronger when the
    // store learned to tell "never decided" from "switched off".
    expect(
      selection.decisionAt({
        kind: "mcp",
        extensionId: "example",
        scope: projectScope("project"),
      }),
    ).toBeUndefined();
    expect(stopped).toEqual(["example"]);
    expect(changed).toBe(2);
  });

  it("keeps approvals when a project disables a server", () => {
    management.save(server(), AUTH_CONTEXT);
    grants.grant(
      { namespace: "mcp:example", name: "search" },
      SCOPE,
      "always",
    );

    management.setEnabled(projectScope("project"), "example", false, AUTH_CONTEXT);

    expect(grants.find({ namespace: "mcp:example", name: "search" }, SCOPE)).toBeDefined();
    expect(selection.decisionAt({ kind: "mcp", extensionId: "example", scope: projectScope("project") })).toBe(false);
    expect(changed).toBe(2);
    expect(stopped).toEqual([]);
  });

  it("restarts a live server after credential rotation", async () => {
    const remote = {
      id: "example",
      title: "Server",
      transport: "http" as const,
      url: "https://example.test/mcp",
      auth: "bearer" as const,
    };
    management.save(remote, AUTH_CONTEXT);

    await management.setCredential("example", "first-secret", AUTH_CONTEXT);
    await management.setCredential("example", "second-secret", AUTH_CONTEXT);

    expect(await credentials.get({ scope: "mcp", id: "example" })).toBe("second-secret");
    expect(stopped).toEqual(["example", "example"]);
    expect(changed).toBe(3);
  });

  it("rejects credentials for an unauthenticated server", async () => {
    management.save(server(), AUTH_CONTEXT);

    await expect(
      management.setCredential("example", "secret", AUTH_CONTEXT),
    ).rejects.toThrow(/without authentication/);
    expect(await credentials.get({ scope: "mcp", id: "example" })).toBeNull();
  });

  it("deletes the keychain credential when removing a server", async () => {
    const remote = {
      id: "example",
      title: "Server",
      transport: "http" as const,
      url: "https://example.test/mcp",
      auth: "bearer" as const,
    };
    management.save(remote, AUTH_CONTEXT);
    await management.setCredential("example", "secret", AUTH_CONTEXT);

    expect(await management.remove("example", AUTH_CONTEXT)).toBe(true);
    expect(await credentials.get({ scope: "mcp", id: "example" })).toBeNull();
  });
});
