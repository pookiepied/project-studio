import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { STUDIO_SYSTEM_PROMPT } from "../../src/context/system-prompt.js";

/**
 * The prompt's account of the tools, against the tools that actually exist.
 *
 * This test exists because the account went stale and nothing noticed. Two
 * tool families shipped - the ask family and the plan family - while the
 * prompt still said "five families" and named neither, so every conversation
 * was told about a tool array that did not match the one it was given. A model
 * reads that account to decide what it can do; a tool missing from it is a
 * tool reached for late or not at all.
 *
 * The tool names are discovered by scanning the source rather than imported
 * from a hand-kept array, because a hand-kept array is the same kind of thing
 * that drifted in the first place. Add a native tool anywhere under
 * `src/tools/` and this test asks for it to be accounted for.
 *
 * ---- Why there is a phrase table --------------------------------------------
 *
 * The prompt used to carry a bullet list of families, and this test parsed it.
 * The list is gone: the prompt now describes the tools in prose, which reads
 * better and matches the rule stated in its own header comment that concrete
 * lists appear only for closed sets. Prose means some tools are named by their
 * literal name (glob, grep, read, edit, write, shell, git) and some by the
 * words a person would use (the web tools, the question tool, the plan tool).
 *
 * So each tool declares how the prompt is allowed to refer to it. That table
 * is hand-kept, which is the thing this test was built to distrust - but the
 * property that matters survives, because the *left* side is still scanned.
 * A new native tool arrives with no entry and fails here, and the only way to
 * pass is to add the entry and mention the tool. What the table cannot catch
 * is a tool removed from the prompt while its phrase happens to appear in
 * ordinary prose elsewhere, which is why the phrases are specific rather than
 * bare words: "read" appears everywhere, "with read" does not.
 */

// `fileURLToPath`, not `.pathname`: this repository's path contains spaces,
// and a URL's pathname keeps them percent-encoded.
const TOOLS_ROOT = fileURLToPath(new URL("../../src/tools/", import.meta.url));

/**
 * How the prompt is allowed to refer to each native tool.
 *
 * One phrase must appear verbatim. Chosen to be unambiguous in a document
 * that is otherwise full of the words "read", "write", "plan" and "git" used
 * in their ordinary English senses.
 */
const PHRASES: Readonly<Record<string, readonly string[]>> = {
  glob: ["by name with glob"],
  grep: ["by content with grep"],
  read: ["examine one with read"],
  edit: ["**edit changes part; write makes whole.**"],
  write: ["**edit changes part; write makes whole.**", "with the write tool"],
  shell: ["run with shell whatever none of these cover"],
  git: ["**Repository work goes through git.**"],
  web_search: ["web search and\nfetching", "the web tools for anything outside this machine"],
  fetch: ["web search and\nfetching", "the web tools for anything outside this machine"],
  ask_user_question: ["**The question tool.**"],
  plan: ["**The plan tool.**"],
};

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

describe("the prompt's account of the tools", () => {
  it("accounts for every native tool that exists", () => {
    const declared = [...new Set(declaredNativeTools(TOOLS_ROOT))].sort();

    // A guard on the guard: if the scan finds nothing, the loop below passes
    // vacuously and the test is decoration.
    expect(declared.length).toBeGreaterThanOrEqual(11);
    expect(declared).toContain("shell");

    const unaccounted = declared.filter((name) => {
      const phrases = PHRASES[name];
      if (phrases === undefined) return true;
      return !phrases.some((phrase) => STUDIO_SYSTEM_PROMPT.includes(phrase));
    });
    expect(unaccounted).toEqual([]);
  });

  it("keeps the phrase table to tools that exist", () => {
    // The other direction. A tool deleted from the codebase leaves an entry
    // here claiming the prompt must still describe it, and a prompt that
    // describes a tool nobody has is the same failure pointing the other way.
    const declared = new Set(declaredNativeTools(TOOLS_ROOT));
    expect(Object.keys(PHRASES).filter((name) => !declared.has(name))).toEqual([]);
  });

  it("does not describe a subagent surface this harness does not have", () => {
    // The task tool is framework-owned and always present, and this harness
    // registers no subagents for it. The prompt says so; if that sentence goes
    // while the situation holds, a model spends calls on a tool that cannot
    // be called with anything.
    expect(STUDIO_SYSTEM_PROMPT).toContain("this harness declares no");
  });
});
