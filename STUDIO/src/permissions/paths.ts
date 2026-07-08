/**
 * Path-boundary enforcement helpers.
 *
 * Used by the permission engine to answer one question: does a tool's target
 * path fall inside a granted workspace root? The model supplies the path in its
 * arguments; the *allowed roots* come from trusted state. So even if the model
 * lies about intent, it cannot widen its own scope - an out-of-root path is
 * denied regardless of what the tool call claims to be doing.
 *
 * Runs in the Tauri/browser frontend, so we cannot use Node's `path`. Path
 * normalisation is implemented here, cross-platform (Windows + POSIX), and
 * case-insensitive to match Windows filesystem semantics.
 */

// ---------------------------------------------------------------------------
// Which argument holds a filesystem path, per tool
// ---------------------------------------------------------------------------

/**
 * Argument keys that carry a filesystem path across Studio Harness tools.
 * `move_file` uses source+destination; `multi_edit` nests paths under `edits[]`.
 * Unknown keys are ignored - a tool with no extractable path skips the
 * boundary check and falls back to trust/mode enforcement.
 */
const PATH_ARG_KEYS = [
  "path",
  "file_path",
  "file",
  "source",
  "destination",
  "root_dir",
  "workspace_root",
  "dir",
  "cwd",
] as const;

/**
 * Pull every filesystem path a tool call targets out of its arguments.
 * Handles the flat keys above plus the nested `multi_edit` edits array.
 */
export function extractTargetPaths(
  toolName: string,
  args: Record<string, unknown>
): string[] {
  const paths: string[] = [];

  for (const key of PATH_ARG_KEYS) {
    const v = args[key];
    if (typeof v === "string" && v.trim().length > 0) paths.push(v);
  }

  // multi_edit: { edits: [{ path, ... }, ...] }
  if (toolName === "multi_edit" && Array.isArray(args.edits)) {
    for (const edit of args.edits) {
      const p = (edit as Record<string, unknown> | null)?.path;
      if (typeof p === "string" && p.trim().length > 0) paths.push(p);
    }
  }

  return paths;
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/** True for an absolute path on either platform (drive, UNC, or POSIX root). */
export function isAbsolutePath(p: string): boolean {
  return (
    /^[a-zA-Z]:[\\/]/.test(p) || // C:\ or C:/
    /^[\\/]{2}/.test(p) ||       // \\server\share (UNC)
    /^\//.test(p)                // /usr/...
  );
}

/**
 * Normalise a path for comparison:
 *   - backslashes -> forward slashes
 *   - resolve `.` and `..` segments
 *   - drop a trailing slash
 *   - lower-case (Windows filesystems are case-insensitive)
 *
 * Does not touch the disk - pure string math.
 */
export function normalizePath(p: string): string {
  let s = p.replace(/\\/g, "/").trim();

  // Preserve a leading UNC or root marker while we split.
  const uncPrefix = s.startsWith("//") ? "//" : "";
  if (uncPrefix) s = s.slice(2);
  const rooted = s.startsWith("/");

  const out: string[] = [];
  for (const seg of s.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      // Pop unless we'd escape above a relative base (kept, so escapes stay visible).
      if (out.length && out[out.length - 1] !== "..") out.pop();
      else if (!rooted) out.push("..");
      continue;
    }
    out.push(seg);
  }

  let joined = out.join("/");
  if (rooted) joined = "/" + joined;
  return (uncPrefix + joined).toLowerCase() || (rooted ? "/" : "");
}

/**
 * Resolve `target` against `base` when it is relative, then normalise.
 * Absolute targets ignore the base. A relative target with no base is
 * normalised as-is (residual leading `..` remain visible for boundary checks).
 */
export function resolveAgainst(base: string | null, target: string): string {
  if (isAbsolutePath(target) || !base) return normalizePath(target);
  return normalizePath(`${base}/${target}`);
}

// ---------------------------------------------------------------------------
// Boundary check
// ---------------------------------------------------------------------------

/**
 * Is `target` inside (or equal to) any of `roots`?
 * Both sides are normalised; matching is on segment boundaries so
 * `/home/project-x` is NOT considered inside `/home/project`.
 */
export function isPathWithinRoots(target: string, roots: string[]): boolean {
  if (roots.length === 0) return false;
  const t = normalizePath(target);
  return roots.some((root) => {
    const r = normalizePath(root);
    if (!r) return false;
    if (t === r) return true;
    const boundary = r.endsWith("/") ? r : r + "/";
    return t.startsWith(boundary);
  });
}
