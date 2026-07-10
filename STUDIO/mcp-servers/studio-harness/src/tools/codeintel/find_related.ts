import { promises as fs } from "fs";
import path from "path";

/**
 * find_related_files — deterministic file adjacency.
 *
 * Given one file, find the files conventionally related to it: co-located
 * tests, styles, type declarations, stories, snapshots, the directory barrel,
 * and the nearest project-config files. This is pure naming/location
 * convention — no semantic model, no index — so it is cheap, exact, and always
 * fresh. For "what implements feature X" use the semantic find_feature_implementation
 * instead; this answers "what sits next to THIS file".
 */

/** Directories we never descend into when scanning for siblings. */
const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "out", "coverage", ".studio"]);
/** Sibling directories that conventionally mirror source (tests live here too). */
const TEST_DIR_NAMES = ["__tests__", "tests", "test", "__mocks__", "__snapshots__"];
const CONFIG_FILES = ["package.json", "tsconfig.json", "jsconfig.json", "pyproject.toml", "Cargo.toml", "go.mod", "vite.config.ts", "vite.config.js"];
const MAX_SCAN_ENTRIES = 4000;

type Relation = "test" | "source" | "style" | "types" | "story" | "snapshot" | "barrel" | "config";

interface Related {
  path: string;
  relation: Relation;
  reason: string;
}

/** Strip known compound test/story/type suffixes to get the logical stem. */
function logicalStem(base: string): { stem: string; isTest: boolean; isStory: boolean } {
  // base has no directory, may still have extension already removed by caller
  let stem = base;
  let isTest = false;
  let isStory = false;
  const m = stem.match(/^(.*?)\.(test|spec|stories|d)$/);
  if (m) {
    stem = m[1];
    if (m[2] === "test" || m[2] === "spec") isTest = true;
    if (m[2] === "stories") isStory = true;
  }
  return { stem, isTest, isStory };
}

function classify(candidateBase: string, ext: string, stem: string): Relation | null {
  const lower = candidateBase.toLowerCase();
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(lower) || /_test\.(py|go|rs)$/.test(lower)) return "test";
  if (/\.stories\.[cm]?[jt]sx?$/.test(lower)) return "story";
  if (lower.endsWith(".snap")) return "snapshot";
  if (/\.d\.ts$/.test(lower)) return "types";
  if (/\.(css|scss|sass|less|styl)$/.test(lower)) return "style";
  const name = candidateBase.slice(0, candidateBase.length - ext.length);
  if (name === "index") return "barrel";
  if (name === stem) return "source";
  return null;
}

async function scanDir(dir: string, budget: { left: number }): Promise<string[]> {
  if (budget.left <= 0) return [];
  let entries: string[] = [];
  try {
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    for (const d of dirents) {
      if (budget.left <= 0) break;
      if (d.isFile()) { entries.push(d.name); budget.left--; }
    }
  } catch { /* unreadable dir — skip */ }
  return entries;
}

export async function findRelatedFiles(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const input = args.file_path as string;
  if (!input || typeof input !== "string") {
    return { error: "find_related_files: 'file_path' (string) is required." };
  }
  const abs = path.resolve(input);
  try {
    const st = await fs.stat(abs);
    if (!st.isFile()) return { error: `find_related_files: '${input}' is not a file. Pass a single source file.` };
  } catch {
    return { error: `find_related_files: file not found: ${input}. Verify the path (use ls or glob).` };
  }

  const dir = path.dirname(abs);
  const base = path.basename(abs);
  const ext = path.extname(base);
  const noExt = base.slice(0, base.length - ext.length);
  const { stem, isTest, isStory } = logicalStem(noExt);

  const budget = { left: MAX_SCAN_ENTRIES };
  const found: Related[] = [];
  const seen = new Set<string>([abs]);

  const add = (filePath: string, relation: Relation, reason: string) => {
    const resolved = path.resolve(filePath);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    found.push({ path: resolved, relation, reason });
  };

  // 1. Same directory: siblings sharing the logical stem.
  for (const name of await scanDir(dir, budget)) {
    if (name === base) continue;
    const cext = path.extname(name);
    const rel = classify(name, cext, stem);
    if (!rel) continue;
    // Only keep siblings that actually relate to this stem (or the dir barrel).
    const cStem = logicalStem(name.slice(0, name.length - cext.length)).stem;
    if (rel === "barrel") { add(path.join(dir, name), "barrel", "directory barrel (index) in the same folder"); continue; }
    if (cStem !== stem) continue;
    add(path.join(dir, name), rel,
      rel === "source" ? "source file with the same name in the same folder"
      : `${rel} for ${stem} in the same folder`);
  }

  // 2. Mirror test/mocks directories under the same folder.
  for (const td of TEST_DIR_NAMES) {
    const mdir = path.join(dir, td);
    for (const name of await scanDir(mdir, budget)) {
      const cext = path.extname(name);
      const cStem = logicalStem(name.slice(0, name.length - cext.length)).stem;
      if (cStem !== stem) continue;
      const rel = classify(name, cext, stem) ?? "test";
      add(path.join(mdir, name), rel === "source" ? "test" : rel, `found in ${td}/ alongside ${stem}`);
    }
  }

  // 3. If this file IS a test/story, point back at the likely source in the parent.
  if ((isTest || isStory) && IGNORE_DIRS.size >= 0) {
    const parent = TEST_DIR_NAMES.includes(path.basename(dir)) ? path.dirname(dir) : dir;
    for (const name of await scanDir(parent, budget)) {
      if (name === base) continue;
      const cext = path.extname(name);
      const cNoExt = name.slice(0, name.length - cext.length);
      if (cNoExt === stem && /\.[cm]?[jt]sx?$/.test(name) && !/\.(test|spec|stories)\./.test(name)) {
        add(path.join(parent, name), "source", `implementation for this ${isStory ? "story" : "test"}`);
      }
    }
  }

  // 4. Nearest project-config files, walking up to the filesystem root.
  const configs: Related[] = [];
  let walk = dir;
  const wantConfigs = new Set(CONFIG_FILES);
  const seenConfig = new Set<string>();
  while (true) {
    for (const cf of wantConfigs) {
      if (seenConfig.has(cf)) continue;
      const p = path.join(walk, cf);
      try {
        const s = await fs.stat(p);
        if (s.isFile()) { seenConfig.add(cf); configs.push({ path: p, relation: "config", reason: `nearest ${cf}` }); }
      } catch { /* not here */ }
    }
    const parent = path.dirname(walk);
    if (parent === walk || seenConfig.size === wantConfigs.size) break;
    walk = parent;
  }

  const groups: Record<string, string[]> = {};
  for (const r of [...found, ...configs]) {
    (groups[r.relation] ??= []).push(r.path);
  }

  return {
    file: abs,
    stem,
    is_test: isTest,
    is_story: isStory,
    related: [...found, ...configs],
    by_relation: groups,
    count: found.length + configs.length,
    note: found.length + configs.length === 0
      ? "No conventionally-related files found. This may be a standalone file; try find_feature_implementation for semantic matches."
      : undefined,
  };
}
