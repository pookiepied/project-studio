import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { SandboxError } from "./errors.js";

/**
 * Deciding whether a path is inside a root.
 *
 * This is the load-bearing primitive of local containment, so it is written
 * against the ways the check is normally got wrong rather than against the
 * happy path:
 *
 * - **String prefixes are not containment.** `/work` is a prefix of
 *   `/work-secrets`, so `startsWith` lets an agent out of its workspace by
 *   naming a sibling directory. Containment is a path-segment relationship.
 * - **`..` must be resolved before comparing**, not rejected by pattern. A
 *   check that greps for `..` misses `a/b/../../..` written as separate
 *   segments and misses absolute paths entirely.
 * - **Symlinks escape a purely lexical check.** A link inside the workspace
 *   pointing at `~/.ssh` resolves lexically to an inside path and physically
 *   to an outside one, so the real path is checked too.
 * - **Windows compares case-insensitively.** `C:\Work` and `c:\work` are the
 *   same directory, and a case-sensitive comparison would report an inside
 *   path as an escape.
 */

const WINDOWS = process.platform === "win32";

function normalizeForCompare(path: string): string {
  return WINDOWS ? path.toLowerCase() : path;
}

/**
 * True when `candidate` is `root` or sits beneath it.
 *
 * Compared through `relative()` so the answer is about path segments: an
 * outside path yields a result that either escapes upward or is absolute,
 * neither of which a contained path can produce.
 */
export function isInsideRoot(root: string, candidate: string): boolean {
  const from = normalizeForCompare(resolve(root));
  const to = normalizeForCompare(resolve(candidate));

  if (from === to) return true;

  const difference = relative(from, to);
  if (difference === "") return true;

  // A path that has to go up, or that is absolute, left the root. On Windows a
  // different drive letter also yields an absolute result, which is correct:
  // `D:\x` is not inside `C:\work`.
  return (
    !difference.startsWith("..") &&
    !difference.startsWith(`..${sep}`) &&
    !isAbsolute(difference)
  );
}

/**
 * Resolves a requested path against the workspace and proves it is contained.
 *
 * A relative path is resolved against `root` rather than the process working
 * directory: the agent's idea of "here" is its workspace, and inheriting
 * `process.cwd()` would silently change what a path means depending on where
 * the harness was launched.
 */
export function resolveContainedPath(
  root: string,
  requested: string,
  roots: readonly string[] = [root],
): string {
  if (typeof requested !== "string" || requested.trim() === "") {
    throw new SandboxError("path_escape", {
      message: "A file path is required.",
    });
  }

  // Windows device paths (`\\?\`, `\\.\`) and UNC shares bypass normal path
  // semantics, so they are refused outright rather than reasoned about.
  if (WINDOWS && /^\\\\[?.]\\/.test(requested)) {
    throw new SandboxError("path_escape");
  }

  const absolute = isAbsolute(requested)
    ? resolve(requested)
    : resolve(root, requested);

  const allowed = roots.length > 0 ? roots : [root];
  if (!allowed.some((entry) => isInsideRoot(entry, absolute))) {
    throw new SandboxError("path_escape");
  }

  // The lexical answer is not the final answer: a symlink inside the workspace
  // can point anywhere. `realpath` only works on paths that exist, so a
  // not-yet-created file is checked through its nearest existing ancestor —
  // which is the directory the write would actually land in.
  const real = realpathOfNearestExisting(absolute);
  if (real !== undefined && !allowed.some((entry) => isInsideRealRoot(entry, real))) {
    throw new SandboxError("path_escape");
  }

  return absolute;
}

/** Resolves the root itself through symlinks before comparing. */
function isInsideRealRoot(root: string, realCandidate: string): boolean {
  let realRoot: string;
  try {
    realRoot = realpathSync(resolve(root));
  } catch {
    realRoot = resolve(root);
  }
  return isInsideRoot(realRoot, realCandidate);
}

function realpathOfNearestExisting(absolute: string): string | undefined {
  let current = absolute;

  for (;;) {
    try {
      return realpathSync(current);
    } catch {
      const parent = resolve(current, "..");
      // Reached the filesystem root without finding anything that exists.
      if (parent === current) return undefined;
      current = parent;
    }
  }
}
