import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ExtendError } from "../../src/extend/errors.js";
import { SkillRegistry } from "../../src/extend/skills/registry.js";

function skillMarkdown(name: string, description = `Does ${name}.`): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\nThe ${name} instructions.\n`;
}

function writeSkill(root: string, name: string, content = skillMarkdown(name)): string {
  const directory = join(root, name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "SKILL.md"), content);
  return directory;
}

describe("the skill registry", () => {
  let home: string;
  let bundled: string;
  let user: string;
  let registry: SkillRegistry;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "studio-skills-"));
    bundled = join(home, "bundled");
    user = join(home, "user");
    mkdirSync(bundled);
    mkdirSync(user);
    registry = new SkillRegistry({
      roots: [
        { directory: bundled, provenance: "system" },
        { directory: user, provenance: "user" },
      ],
    });
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("lists a folder holding a valid SKILL.md, with the sentence and whose it is", () => {
    writeSkill(user, "review-pr", skillMarkdown("review-pr", "Reviews a pull request."));
    writeSkill(bundled, "create-skill");

    expect(registry.list()).toEqual([
      expect.objectContaining({ id: "create-skill", provenance: "system", directory: join(bundled, "create-skill") }),
      expect.objectContaining({
        id: "review-pr",
        title: "review-pr",
        description: "Reviews a pull request.",
        provenance: "user",
      }),
    ]);
    expect(registry.problems()).toEqual([]);
    expect(registry.asExtensions()).toEqual([
      { id: "create-skill", title: "create-skill", author: "studio" },
      { id: "review-pr", title: "review-pr", author: "third-party" },
    ]);
  });

  it("answers nothing, and no problem, when a root does not exist", () => {
    rmSync(user, { recursive: true });
    expect(registry.list()).toEqual([]);
    expect(registry.problems()).toEqual([]);
  });

  it("skips a folder with no SKILL.md, and one that starts with a dot, silently", () => {
    mkdirSync(join(user, "notes"));
    writeFileSync(join(user, "notes", "README.md"), "not a skill");
    writeSkill(user, ".hidden");
    expect(registry.list()).toEqual([]);
    expect(registry.problems()).toEqual([]);
  });

  /**
   * A broken skill is a problem to show, never a throw. The person can fix a
   * typo; they cannot fix a settings screen that refuses to open.
   */
  describe("a folder that is not a skill", () => {
    it("reports a SKILL.md with no frontmatter and keeps the others", () => {
      writeSkill(user, "good");
      writeSkill(user, "bad", "Just some text.\n");

      expect(registry.list().map((record) => record.id)).toEqual(["good"]);
      expect(registry.problems()).toEqual([
        { directory: join(user, "bad"), reason: expect.stringContaining("missing YAML frontmatter") },
      ]);
    });

    it("reports a frontmatter name that does not match the folder", () => {
      writeSkill(user, "folder-name", skillMarkdown("other-name"));
      expect(registry.list()).toEqual([]);
      expect(registry.problems()[0]?.reason).toContain("must match");
      // Flue's own prefix means nothing on a settings row.
      expect(registry.problems()[0]?.reason).not.toContain("[flue]");
    });

    it("refuses a user skill that reuses a bundled name, and keeps the bundled one", () => {
      writeSkill(bundled, "create-skill", skillMarkdown("create-skill", "Studio's."));
      writeSkill(user, "create-skill", skillMarkdown("create-skill", "Somebody else's."));

      expect(registry.list()).toEqual([
        expect.objectContaining({ id: "create-skill", provenance: "system", description: "Studio's." }),
      ]);
      expect(registry.problems()).toEqual([
        {
          directory: join(user, "create-skill"),
          reason: expect.stringContaining("already installed"),
        },
      ]);
    });
  });

  describe("a scan that is asked every render", () => {
    it("re-reads a SKILL.md only when it changed", () => {
      const directory = writeSkill(user, "edited", skillMarkdown("edited", "First."));
      const path = join(directory, "SKILL.md");
      const pinned = new Date(1_000_000_000_000);
      utimesSync(path, pinned, pinned);
      expect(registry.get("edited")?.description).toBe("First.");

      // Same mtime and size: the memo answers, and the new words are not seen.
      writeFileSync(path, skillMarkdown("edited", "Third."));
      utimesSync(path, pinned, pinned);
      expect(registry.get("edited")?.description).toBe("First.");

      // A different mtime is read afresh.
      const later = new Date(1_000_000_500_000);
      utimesSync(path, later, later);
      expect(registry.get("edited")?.description).toBe("Third.");
    });

    it("forgets a folder that was deleted", () => {
      writeSkill(user, "gone");
      expect(registry.get("gone")).toBeDefined();
      rmSync(join(user, "gone"), { recursive: true });
      expect(registry.get("gone")).toBeUndefined();
    });
  });

  describe("packaging a skill for the model", () => {
    it("packages SKILL.md and the supporting files, with forward-slash paths", () => {
      const directory = writeSkill(user, "packaged");
      mkdirSync(join(directory, "templates"));
      writeFileSync(join(directory, "templates", "report.md"), "# Report");

      const reference = registry.reference("packaged");
      expect(reference.name).toBe("packaged");
      expect(reference.description).toBe("Does packaged.");
      expect(reference.id).toMatch(/^skill:packaged:[0-9a-f]{16}$/);
      // The packaged directory rides on the reference under a private key
      // Flue reads; the content hash in the id is what proves the files went
      // in. A change to a supporting file therefore changes the reference.
      writeFileSync(join(directory, "templates", "report.md"), "# Report, revised");
      utimesSync(
        join(directory, "templates", "report.md"),
        new Date(1_000_000_500_000),
        new Date(1_000_000_500_000),
      );
      expect(registry.reference("packaged").id).not.toBe(reference.id);
    });

    it("hands back the same reference while nothing under the folder changed", () => {
      writeSkill(user, "stable");
      expect(registry.reference("stable")).toBe(registry.reference("stable"));
    });

    it("leaves dotfiles and symbolic links out of the package", () => {
      const directory = writeSkill(user, "linked");
      writeFileSync(join(directory, ".gitignore"), "*");
      const outside = join(home, "outside.txt");
      writeFileSync(outside, "not the skill's");
      try {
        symlinkSync(outside, join(directory, "link.txt"));
      } catch {
        // Symbolic links need a privilege on some Windows accounts; the
        // dotfile half of the rule is still asserted below.
      }

      const withoutExtras = registry.reference("linked").id;
      rmSync(join(directory, ".gitignore"));
      rmSync(join(directory, "link.txt"), { force: true });
      expect(registry.reference("linked").id).toBe(withoutExtras);
    });

    it("refuses a skill that is not installed by name", () => {
      expect(() => registry.reference("nope")).toThrow(ExtendError);
      expect(() => registry.reference("nope")).toThrow(/No skill named "nope"/);
    });

    it("refuses a file over the per-file cap with a sentence naming it", () => {
      const directory = writeSkill(user, "heavy");
      writeFileSync(join(directory, "data.bin"), Buffer.alloc(1024 * 1024 + 1));
      expect(() => registry.reference("heavy")).toThrow(/data\.bin/);
    });
  });
});
