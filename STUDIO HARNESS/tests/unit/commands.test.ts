import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CommandRegistry,
  expandCommand,
  parseCommandMarkdown,
  renderCommandMarkdown,
} from "../../src/extend/commands/registry.js";

/**
 * Slash commands as files. What is pinned: the file format round-trips, the
 * built-ins come first and keep their names, a file under the person's own
 * folder is listed and editable, a shipped one is listed and not, and the
 * expansion rules for the words typed after the name.
 */

describe("parseCommandMarkdown", () => {
  it("reads the two frontmatter fields and the body", () => {
    const source = parseCommandMarkdown(
      "---\ndescription: Review the diff\nargument-hint: [focus]\n---\n\nReview $ARGUMENTS\n",
    );
    expect(source).toEqual({
      frontmatter: { description: "Review the diff", argumentHint: "[focus]" },
      body: "Review $ARGUMENTS",
    });
  });

  it("treats a file with no fences as all body, and unquotes a quoted value", () => {
    expect(parseCommandMarkdown("Just a prompt.\n").body).toBe("Just a prompt.");
    expect(parseCommandMarkdown('---\ndescription: "A: colon"\n---\nbody').frontmatter.description).toBe(
      "A: colon",
    );
  });

  it("refuses a frontmatter that never closes", () => {
    expect(() => parseCommandMarkdown("---\ndescription: x\nbody")).toThrow(/never closed/);
  });

  it("round-trips through the renderer", () => {
    const source = {
      frontmatter: { description: "Explain: something", argumentHint: "<what>" },
      body: "Explain $1 to me.",
    };
    expect(parseCommandMarkdown(renderCommandMarkdown(source))).toEqual(source);
  });
});

describe("expandCommand", () => {
  it("substitutes the whole argument string and the numbered words", () => {
    expect(expandCommand("Explain $ARGUMENTS please", "the cache layer")).toBe(
      "Explain the cache layer please",
    );
    expect(expandCommand("Compare $1 with $2", "alpha beta gamma")).toBe("Compare alpha with beta");
    expect(expandCommand("Only $3", "one two")).toBe("Only ");
  });

  it("appends the arguments when the body names no placeholder", () => {
    expect(expandCommand("Review the diff.", "focus on tests")).toBe(
      "Review the diff.\n\nfocus on tests",
    );
    expect(expandCommand("Review the diff.", "  ")).toBe("Review the diff.");
  });
});

describe("CommandRegistry", () => {
  let root: string;
  let system: string;
  let user: string;
  let registry: CommandRegistry;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "studio-commands-"));
    system = join(root, "system");
    user = join(root, "user");
    mkdirSync(system);
    writeFileSync(
      join(system, "review.md"),
      "---\ndescription: Review the diff\n---\nReview $ARGUMENTS\n",
    );
    registry = new CommandRegistry({
      roots: [
        { directory: system, provenance: "system" },
        { directory: user, provenance: "user" },
      ],
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("lists the built-ins first, then the files by name", () => {
    mkdirSync(user);
    writeFileSync(join(user, "alpha.md"), "Alpha prompt\n");
    const ids = registry.list().map((record) => `${record.provenance}:${record.id}`);
    expect(ids).toEqual(["builtin:compact", "user:alpha", "system:review"]);
    // A file with no description shows its first line.
    expect(registry.get("alpha")?.description).toBe("Alpha prompt");
    expect(registry.get("compact")?.kind).toBe("action");
  });

  it("expands a file command with what was typed after it", () => {
    expect(registry.expand("review", "the tests")).toBe("Review the tests");
  });

  it("writes and removes the person's own commands, and no others", () => {
    const saved = registry.save("tidy", {
      frontmatter: { description: "Tidy up", argumentHint: "" },
      body: "Tidy $ARGUMENTS",
    });
    expect(saved.provenance).toBe("user");
    expect(readFileSync(join(user, "tidy.md"), "utf8")).toContain("description: Tidy up");
    expect(registry.expand("tidy", "this")).toBe("Tidy this");

    expect(() => registry.save("compact", { frontmatter: { description: "", argumentHint: "" }, body: "x" })).toThrow(
      /built in/,
    );
    expect(() => registry.save("review", { frontmatter: { description: "", argumentHint: "" }, body: "x" })).toThrow(
      /ships with Studio/,
    );
    expect(() => registry.save("Bad Name", { frontmatter: { description: "", argumentHint: "" }, body: "x" })).toThrow(
      /lowercase/,
    );
    expect(() => registry.remove("review")).toThrow(/not one of your own/);

    registry.remove("tidy");
    expect(registry.get("tidy")).toBeUndefined();
  });

  it("reports a file that takes a reserved name instead of listing it", () => {
    mkdirSync(user);
    writeFileSync(join(user, "compact.md"), "Pretend to compact\n");
    writeFileSync(join(user, "Bad Name.md"), "x\n");
    registry.list();
    const reasons = registry.problems().map((problem) => problem.reason);
    expect(reasons.some((reason) => /built-in/.test(reason))).toBe(true);
    expect(reasons.some((reason) => /file name is its name/.test(reason))).toBe(true);
    expect(registry.get("compact")?.kind).toBe("action");
  });

  it("re-reads a file edited by hand", () => {
    mkdirSync(user);
    const path = join(user, "alpha.md");
    writeFileSync(path, "First\n");
    expect(registry.expand("alpha", "")).toBe("First");
    // A later mtime and a different size: the memo is invalid either way.
    writeFileSync(path, "Second version\n");
    expect(registry.expand("alpha", "")).toBe("Second version");
  });
});
