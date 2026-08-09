import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ExtendError } from "../../src/extend/errors.js";
import {
  ExtensionInventory,
  type ExtensionSummary,
} from "../../src/extend/inventory.js";
import { ExtensionSelectionStore } from "../../src/extend/selection.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";

const BLENDER: ExtensionSummary = {
  id: "blender",
  title: "Blender",
  author: "third-party",
};

const FIGMA: ExtensionSummary = {
  id: "figma",
  title: "Figma",
  author: "third-party",
};

const IMAGES: ExtensionSummary = {
  id: "images",
  title: "Image generation",
  author: "studio",
};

describe("the extend spine", () => {
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

  describe("nothing is on until it is chosen", () => {
    it("gives a fresh project no extensions at all", () => {
      inventory.register("mcp", () => [BLENDER, FIGMA]);

      expect(inventory.active("mcp", "project-a")).toEqual([]);
    });

    it("still lists what is installed, so settings can offer it", () => {
      inventory.register("mcp", () => [BLENDER, FIGMA]);

      const listed = inventory.list("mcp", "project-a");

      expect(listed.map((entry) => entry.id)).toEqual(["blender", "figma"]);
      expect(listed.every((entry) => !entry.enabled)).toBe(true);
    });

    it("writes no row for a project that has chosen nothing", () => {
      inventory.register("mcp", () => [BLENDER, FIGMA]);
      inventory.list("mcp", "project-a");

      const count = db.handle
        .prepare("SELECT COUNT(*) AS n FROM extension_selection")
        .get() as { n: number };

      expect(count.n).toBe(0);
    });
  });

  describe("a selection belongs to one project", () => {
    beforeEach(() => {
      inventory.register("mcp", () => [BLENDER, FIGMA]);
    });

    it("switches one on without touching another project", () => {
      selection.set(
        { kind: "mcp", extensionId: "blender", projectId: "project-a" },
        true,
      );

      expect(inventory.active("mcp", "project-a").map((e) => e.id)).toEqual([
        "blender",
      ]);
      expect(inventory.active("mcp", "project-b")).toEqual([]);
    });

    it("switches one off again", () => {
      const key = { kind: "mcp", extensionId: "blender", projectId: "a" } as const;

      selection.set(key, true);
      expect(selection.isEnabled(key)).toBe(true);

      selection.set(key, false);
      expect(selection.isEnabled(key)).toBe(false);
    });

    it("keeps one row per decision rather than piling them up", () => {
      const key = { kind: "mcp", extensionId: "blender", projectId: "a" } as const;

      selection.set(key, true);
      selection.set(key, false);
      selection.set(key, true);

      const count = db.handle
        .prepare("SELECT COUNT(*) AS n FROM extension_selection")
        .get() as { n: number };

      expect(count.n).toBe(1);
    });

    it("does not confuse two kinds that share an id", () => {
      inventory.register("skill", () => [{ ...BLENDER, title: "Blender skill" }]);

      selection.set(
        { kind: "mcp", extensionId: "blender", projectId: "a" },
        true,
      );

      expect(inventory.active("mcp", "a").map((e) => e.id)).toEqual(["blender"]);
      expect(inventory.active("skill", "a")).toEqual([]);
    });
  });

  describe("a selection cannot resurrect something that is gone", () => {
    it("ignores a selection for an extension no longer installed", () => {
      inventory.register("mcp", () => [BLENDER]);
      selection.set({ kind: "mcp", extensionId: "blender", projectId: "a" }, true);
      selection.set({ kind: "mcp", extensionId: "figma", projectId: "a" }, true);

      // The row exists and says on; the provider does not offer it. What a
      // project gets is the intersection, never the store alone.
      expect(selection.isEnabled({ kind: "mcp", extensionId: "figma", projectId: "a" }))
        .toBe(true);
      expect(inventory.active("mcp", "a").map((e) => e.id)).toEqual(["blender"]);
    });

    it("forgets an uninstalled extension in every project", () => {
      selection.set({ kind: "mcp", extensionId: "figma", projectId: "a" }, true);
      selection.set({ kind: "mcp", extensionId: "figma", projectId: "b" }, true);
      selection.set({ kind: "mcp", extensionId: "blender", projectId: "a" }, true);

      expect(selection.forget("mcp", "figma")).toBe(2);

      expect(selection.enabledIds("mcp", "a")).toEqual(["blender"]);
      expect(selection.enabledIds("mcp", "b")).toEqual([]);
    });
  });

  describe("one kind lists its own things and nobody else's", () => {
    it("returns nothing for a kind that has no provider", () => {
      expect(inventory.list("hook", "a")).toEqual([]);
    });

    it("refuses a second provider for a kind", () => {
      inventory.register("mcp", () => [BLENDER]);

      expect(() => inventory.register("mcp", () => [FIGMA])).toThrow(ExtendError);
    });

    it("allows a provider again after it is unregistered", () => {
      inventory.register("mcp", () => [BLENDER]);
      expect(inventory.unregister("mcp")).toBe(true);

      inventory.register("mcp", () => [FIGMA]);
      expect(inventory.list("mcp", "a").map((e) => e.id)).toEqual(["figma"]);
    });

    it("gathers every kind for a settings screen", () => {
      inventory.register("mcp", () => [BLENDER]);
      inventory.register("skill", () => [IMAGES]);

      expect(inventory.listAll("a").map((e) => `${e.kind}/${e.id}`)).toEqual([
        "mcp/blender",
        "skill/images",
      ]);
    });
  });

  describe("the spine carries who wrote it, and decides nothing with it", () => {
    it("reports the author without treating ours differently", () => {
      inventory.register("mcp", () => [IMAGES, BLENDER]);

      const listed = inventory.list("mcp", "a");

      expect(listed.map((entry) => entry.author)).toEqual([
        "studio",
        "third-party",
      ]);
      // Ours is off by default too. Whether a bundled extension may be
      // switched off is a product question, and the spine does not answer it.
      expect(listed.every((entry) => !entry.enabled)).toBe(true);
    });
  });
});
