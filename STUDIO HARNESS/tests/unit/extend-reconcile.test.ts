import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ExtensionInventory } from "../../src/extend/inventory.js";
import {
  ExtensionReconciler,
  planReconcile,
  type KindReconciler,
} from "../../src/extend/reconcile.js";
import { ExtensionSelectionStore, projectScope } from "../../src/extend/selection.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";

/**
 * The spine's reconciler, with no kind behind it.
 *
 * Everything here is asserted against a function that records what it was
 * asked for. That is the whole claim of this design — the spine never learns
 * what a kind is — so a test that needed a real MCP server to check it would
 * be testing the opposite of what is written down.
 */

let db: StudioDatabase;
let selection: ExtensionSelectionStore;
let inventory: ExtensionInventory;

beforeEach(() => {
  db = openDatabase({ path: ":memory:" });
  selection = new ExtensionSelectionStore(db);
  inventory = new ExtensionInventory(selection);
});

afterEach(() => {
  db.close();
});

interface Spy {
  readonly calls: readonly string[][];
  readonly run: KindReconciler;
}

function spy(fail?: string): Spy {
  const calls: string[][] = [];
  return {
    calls,
    run: async (desired) => {
      calls.push([...desired]);
      if (fail !== undefined) throw new Error(fail);
    },
  };
}

describe("planning the difference", () => {
  it("starts what is wanted and not live, stops what is live and not wanted", () => {
    const plan = planReconcile(["a", "b"], ["b", "c"]);

    expect(plan.start).toEqual(["a"]);
    expect(plan.stop).toEqual(["c"]);
  });

  it("asks for nothing when the two already agree", () => {
    const plan = planReconcile(["a", "b"], ["b", "a"]);

    expect(plan.start).toEqual([]);
    expect(plan.stop).toEqual([]);
  });

  it("ignores repeats on either side", () => {
    const plan = planReconcile(["a", "a"], ["b", "b"]);

    expect(plan.start).toEqual(["a"]);
    expect(plan.stop).toEqual(["b"]);
  });
});

describe("reconciling a project", () => {
  it("gives each kind the ids that are installed and switched on", async () => {
    inventory.register("mcp", () => [
      { id: "blender", title: "Blender", author: "third-party" },
      { id: "figma", title: "Figma", author: "third-party" },
    ]);
    selection.set({ kind: "mcp", extensionId: "blender", scope: projectScope("p1") }, true);

    const mcp = spy();
    const reconciler = new ExtensionReconciler(inventory);
    reconciler.register("mcp", mcp.run);

    await expect(reconciler.reconcile(["p1"])).resolves.toBe(true);

    expect(mcp.calls).toEqual([["blender"]]);
  });

  it("does no work at all when nothing has changed", async () => {
    // The cheap half of the design. A pass that would find nothing to do costs
    // one integer comparison, not a database read per kind.
    inventory.register("mcp", () => []);

    const mcp = spy();
    const reconciler = new ExtensionReconciler(inventory);
    reconciler.register("mcp", mcp.run);

    await reconciler.reconcile(["p1"]);
    await expect(reconciler.reconcile(["p1"])).resolves.toBe(false);

    expect(mcp.calls).toHaveLength(1);
  });

  it("runs again once something says the desired set changed", async () => {
    inventory.register("mcp", () => []);

    const mcp = spy();
    const reconciler = new ExtensionReconciler(inventory);
    reconciler.register("mcp", mcp.run);

    await reconciler.reconcile(["p1"]);
    reconciler.changed();
    await expect(reconciler.reconcile(["p1"])).resolves.toBe(true);

    expect(mcp.calls).toHaveLength(2);
  });

  it("runs again for a different project", async () => {
    inventory.register("mcp", () => []);

    const mcp = spy();
    const reconciler = new ExtensionReconciler(inventory);
    reconciler.register("mcp", mcp.run);

    await reconciler.reconcile(["p1"]);
    await expect(reconciler.reconcile(["p2"])).resolves.toBe(true);

    expect(mcp.calls).toHaveLength(2);
  });

  it("wants the union of what every open project switched on", async () => {
    // Switching something off in one project decides what that project sees.
    // It was never a decision to end a process somebody else is using — see
    // `C-18`. One project wanting it is enough for it to run.
    inventory.register("mcp", () => [
      { id: "blender", title: "Blender", author: "third-party" },
      { id: "figma", title: "Figma", author: "third-party" },
    ]);
    selection.set({ kind: "mcp", extensionId: "blender", scope: projectScope("p1") }, true);
    selection.set({ kind: "mcp", extensionId: "blender", scope: projectScope("p2") }, false);
    selection.set({ kind: "mcp", extensionId: "figma", scope: projectScope("p2") }, true);

    const mcp = spy();
    const reconciler = new ExtensionReconciler(inventory);
    reconciler.register("mcp", mcp.run);

    await reconciler.reconcile(["p1", "p2"]);

    expect([...(mcp.calls[0] ?? [])].sort()).toEqual(["blender", "figma"]);
  });

  it("counts a project once however many times it is named", async () => {
    inventory.register("mcp", () => [
      { id: "blender", title: "Blender", author: "third-party" },
    ]);
    selection.set({ kind: "mcp", extensionId: "blender", scope: projectScope("p1") }, true);

    const mcp = spy();
    const reconciler = new ExtensionReconciler(inventory);
    reconciler.register("mcp", mcp.run);

    await reconciler.reconcile(["p1", "p1"]);

    expect(mcp.calls).toEqual([["blender"]]);
  });

  it("stops wanting something once no open project does", async () => {
    inventory.register("mcp", () => [
      { id: "blender", title: "Blender", author: "third-party" },
    ]);
    selection.set({ kind: "mcp", extensionId: "blender", scope: projectScope("p1") }, true);

    const mcp = spy();
    const reconciler = new ExtensionReconciler(inventory);
    reconciler.register("mcp", mcp.run);

    await reconciler.reconcile(["p1", "p2"]);
    // p1 closed. Nothing left wants it.
    await reconciler.reconcile(["p2"]);

    expect(mcp.calls).toEqual([["blender"], []]);
  });

  it("does not care what order the projects arrive in", async () => {
    inventory.register("mcp", () => []);

    const mcp = spy();
    const reconciler = new ExtensionReconciler(inventory);
    reconciler.register("mcp", mcp.run);

    await reconciler.reconcile(["p1", "p2"]);
    await expect(reconciler.reconcile(["p2", "p1"])).resolves.toBe(false);

    expect(mcp.calls).toHaveLength(1);
  });

  it("treats a change that arrives mid-pass as unhandled", async () => {
    // The generation is read before the work, not after. Recording the value
    // from the end would mark a change this pass never saw as handled, and
    // nothing would ever correct it.
    inventory.register("mcp", () => []);

    const reconciler = new ExtensionReconciler(inventory);
    let calls = 0;
    reconciler.register("mcp", async () => {
      calls += 1;
      if (calls === 1) reconciler.changed();
    });

    await reconciler.reconcile(["p1"]);
    await expect(reconciler.reconcile(["p1"])).resolves.toBe(true);

    expect(calls).toBe(2);
  });
});

describe("one pass at a time", () => {
  it("joins a second caller to the pass already running", async () => {
    // Two concurrent passes would spawn the same server twice.
    inventory.register("mcp", () => []);

    const reconciler = new ExtensionReconciler(inventory);
    let calls = 0;
    reconciler.register("mcp", async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    await Promise.all([reconciler.reconcile(["p1"]), reconciler.reconcile(["p1"])]);

    expect(calls).toBe(1);
  });

  it("makes a different set of projects wait rather than race", async () => {
    inventory.register("mcp", () => []);

    const reconciler = new ExtensionReconciler(inventory);
    const order: string[] = [];
    let running = 0;
    reconciler.register("mcp", async () => {
      running += 1;
      order.push(`start ${running}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push("end");
      running -= 1;
    });

    await Promise.all([reconciler.reconcile(["p1"]), reconciler.reconcile(["p2"])]);

    expect(order).toEqual(["start 1", "end", "start 1", "end"]);
  });

  it("lets a queued pass run even when the one before it failed", async () => {
    inventory.register("mcp", () => []);
    inventory.register("skill", () => []);

    const reconciler = new ExtensionReconciler(inventory);
    let calls = 0;
    reconciler.register("mcp", async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (calls === 1) throw new Error("first pass fails");
    });

    const first = reconciler.reconcile(["p1"]);
    const second = reconciler.reconcile(["p2"]);

    await expect(first).rejects.toThrow(/first pass fails/);
    await expect(second).resolves.toBe(true);
  });
});

describe("one kind failing decides nothing for the others", () => {
  it("still asks every kind", async () => {
    // A broken hook that stopped MCP from starting would be a failure nobody
    // could diagnose from either side.
    inventory.register("mcp", () => []);
    inventory.register("hook", () => []);

    const mcp = spy("mcp is broken");
    const hook = spy();
    const reconciler = new ExtensionReconciler(inventory);
    reconciler.register("mcp", mcp.run);
    reconciler.register("hook", hook.run);

    await expect(reconciler.reconcile(["p1"])).rejects.toThrow(/mcp is broken/);

    expect(hook.calls).toHaveLength(1);
  });

  it("does not record a failed pass as settled", async () => {
    inventory.register("mcp", () => []);

    const reconciler = new ExtensionReconciler(inventory);
    let calls = 0;
    reconciler.register("mcp", async () => {
      calls += 1;
      if (calls === 1) throw new Error("broken");
    });

    await expect(reconciler.reconcile(["p1"])).rejects.toThrow();
    await expect(reconciler.reconcile(["p1"])).resolves.toBe(true);

    expect(calls).toBe(2);
  });
});

describe("registering", () => {
  it("refuses a second reconciler for one kind", () => {
    const reconciler = new ExtensionReconciler(inventory);

    reconciler.register("mcp", spy().run);

    expect(() => reconciler.register("mcp", spy().run)).toThrow(/already reconciled/);
  });

  it("skips a kind that has no reconciler", async () => {
    const reconciler = new ExtensionReconciler(inventory);

    await expect(reconciler.reconcile(["p1"])).resolves.toBe(true);
  });
});
