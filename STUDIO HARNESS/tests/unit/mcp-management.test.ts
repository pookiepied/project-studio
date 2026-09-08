import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ALL_ADMISSION_SCOPES } from "../../src/admission/scopes.js";
import { McpManagementService } from "../../src/application/mcp-management.js";
import { InMemoryCredentialStore } from "../../src/credentials/memory-store.js";
import { PermissionGrantStore } from "../../src/permissions/grant-store.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";
import {
  ExtensionSelectionStore,
  GLOBAL_SCOPE,
  conversationScope,
  projectScope,
} from "../../src/extend/selection.js";
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
    // The harness's own project, as the runtime supplies it. The readings
    // below only make sense against a fixed wider leg: which project a
    // projectless conversation's chain falls back to is part of what they
    // pin.
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
      projectId: "workspace-root",
      conversationProject: (conversationId) =>
        conversationId === "filed-conversation" || conversationId === "filed-sibling"
          ? "filed-project"
          : undefined,
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

  /**
   * What a narrower read answers.
   *
   * The invariant every case here pins is the same one: a row must be honest
   * about the effect, not only the setting. Inherit and off are different
   * answers that leave the model with different reach, so the reading carries
   * the stored decision AND what the chain resolves AND where that answer
   * came from - and the read that asks about nothing narrower carries none of
   * it, because the global screen edits the default and nothing else answers
   * to it.
   */
  describe("the scope readings", () => {
    beforeEach(() => {
      management.save(server(), AUTH_CONTEXT);
    });

    it("carries no readings when the read named no narrower scope", () => {
      selection.set({ kind: "mcp", extensionId: "example", scope: GLOBAL_SCOPE }, true);

      const [view] = management.list();

      expect(view?.project).toBeUndefined();
      expect(view?.conversation).toBeUndefined();
      // The global read's own answer, unchanged: the stored default, not a
      // resolution - this screen IS the widest scope, so there is nothing to
      // inherit and nothing to resolve past.
      expect(view?.enabledByDefault).toBe(true);
    });

    it("reads inherit as null, not as off, when only the default decided", () => {
      selection.set({ kind: "mcp", extensionId: "example", scope: GLOBAL_SCOPE }, true);

      const [view] = management.list({ projectId: "project-a" });

      // The one assertion the checkbox-collapse bug fails. Absence at the
      // project scope is "no decision here" - the global default's on still
      // applies - and flattening it to false would silently switch the
      // project's conversations off.
      expect(view?.project).toEqual({
        decision: null,
        resolved: true,
        decidedAt: "global",
      });
    });

    it("lets a project override, and leaves other projects inheriting", () => {
      selection.set({ kind: "mcp", extensionId: "example", scope: GLOBAL_SCOPE }, true);
      selection.set({ kind: "mcp", extensionId: "example", scope: projectScope("project-a") }, false);

      const rows = management.list({ projectId: "project-a" });
      expect(rows[0]?.project).toEqual({ decision: false, resolved: false, decidedAt: "project" });

      const [elsewhere] = management.list({ projectId: "project-b" });
      expect(elsewhere?.project).toEqual({ decision: null, resolved: true, decidedAt: "global" });
    });

    it("reads an explicit inherit back as an absent decision, not an off", () => {
      management.setEnabled(projectScope("project-a"), "example", true, AUTH_CONTEXT);
      expect(
        selection.decisionAt({ kind: "mcp", extensionId: "example", scope: projectScope("project-a") }),
      ).toBe(true);

      // `null` is the third value: it clears, so the wider scope applies
      // again. Writing an off here instead would trap the project at the
      // narrow scope - the model's reach would change and nobody asked for it.
      management.setEnabled(projectScope("project-a"), "example", null, AUTH_CONTEXT);
      expect(
        selection.decisionAt({ kind: "mcp", extensionId: "example", scope: projectScope("project-a") }),
      ).toBeUndefined();

      const [view] = management.list({ projectId: "project-a" });
      expect(view?.project?.decision).toBeNull();
    });

    it("answers nothing about a context nobody has decided about, and says so", () => {
      selection.set({ kind: "mcp", extensionId: "example", scope: GLOBAL_SCOPE }, false);

      // An unknown project id is not an error: the honest reading of a
      // context with no rows is "nothing decides here", and the chain's
      // answer - the default's - is the true one for it.
      const [view] = management.list({ projectId: "never-heard-of-it" });
      expect(view?.project).toEqual({ decision: null, resolved: false, decidedAt: "global" });
    });

    it("resolves a conversation through the project it is filed under", () => {
      selection.set({ kind: "mcp", extensionId: "example", scope: projectScope("filed-project") }, true);

      const [filed] = management.list({ conversationId: "filed-conversation" });
      expect(filed?.conversation).toEqual({ decision: null, resolved: true, decidedAt: "project" });

      // A conversation standing in no project falls back to the harness's
      // own project, which is the leg the tools array has always consulted -
      // the historic projectless-conversation rule, and the reason the wider
      // leg is never dropped from the chain.
      selection.set({ kind: "mcp", extensionId: "example", scope: projectScope("workspace-root") }, true);
      const [projectless] = management.list({ conversationId: "loose-conversation" });
      expect(projectless?.conversation).toEqual({ decision: null, resolved: true, decidedAt: "project" });
    });

    it("lets the conversation's own decision answer, and says it did", () => {
      selection.set({ kind: "mcp", extensionId: "example", scope: projectScope("filed-project") }, true);
      management.setEnabled(conversationScope("filed-conversation"), "example", false, AUTH_CONTEXT);

      const [filed] = management.list({ conversationId: "filed-conversation" });
      expect(filed?.conversation).toEqual({ decision: false, resolved: false, decidedAt: "conversation" });

      // And only that conversation: another one in the same project inherits.
      const [other] = management.list({ conversationId: "filed-sibling" });
      expect(other?.conversation).toEqual({ decision: null, resolved: true, decidedAt: "project" });
    });
  });
});
