import { statSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

/**
 * The permission name of a program the shell runs.
 *
 * This file used to resolve the program the model named, and to refuse
 * `.cmd`, `.bat`, and `.ps1` shims - `npm`, `pnpm`, `yarn`, and `tsc` could
 * not run at all on Windows. ADR 0046 inverted that: the tool takes a command
 * line, an interpreter chosen in `src/process/interpreter.ts` runs it, and
 * what is approved is the *name* of every program the line starts, read by
 * `command.ts`. What came back with ADR 0047 is a narrower job than the old
 * one, for a reason the old one never had: a contained interpreter finds its
 * programs itself, through the PATH the policy granted, and can only find one
 * in a directory the container may read. So the shell resolves each name the
 * line runs through that same PATH - not to decide anything about the
 * program, which stays the interpreter's job - but to know which directories
 * containment must make readable before the line can run at all.
 */

/** `shell:npm`. Matches the `git:push` shape so one rule syntax covers both. */
export function shellResource(name: string): string {
  return `shell:${name.toLowerCase()}`;
}

/** The directories a line's programs live in, and the names nothing answered. */
export interface ResolvedProgramRoots {
  /**
   * The directory of every program that resolved, deduplicated in the order
   * the line named them. These are read grants, never write.
   */
  readonly directories: readonly string[];
  /**
   * Names that no PATH entry answered. Left to the interpreter, which runs
   * builtins without touching the disk and answers a genuine typo with its
   * own `not recognized` - the one case where that sentence is honest.
   */
  readonly unresolved: readonly string[];
}

/** PATH entries that are not absolute, quoted or otherwise unusable. */
function usableEntries(searchPath: string): readonly string[] {
  return searchPath
    .split(delimiter)
    .map((entry) => entry.trim().replace(/^"|"$/g, ""))
    .filter((entry) => entry !== "" && isAbsolute(entry));
}

/**
 * Where each program a command line runs lives, found the way its
 * interpreter will find it.
 *
 * The walk is the shell's own: every PATH entry, then the program's name as
 * written and then with each `PATHEXT` extension, first hit wins. It is not
 * smarter than that on purpose - App Paths, aliases, and per-shell resolution
 * are things this resolver must not guess at, because what it resolves becomes
 * a grant, and a grant built from a guess widens a wall around the wrong
 * directory.
 *
 * A program the sandbox already reaches needs no grant, and a directory
 * that would be granted to find a program the interpreter runs as a builtin
 * is not a program at all - which is why the unresolved names are returned
 * rather than refused here.
 */
export function programDirectories(
  programs: readonly string[],
  searchPath: string,
  pathExt: string | undefined,
): ResolvedProgramRoots {
  const entries = usableEntries(searchPath);
  const extensions =
    process.platform === "win32"
      ? ["", ...(pathExt ?? "").split(";").map((entry) => entry.trim()).filter((entry) => entry !== "")]
      : [""];

  const directories: string[] = [];
  const unresolved: string[] = [];
  const seen = new Set<string>();

  for (const name of programs) {
    let directory: string | undefined;
    for (const entry of entries) {
      for (const extension of extensions) {
        const candidate = join(entry, `${name}${extension}`);
        if (isFile(candidate)) {
          directory = entry;
          break;
        }
      }
      if (directory !== undefined) break;
    }

    if (directory === undefined) {
      unresolved.push(name);
      continue;
    }
    if (!seen.has(directory)) {
      seen.add(directory);
      directories.push(directory);
    }
  }

  return { directories, unresolved };
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
