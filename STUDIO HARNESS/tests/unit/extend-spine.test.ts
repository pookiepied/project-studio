import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ExtendError } from "../../src/extend/errors.js";
import { SkillRegistry } from "../../src/extend/skills/registry.js";
import {
  ExtensionInventory,
  type ExtensionSummary,
} from "../../src/extend/inventory.js";
import {
  conversationScope,
  ExtensionSelectionStore,
  GLOBAL_SCOPE,
  projectScope,
  type Scope,
} from "../../src/extend/selection.js";
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

      expect(inventory.active("mcp", { projectId: "project-a" })).toEqual([]);
    });

    it("still lists what is installed, so settings can offer it", () => {
      inventory.register("mcp", () => [BLENDER, FIGMA]);

      const listed = inventory.list("mcp", { projectId: "project-a" });

      expect(listed.map((entry) => entry.id)).toEqual(["blender", "figma"]);
      expect(listed.every((entry) => !entry.enabled)).toBe(true);
    });

    it("writes no row for a project that has chosen nothing", () => {
      inventory.register("mcp", () => [BLENDER, FIGMA]);
      inventory.list("mcp", { projectId: "project-a" });

      const count = db
        .prepare("SELECT COUNT(*) AS n FROM extension_scope")
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
        { kind: "mcp", extensionId: "blender", scope: projectScope("project-a") },
        true,
      );

      expect(inventory.active("mcp", { projectId: "project-a" }).map((e) => e.id)).toEqual([
        "blender",
      ]);
      expect(inventory.active("mcp", { projectId: "project-b" })).toEqual([]);
    });

    it("switches one off again", () => {
      const key = { kind: "mcp", extensionId: "blender", scope: projectScope("a") } as const;

      selection.set(key, true);
      expect(selection.decisionAt(key)).toBe(true);

      selection.set(key, false);
      expect(selection.decisionAt(key)).toBe(false);
    });

    it("keeps one row per decision rather than piling them up", () => {
      const key = { kind: "mcp", extensionId: "blender", scope: projectScope("a") } as const;

      selection.set(key, true);
      selection.set(key, false);
      selection.set(key, true);

      const count = db
        .prepare("SELECT COUNT(*) AS n FROM extension_scope")
        .get() as { n: number };

      expect(count.n).toBe(1);
    });

    it("does not confuse two kinds that share an id", () => {
      inventory.register("skill", () => [{ ...BLENDER, title: "Blender skill" }]);

      selection.set(
        { kind: "mcp", extensionId: "blender", scope: projectScope("a") },
        true,
      );

      expect(inventory.active("mcp", { projectId: "a" }).map((e) => e.id)).toEqual(["blender"]);
      expect(inventory.active("skill", { projectId: "a" })).toEqual([]);
    });
  });

  describe("a selection cannot resurrect something that is gone", () => {
    it("ignores a selection for an extension no longer installed", () => {
      inventory.register("mcp", () => [BLENDER]);
      selection.set({ kind: "mcp", extensionId: "blender", scope: projectScope("a") }, true);
      selection.set({ kind: "mcp", extensionId: "figma", scope: projectScope("a") }, true);

      // The row exists and says on; the provider does not offer it. What a
      // project gets is the intersection, never the store alone.
      expect(selection.decisionAt({ kind: "mcp", extensionId: "figma", scope: projectScope("a") }))
        .toBe(true);
      expect(inventory.active("mcp", { projectId: "a" }).map((e) => e.id)).toEqual(["blender"]);
    });

    it("forgets an uninstalled extension in every project", () => {
      selection.set({ kind: "mcp", extensionId: "figma", scope: projectScope("a") }, true);
      selection.set({ kind: "mcp", extensionId: "figma", scope: projectScope("b") }, true);
      selection.set({ kind: "mcp", extensionId: "blender", scope: projectScope("a") }, true);

      expect(selection.forget("mcp", "figma")).toBe(2);

      expect(selection.enabledIds("mcp", { projectId: "a" })).toEqual(["blender"]);
      expect(selection.enabledIds("mcp", { projectId: "b" })).toEqual([]);
    });
  });

  describe("one kind lists its own things and nobody else's", () => {
    it("returns nothing for a kind that has no provider", () => {
      expect(inventory.list("hook", { projectId: "a" })).toEqual([]);
    });

    it("refuses a second provider for a kind", () => {
      inventory.register("mcp", () => [BLENDER]);

      expect(() => inventory.register("mcp", () => [FIGMA])).toThrow(ExtendError);
    });

    it("allows a provider again after it is unregistered", () => {
      inventory.register("mcp", () => [BLENDER]);
      expect(inventory.unregister("mcp")).toBe(true);

      inventory.register("mcp", () => [FIGMA]);
      expect(inventory.list("mcp", { projectId: "a" }).map((e) => e.id)).toEqual(["figma"]);
    });

    it("gathers every kind for a settings screen", () => {
      inventory.register("mcp", () => [BLENDER]);
      inventory.register("skill", () => [IMAGES]);

      expect(inventory.listAll({ projectId: "a" }).map((e) => `${e.kind}/${e.id}`)).toEqual([
        "mcp/blender",
        "skill/images",
      ]);
    });
  });

  describe("a narrower scope answers before a wider one", () => {
    beforeEach(() => {
      inventory.register("mcp", () => [BLENDER, FIGMA]);
    });

    const blender = (scope: Scope) =>
      ({ kind: "mcp", extensionId: "blender", scope }) as const;

    it("inherits the global default where nothing else decided", () => {
      selection.set(blender(GLOBAL_SCOPE), true);

      // The case the product is built around: a quick conversation, no
      // project, no setup, and the user's default already applies.
      expect(selection.resolve("mcp", "blender", {})).toEqual({
        enabled: true,
        decidedAt: "global",
      });
      expect(
        selection.resolve("mcp", "blender", { projectId: "a" }),
      ).toEqual({ enabled: true, decidedAt: "global" });
    });

    it("lets a project switch off something the default switched on", () => {
      selection.set(blender(GLOBAL_SCOPE), true);
      selection.set(blender(projectScope("a")), false);

      expect(selection.resolve("mcp", "blender", { projectId: "a" }).enabled).toBe(false);
      // And only that project. Another one still inherits.
      expect(selection.resolve("mcp", "blender", { projectId: "b" }).enabled).toBe(true);
    });

    it("lets a conversation override its own project", () => {
      selection.set(blender(GLOBAL_SCOPE), false);
      selection.set(blender(projectScope("a")), true);
      selection.set(blender(conversationScope("c")), false);

      expect(
        selection.resolve("mcp", "blender", { conversationId: "c", projectId: "a" }),
      ).toEqual({ enabled: false, decidedAt: "conversation" });
      // A different conversation in the same project is untouched.
      expect(
        selection.resolve("mcp", "blender", { conversationId: "d", projectId: "a" }),
      ).toEqual({ enabled: true, decidedAt: "project" });
    });

    it("goes back to inheriting when a decision is cleared", () => {
      selection.set(blender(GLOBAL_SCOPE), true);
      selection.set(blender(projectScope("a")), false);
      expect(selection.resolve("mcp", "blender", { projectId: "a" }).enabled).toBe(false);

      // Clearing is not the same as switching off: off overrides the default,
      // cleared returns to it. A screen offering only on and off would trap
      // the project here forever.
      selection.clear(blender(projectScope("a")));
      expect(selection.resolve("mcp", "blender", { projectId: "a" })).toEqual({
        enabled: true,
        decidedAt: "global",
      });
    });

    it("is off when nothing anywhere has an opinion", () => {
      expect(selection.resolve("mcp", "figma", { conversationId: "c", projectId: "a" }))
        .toEqual({ enabled: false });
    });

    it("tells a settings screen which scope produced the answer", () => {
      selection.set(blender(GLOBAL_SCOPE), true);

      const rows = inventory.list("mcp", { projectId: "a" });
      expect(rows.map((row) => [row.id, row.enabled, row.decidedAt])).toEqual([
        ["blender", true, "global"],
        // Never decided anywhere: off, and with no scope to name for it.
        ["figma", false, undefined],
      ]);
    });

    it("resolves the enabled list through the same chain", () => {
      selection.set(blender(GLOBAL_SCOPE), true);
      selection.set({ kind: "mcp", extensionId: "figma", scope: projectScope("a") }, true);

      expect(selection.enabledIds("mcp", { projectId: "a" })).toEqual([
        "blender",
        "figma",
      ]);
      // Blender only, in a project that inherits it and never chose figma.
      expect(selection.enabledIds("mcp", { projectId: "b" })).toEqual(["blender"]);
    });
  });

  describe("the spine carries who wrote it, and decides nothing with it", () => {
    it("reports the author without treating ours differently", () => {
      inventory.register("mcp", () => [IMAGES, BLENDER]);

      const listed = inventory.list("mcp", { projectId: "a" });

      expect(listed.map((entry) => entry.author)).toEqual([
        "studio",
        "third-party",
      ]);
      // Ours is off by default too. Whether a bundled extension may be
      // switched off is a product question, and the spine does not answer it.
      expect(listed.every((entry) => !entry.enabled)).toBe(true);
    });
  });

  describe("the second kind plugs in the way the first did", () => {
    // The skill registry is the second real provider the spine has had, and
    // the spine was written promising a second kind would arrive by adding a
    // folder and editing nothing. This is that promise, checked: a folder of
    // skills lists and resolves through the same code the MCP registry does.
    it("lists and resolves skills from a folder through the spine unchanged", () => {
      const home = mkdtempSync(join(tmpdir(), "studio-spine-skills-"));
      try {
        mkdirSync(join(home, "hello"));
        writeFileSync(
          join(home, "hello", "SKILL.md"),
          "---\nname: hello\ndescription: Greets.\n---\n\nSay hello.\n",
        );
        const registry = new SkillRegistry({ roots: [{ directory: home, provenance: "user" }] });
        inventory.register("skill", () => registry.asExtensions());

        expect(inventory.list("skill", { projectId: "a" })).toEqual([
          { id: "hello", title: "hello", author: "third-party", kind: "skill", enabled: false },
        ]);
        selection.set({ kind: "skill", extensionId: "hello", scope: GLOBAL_SCOPE }, true);
        expect(inventory.active("skill", { projectId: "a" }).map((entry) => entry.id)).toEqual(["hello"]);
        // The folder going away is the uninstall, and the selection left
        // behind resurrects nothing.
        rmSync(join(home, "hello"), { recursive: true });
        expect(inventory.active("skill", { projectId: "a" })).toEqual([]);
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    });
  });
});
