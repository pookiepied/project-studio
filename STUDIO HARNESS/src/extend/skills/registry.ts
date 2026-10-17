import { readdirSync, readFileSync, statSync, type Dirent } from "node:fs";
import { basename, join, relative, sep } from "node:path";

import type { SkillReference } from "@flue/runtime";
import { buildPackagedSkill, createSkillReference, parseSkillMarkdown } from "@flue/runtime/internal";

import { ExtendError } from "../errors.js";
import type { ExtensionSummary } from "../inventory.js";
import { installationRoot, userSkillsDirectory } from "../../platform/paths.js";
import { observeSynchronousOperation } from "../../observability/operation.js";

/**
 * The skills installed on this machine.
 *
 * Installed is the first of the three layers and the only one this file knows
 * about. A skill is installed when `<root>/<name>/SKILL.md` exists and parses;
 * nothing is stored anywhere else, because the folder IS the installation —
 * copying one in installs it and deleting it uninstalls it, which is the shape
 * every other harness that supports the Agent Skills format has settled on,
 * and the shape a person already knows from `~/.claude/skills`. A row in the
 * database saying "this folder exists" would be the system storing what it
 * computes, and it would be wrong the first time the folder moved.
 *
 * **A skill grants nothing.** It is instructions and files. Whether a project
 * gets it is `extension_scope`, and whether any tool it asks the model to use
 * may run is the kernel's, per call, exactly as if no skill existed. The
 * `allowed-tools` field the format allows is parsed and ignored here on
 * purpose: a folder cannot pre-approve anything.
 *
 * **The format is Flue's, not ours.** `SKILL.md` with YAML frontmatter is
 * validated by the same parser Flue runs when a skill is activated, so a
 * skill this registry accepts is one the runtime will accept, and a skill it
 * refuses is refused with the runtime's own sentence. Two parsers would be two
 * opinions about the same file, and the one the person did not see would be
 * the one that failed their turn.
 */

/**
 * Who put this skill here.
 *
 * `system` ships with Project Studio, under the installation; `user` was put
 * in the person's own skills folder. The same two words as an MCP server's
 * provenance, because the question is the same one: whether Studio wrote it.
 */
export type SkillProvenance = "system" | "user";

export interface SkillRecord {
  /** The spec name, which is also the folder name. `create-skill`. */
  readonly id: string;
  /** For a settings row. The name, because the format has no separate title. */
  readonly title: string;
  /** The catalog line: what the skill does and when to reach for it. */
  readonly description: string;
  readonly provenance: SkillProvenance;
  /** The skill's folder, absolute. */
  readonly directory: string;
}

/**
 * A folder that looked like a skill and was not one.
 *
 * Reported rather than thrown, because a person's typo in a frontmatter must
 * never fail a turn or hide every other skill. The settings screen shows
 * these beside the list, with the parser's own sentence, which already says
 * what to fix.
 */
export interface SkillProblem {
  readonly directory: string;
  readonly reason: string;
}

/** One place skills are looked for, and whose the skills found there are. */
export interface SkillRoot {
  readonly directory: string;
  readonly provenance: SkillProvenance;
}

/**
 * The two places skills live, in the order they are trusted.
 *
 * Bundled first, so a user folder that reuses a bundled name is the one that
 * loses: what Studio ships under a name is part of what Studio is, and a
 * folder must not be able to put different words behind it.
 */
export function defaultSkillRoots(): readonly SkillRoot[] {
  return [
    { directory: join(installationRoot(), "skills"), provenance: "system" },
    { directory: userSkillsDirectory(), provenance: "user" },
  ];
}

/**
 * What one packaged skill may weigh.
 *
 * A skill's files ride into the model's environment whole when the skill is
 * mounted, so the caps bound what one folder can cost every conversation that
 * switches it on. Generous for instructions and templates, which is what a
 * skill is; a folder carrying a dataset is not a skill and is refused with a
 * sentence saying so.
 */
const FILE_LIMIT = 1024 * 1024;
const SKILL_LIMIT = 8 * 1024 * 1024;

const SKILL_FILE = "SKILL.md";

interface ScannedSkill {
  readonly record: SkillRecord;
  /** The file's mtime and size, which is what decides whether to re-read. */
  readonly stamp: string;
}

interface PackagedSkill {
  readonly reference: SkillReference;
  /** Every file's path, mtime and size when packaged. */
  readonly stamp: string;
}

export class SkillRegistry {
  readonly #roots: readonly SkillRoot[];
  readonly #scanned = new Map<string, ScannedSkill>();
  readonly #packaged = new Map<string, PackagedSkill>();
  #problems: readonly SkillProblem[] = [];

  constructor(options: { readonly roots?: readonly SkillRoot[] } = {}) {
    this.#roots = options.roots ?? defaultSkillRoots();
  }

  /**
   * Every installed skill, sorted by id, re-read from disk.
   *
   * A scan is stats, not reads: a folder whose `SKILL.md` has the same mtime
   * and size as last time keeps its parsed record. That is what makes calling
   * this on every render affordable, and it is also what makes an edit to a
   * skill show up on the next turn with no restart, which is how the person
   * expects a folder of text files to behave.
   */
  list(): readonly SkillRecord[] {
    const found = new Map<string, SkillRecord>();
    const problems: SkillProblem[] = [];
    const seen = new Set<string>();

    for (const root of this.#roots) {
      for (const directory of subdirectories(root.directory)) {
        const path = join(directory, SKILL_FILE);
        seen.add(path);
        const scanned = this.#scan(directory, path, root.provenance, problems);
        if (scanned === undefined) continue;
        if (found.has(scanned.id)) {
          problems.push({
            directory,
            reason:
              `A skill named "${scanned.id}" is already installed at ` +
              `${found.get(scanned.id)?.directory}. Rename this folder and its ` +
              `frontmatter name to something else.`,
          });
          continue;
        }
        found.set(scanned.id, scanned);
      }
    }

    // A folder that is gone leaves the memo too, so a skill deleted and then
    // recreated with different contents is read afresh rather than answered
    // from the memory of the one that was deleted.
    for (const path of this.#scanned.keys()) {
      if (!seen.has(path)) this.#scanned.delete(path);
    }
    this.#problems = problems;
    return [...found.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  /** The folders the last `list` skipped, and why. */
  problems(): readonly SkillProblem[] {
    return this.#problems;
  }

  get(id: string): SkillRecord | undefined {
    return this.list().find((record) => record.id === id);
  }

  /**
   * The skill as Flue mounts it: its whole folder, packaged.
   *
   * Packaged rather than pointed at, because the folder is outside every
   * sandbox root — a skill in the person's home is not something the model's
   * `read` tool may reach — and Flue's own resource tool reads packaged files
   * without touching the disk. The package's id carries a content hash, so a
   * changed file yields a new reference and Flue treats it as the changed
   * skill it is.
   *
   * Cached by every file's path, mtime and size, which is the cheapest
   * question that answers "did anything under here change". A caller that
   * asks every render pays a directory walk of stats, not a re-read of every
   * file.
   */
  reference(id: string): SkillReference {
    return observeSynchronousOperation("skill", "skill.package", () => this.#reference(id));
  }

  #reference(id: string): SkillReference {
    const record = this.get(id);
    if (record === undefined) {
      throw new ExtendError("not_installed", {
        message: `No skill named "${id}" is installed.`,
      });
    }

    const files = collectFiles(record.directory);
    const stamp = files.map((file) => `${file.relativePath}:${file.mtime}:${file.size}`).join("\n");
    const cached = this.#packaged.get(id);
    if (cached !== undefined && cached.stamp === stamp) return cached.reference;

    let total = 0;
    const contents: { path: string; content: Uint8Array }[] = [];
    for (const file of files) {
      if (file.size > FILE_LIMIT) {
        throw new ExtendError("internal", {
          message:
            `The skill "${id}" has a file over 1 MB (${file.relativePath}). ` +
            "A skill is instructions and templates; move large files elsewhere.",
        });
      }
      total += file.size;
      if (total > SKILL_LIMIT) {
        throw new ExtendError("internal", {
          message:
            `The skill "${id}" is over 8 MB in total. A skill is instructions ` +
            "and templates; move large files elsewhere.",
        });
      }
      contents.push({ path: file.relativePath, content: readFileSync(file.absolutePath) });
    }

    const reference = createSkillReference(
      buildPackagedSkill({ name: record.id, description: record.description, files: contents }),
    );
    this.#packaged.set(id, { reference, stamp });
    return reference;
  }

  /** What the spine needs, and nothing a kind-agnostic reader could misuse. */
  asExtensions(): readonly ExtensionSummary[] {
    return this.list().map((record) => ({
      id: record.id,
      title: record.title,
      author: record.provenance === "system" ? "studio" : "third-party",
    }));
  }

  /** The id the way an extension is spelled beside an MCP server's `mcp:<id>`. */
  static namespaceOf(id: string): string {
    return `skill:${id}`;
  }

  #scan(
    directory: string,
    path: string,
    provenance: SkillProvenance,
    problems: SkillProblem[],
  ): SkillRecord | undefined {
    let stamp: string;
    try {
      const stat = statSync(path);
      if (!stat.isFile()) return undefined;
      stamp = `${stat.mtimeMs}:${stat.size}`;
    } catch {
      // A folder with no SKILL.md is not a skill and not a problem: the
      // format says so, and a person keeping notes beside their skills
      // should not be told off for it.
      return undefined;
    }

    const cached = this.#scanned.get(path);
    if (cached !== undefined && cached.stamp === stamp) return cached.record;

    try {
      const parsed = parseSkillMarkdown(readFileSync(path, "utf8"), {
        directoryName: basename(directory),
        path,
      });
      const record: SkillRecord = {
        id: parsed.name,
        title: parsed.name,
        description: parsed.description,
        provenance,
        directory,
      };
      this.#scanned.set(path, { record, stamp });
      return record;
    } catch (error) {
      this.#scanned.delete(path);
      problems.push({
        directory,
        // Flue prefixes its own sentences with the package name, which means
        // nothing to the person reading a settings row.
        reason: (error instanceof Error ? error.message : String(error)).replace(/^\[flue\] /, ""),
      });
      return undefined;
    }
  }
}

/** The immediate subdirectories of a root, or none when the root is absent. */
function subdirectories(root: string): readonly string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => join(root, entry.name))
    .sort();
}

interface CollectedFile {
  readonly absolutePath: string;
  /** Forward slashes, which is what a packaged skill and its resource tool expect. */
  readonly relativePath: string;
  readonly mtime: number;
  readonly size: number;
}

/**
 * Every regular file under a skill folder, in a stable order.
 *
 * Dotfiles and symbolic links are left out. A dotfile is an editor's or a
 * version control's, not the skill's; a symbolic link is a way for a folder
 * in the person's home to reach a file that is not in it, and the package is
 * supposed to be exactly the folder.
 */
function collectFiles(root: string): readonly CollectedFile[] {
  const files: CollectedFile[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = statSync(absolutePath);
      files.push({
        absolutePath,
        relativePath: relative(root, absolutePath).split(sep).join("/"),
        mtime: stat.mtimeMs,
        size: stat.size,
      });
    }
  };
  walk(root);
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}
