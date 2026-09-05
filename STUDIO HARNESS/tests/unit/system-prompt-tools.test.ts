import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { STUDIO_SYSTEM_PROMPT } from "../../src/context/system-prompt.js";

/**
 * The prompt's list of tools, against the tools that actually exist.
 *
 * This test exists because the list went stale and nothing noticed. Two tool
 * families shipped - the ask family and the plan family - while the prompt
 * still said "five families" and named neither, so every conversation was told
 * about a tool array that did not match the one it was given. A model reads
 * that list to decide what it can do; a tool missing from it is a tool reached
 * for late or not at all.
 *
 * The tool names are discovered by scanning the source rather than imported
 * from a hand-kept array, because a hand-kept array is the same kind of thing
 * that drifted in the first place. Add a native tool anywhere under
 * `src/tools/` and this test asks for it to be named in the prompt.
 *
 * What is asserted is only that each name appears in the list. How the prompt
 * describes a tool is prose and belongs to whoever writes it; that the prompt
 * knows the tool exists is a fact, and facts are what a test is for.
 */

// `fileURLToPath`, not `.pathname`: this repository's path contains spaces,
// and a URL's pathname keeps them percent-encoded.
const TOOLS_ROOT = fileURLToPath(new URL("../../src/tools/", import.meta.url));

/** Every `native` capability name declared under `src/tools/`. */
function declaredNativeTools(directory: string): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...declaredNativeTools(path));
      continue;
    }
    if (!entry.name.endsWith(".ts")) continue;
    const source = readFileSync(path, "utf8");
    // The descriptor's own literal, which is what the registry reads too.
    const pattern = /namespace:\s*"native",\s*name:\s*"([a-z_]+)"/g;
    for (const match of source.matchAll(pattern)) {
      const name = match[1];
      if (name !== undefined) found.push(name);
    }
  }
  return found;
}

/** The bullet lines of the prompt's own tool list. */
function familyBullets(): readonly string[] {
  return STUDIO_SYSTEM_PROMPT.split("\n").filter((line) =>
    /^- \*\*[A-Z][a-z]+\*\* - /.test(line),
  );
}

/** The tool names those bullets actually name. */
function listedTools(): readonly string[] {
  const names = new Set<string>();
  const separator = "** - ";
  for (const bullet of familyBullets()) {
    const listed = bullet.slice(bullet.indexOf(separator) + separator.length);
    for (const name of listed.split(",")) {
      const trimmed = name.trim();
      if (trimmed !== "") names.add(trimmed);
    }
  }
  return [...names];
}

describe("the prompt's account of the tools", () => {
  it("names every native tool that exists, in the list itself", () => {
    const declared = [...new Set(declaredNativeTools(TOOLS_ROOT))].sort();

    // A guard on the guard: if the scan finds nothing, the comparison below
    // passes vacuously and the test is decoration.
    expect(declared.length).toBeGreaterThanOrEqual(11);
    expect(declared).toContain("shell");

    // Compared against the parsed bullets, not searched for anywhere in the
    // prompt. Most of these names are ordinary English - read, write, plan,
    // git, edit - so a substring check over the whole prompt would pass on
    // prose that has nothing to do with the tool list, which is exactly the
    // drift this is meant to catch.
    expect([...listedTools()].sort()).toEqual(declared);
  });

  it("counts the families it lists", () => {
    // The sentence and the bullets are written by hand and can disagree with
    // each other, which is its own kind of stale.
    const stated = /native tools provided by the harness, in ([a-z]+) families/.exec(
      STUDIO_SYSTEM_PROMPT,
    );
    expect(stated).not.toBeNull();

    const written: Readonly<Record<string, number>> = {
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10,
    };
    const claimed = written[stated?.[1] ?? ""];
    expect(claimed).toBeDefined();
    expect(familyBullets()).toHaveLength(claimed ?? -1);
  });
});
