import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SkillRegistry } from "../../src/extend/skills/registry.js";
import type { SelectionKey } from "../../src/extend/selection.js";

/** Every skill Studio ships parses, so none is silently missing from a turn's list. */
describe("the skills Studio ships", () => {
  it("all parse, including visual-responses", () => {
    const directory = fileURLToPath(new URL("../../skills", import.meta.url));
    const registry = new SkillRegistry({ roots: [{ directory, provenance: "system" }] });
    expect(registry.list().map((skill) => skill.id)).toEqual(["create-skill", "customize-studio", "visual-responses"]);
    expect(registry.problems()).toEqual([]);
    expect(registry.get("visual-responses")?.description).toMatch(/^The formats for charts/);
  });
});

describe("skills Studio switches on by default", () => {
  it("writes the default once and keeps a person's own choice", async () => {
    const { openDatabase } = await import("../../src/storage/database.js");
    const { ExtensionSelectionStore, GLOBAL_SCOPE } = await import("../../src/extend/selection.js");
    const { switchOnBuiltInSkills } = await import("../../src/extend/skills/builtin.js");
    const db = openDatabase({ path: ":memory:" });
    const selection = new ExtensionSelectionStore(db);
    const key: SelectionKey = { kind: "skill", extensionId: "visual-responses", scope: GLOBAL_SCOPE };

    switchOnBuiltInSkills(selection);
    expect(selection.decisionAt(key)).toBe(true);

    selection.set(key, false);
    switchOnBuiltInSkills(selection);
    expect(selection.decisionAt(key)).toBe(false);
    db.close();
  });
});
