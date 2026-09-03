import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every module is in the built bundle exactly once.
 *
 * This exists because of one bug that no other test in this repository could
 * have caught. `@flue/vite` generates its scanned `'use agent'` module by
 * importing each agent file by an absolute path with forward slashes, while
 * every ordinary relative import of the same file resolved, on Windows, to
 * the same path with backslashes. Rolldown keys modules by that string, so
 * `src/agents/title.ts` and `src/agents/studio.ts` were each bundled TWICE -
 * and the copy the build registered as an agent was not the copy the
 * application code imported.
 *
 * `dispatch()` resolves its target by function value, so every automatic
 * title died at "target agent is not registered in this built application",
 * silently, for as long as the migration had been running. Nothing was
 * detectable in source: every source file was correct, every type checked,
 * and every unit test passed against modules loaded by Node's resolver
 * rather than the bundler's. The defect existed only in the artifact.
 *
 * So the artifact is what is checked. A duplicated module is never
 * intentional here - it is dead weight at best and split module state at
 * worst - and the assertion is the whole bundle rather than the two agent
 * files, because the next module to be split this way will not be an agent.
 *
 * `pnpm test` builds before it runs, which is how this test has a bundle to
 * read. Run bare, it says so rather than passing on nothing.
 */

const DIST = join(import.meta.dirname, "..", "..", "dist");

/** Every source path named by every emitted sourcemap, chunk by chunk. */
function bundledSources(): { chunk: string; sources: readonly string[] }[] {
  const maps = readdirSync(DIST).filter((name) => name.endsWith(".mjs.map"));
  return maps.map((name) => {
    const parsed: unknown = JSON.parse(readFileSync(join(DIST, name), "utf8"));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("sources" in parsed) ||
      !Array.isArray(parsed.sources)
    ) {
      throw new Error(`${name} is not a sourcemap with a sources array.`);
    }
    const sources = parsed.sources.filter(
      (source): source is string => typeof source === "string",
    );
    return { chunk: name, sources };
  });
}

describe("the built bundle", () => {
  it("carries each of our modules exactly once", () => {
    expect(
      existsSync(DIST),
      "dist/ is missing: build first (`pnpm build`), or run `pnpm test`, " +
        "which builds. This test reads the artifact, not the source.",
    ).toBe(true);

    const chunks = bundledSources();
    expect(chunks.length).toBeGreaterThan(0);

    const duplicated: string[] = [];
    for (const { chunk, sources } of chunks) {
      const seen = new Set<string>();
      for (const source of sources) {
        // Dependencies are not ours to police, and a package legitimately
        // shipping two builds of one file is its own business.
        if (source.includes("node_modules")) continue;
        if (seen.has(source)) duplicated.push(`${chunk}: ${source}`);
        seen.add(source);
      }
    }

    expect(duplicated).toEqual([]);
  });

  it("registers the agents our own code dispatches to", () => {
    const chunks = bundledSources();
    const ours = chunks.flatMap(({ sources }) =>
      sources.filter((source) => !source.includes("node_modules")),
    );

    // Both agent modules are in the bundle, and the previous test is what
    // says each is there once. Named individually because these two are the
    // ones a duplicate actually breaks: the title agent is reached only by
    // `dispatch()`, which compares function values.
    expect(ours.filter((source) => source.endsWith("src/agents/title.ts"))).toHaveLength(1);
    expect(ours.filter((source) => source.endsWith("src/agents/studio.ts"))).toHaveLength(1);
  });
});
