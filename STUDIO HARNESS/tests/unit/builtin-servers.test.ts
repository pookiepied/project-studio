import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { McpManagementService } from "../../src/application/mcp-management.js";
import { ExtensionReconciler } from "../../src/extend/reconcile.js";
import { ExtensionInventory } from "../../src/extend/inventory.js";
import {
  BROWSER_SERVER_ID,
  browserServerPath,
  registerBuiltInServers,
} from "../../src/extend/mcp/builtin.js";
import { McpServerRegistry } from "../../src/extend/mcp/registry.js";
import { ExtensionSelectionStore, GLOBAL_SCOPE } from "../../src/extend/selection.js";
import { PermissionGrantStore } from "../../src/permissions/grant-store.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";

/**
 * The capabilities Studio ships, and the two things that must stay true.
 *
 * **They are ordinary rows.** Everything downstream - settings, the inventory,
 * the reconciler, the three scopes - treats the browser exactly as it treats a
 * server somebody installed, and that is the point of registering it rather
 * than special-casing it.
 *
 * **`provenance: "system"` is a boundary, not a label.** It exempts a server
 * from containment, because containment answers "whose program is this" and
 * this one is ours. Which makes it the field nobody outside this process may
 * write, and the reason the tests below care so much about who can set it.
 */

const KEY = { kind: "mcp", extensionId: BROWSER_SERVER_ID, scope: GLOBAL_SCOPE } as const;

describe("Studio's own capabilities become ordinary rows", () => {
  let db: StudioDatabase;
  let registry: McpServerRegistry;
  let selection: ExtensionSelectionStore;

  beforeEach(() => {
    db = openDatabase({ path: ":memory:" });
    registry = new McpServerRegistry(db);
    selection = new ExtensionSelectionStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it("installs the browser, launched as node and never as a shim", () => {
    registerBuiltInServers(registry, selection);
    const record = registry.get(BROWSER_SERVER_ID);
    // Skipped rather than failed when the bundle is not built - the same rule
    // the registration itself follows.
    if (browserServerPath() === undefined) {
      expect(record).toBeUndefined();
      return;
    }
    expect(record?.provenance).toBe("system");
    expect(record?.transport).toBe("stdio");
    // `assertValidCommand` refuses a .cmd or .bat on Windows for
    // CVE-2024-27980, and a design that needs the refusal waived is the wrong
    // design. The command is the executable running this very process.
    expect(record?.command).toBe(process.execPath);
    expect(record?.command).not.toMatch(/\.(cmd|bat|ps1)$/i);
    expect(record?.args[0]).toMatch(/browser\.mjs$/);
    // The sentence a model reads before it has any of the schemas. Without one
    // the capability is announced as a name and never reached for.
    expect((record?.description ?? "").length).toBeGreaterThan(40);
  });

  it("switches it on by default, and never a second time", () => {
    if (browserServerPath() === undefined) return;
    registerBuiltInServers(registry, selection);
    expect(selection.decisionAt(KEY)).toBe(true);

    // A person switching it off has switched it off. A restart that turned it
    // back on would be Studio overruling somebody about their own machine,
    // which is the thing ADR 0036 exists to forbid.
    selection.set(KEY, false);
    registerBuiltInServers(registry, selection);
    expect(selection.decisionAt(KEY)).toBe(false);
  });

  it("is idempotent, because the harness restarts constantly", () => {
    if (browserServerPath() === undefined) return;
    registerBuiltInServers(registry, selection);
    const first = registry.get(BROWSER_SERVER_ID);
    registerBuiltInServers(registry, selection);
    registerBuiltInServers(registry, selection);
    expect(registry.get(BROWSER_SERVER_ID)).toEqual(first);
    expect(registry.list().filter((row) => row.id === BROWSER_SERVER_ID)).toHaveLength(1);
  });
});

describe("what nobody outside may do to a capability Studio wrote", () => {
  let db: StudioDatabase;
  let registry: McpServerRegistry;
  let selection: ExtensionSelectionStore;
  let servers: McpManagementService;

  beforeEach(() => {
    db = openDatabase({ path: ":memory:" });
    registry = new McpServerRegistry(db);
    selection = new ExtensionSelectionStore(db);
    registerBuiltInServers(registry, selection);
    servers = new McpManagementService({
      registry,
      grants: new PermissionGrantStore(db),
      selection,
      supervisor: { stop: async () => undefined, status: () => undefined },
      extensions: new ExtensionReconciler(new ExtensionInventory(selection)),
      projectId: "prj_test",
      conversationProject: () => undefined,
    });
  });

  afterEach(() => {
    db.close();
  });

  it("refuses to edit it, because an edit changes what gets launched", () => {
    if (browserServerPath() === undefined) return;
    const record = registry.get(BROWSER_SERVER_ID);
    expect(record).toBeDefined();
    if (record === undefined) return;
    expect(() =>
      servers.save({ ...record, command: "C:\\anything.exe" }, {} as never),
    ).toThrow(/cannot be edited/);
    expect(registry.get(BROWSER_SERVER_ID)?.command).toBe(process.execPath);
  });

  it("refuses to remove it, and says what to do instead", async () => {
    if (browserServerPath() === undefined) return;
    await expect(servers.remove(BROWSER_SERVER_ID, {} as never)).rejects.toThrow(
      /Switch it off instead/,
    );
    expect(registry.get(BROWSER_SERVER_ID)).toBeDefined();
  });

  it("still lets a person switch it off, which is the decision that is theirs", () => {
    if (browserServerPath() === undefined) return;
    selection.set(KEY, false);
    expect(
      selection.resolve("mcp", BROWSER_SERVER_ID, { conversationId: "cnv_1" }).enabled,
    ).toBe(false);
  });
});
