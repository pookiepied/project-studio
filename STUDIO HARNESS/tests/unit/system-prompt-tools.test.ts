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
 * What is asserted is only that each name appears in the list. How the prompt
 * describes a tool is prose and belongs to whoever writes it; that the prompt
 * knows the tool exists is a fact, and facts are what a test is for.
 */

// `fileURLToPath`, not `.pathname`: this repository's path contains spaces,
// and a URL's pathname keeps them percent-encoded.
const TOOLS_ROOT = fileURLToPath(new URL("../../src/tools/", import.meta.url));

/**
 * The tool names the prompt's own list names.
 *
 * Parsed, not searched for. Most of these names are ordinary English - read,
 * write, plan, git, edit - so a substring check over the whole prompt would
 * pass on prose that has nothing to do with the tool list, which is exactly
 * the drift this is meant to catch.
 */
function listedTools(): readonly string[] {
  const names = new Set<string>();
  for (const line of STUDIO_SYSTEM_PROMPT.split(String.fromCharCode(10))) {
    const match = /^\*\*([a-z_]+)\*\* - /.exec(line);
    if (match?.[1] !== undefined) names.add(match[1]);
  }
  return [...names];
}

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
  it("names every native tool that exists, in the list itself", () => {
    const declared = [...new Set(declaredNativeTools(TOOLS_ROOT))].sort();

    // A guard on the guard: if the scan finds nothing, the loop below passes
    // vacuously and the test is decoration.
    expect(declared.length).toBeGreaterThanOrEqual(11);
    expect(declared).toContain("shell");

    // `task` is the one name this file contributes itself: the framework's
    // tool, not a native capability under src/tools, but the prompt's
    // Delegation section describes it with the same **name** - list form so
    // the model scans it the same way. Everything else must come from the
    // descriptors on disk.
    const withFrameworkTask = [...new Set([...declared, "task"])].sort();
    expect([...listedTools()].sort()).toEqual(withFrameworkTask);
  });

  it("does not describe a subagent surface this harness does not have", () => {
    // The task tool is framework-owned and always present; with a delegate
    // registered (Stage 3's `explore`), the prompt must describe the
    // delegation surface and teach the briefing discipline, and it must
    // not carry the old "declares no subagents" paragraph that would tell
    // the model the tool has nothing to be called with while Flue composes
    // a roster behind it. The roster itself (which agent is available) is
    // Flue's `## Available Agents` section, composed per render - this
    // prompt owns the how-to, not the who.
    expect(STUDIO_SYSTEM_PROMPT).toContain("## Delegation");
    expect(STUDIO_SYSTEM_PROMPT).toContain("self-contained briefing");
    expect(STUDIO_SYSTEM_PROMPT).toContain("Available Agents");
    expect(STUDIO_SYSTEM_PROMPT).not.toContain("declares no");
  });
});
