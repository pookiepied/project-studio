import { existsSync, statSync } from "node:fs";
import { isAbsolute, normalize, resolve, sep } from "node:path";

import { StorageError } from "../storage/errors.js";

/**
 * The two levers, kept apart on purpose.
 *
 * Scope is which paths a project may read and write beyond its own folder -
 * additive, per path, each one a decision the person made and can unmake.
 * Level is whether the project is contained at all - `contained` (the
 * default) or `trusted`, the escape hatch for the walk-up class and for
 * Docker. Docker belongs under level, not under scope: a contained process
 * that can reach the Docker daemon can mount any path on the machine, so a
 * Docker path preset would be a containment bypass wearing a preset's
 * clothes.
 */

export type SandboxScopeMode = "read" | "write";
export type SandboxScopeSource = "preset" | "custom" | "question";
export type SandboxLevel = "contained" | "trusted";

export interface SandboxScopeRow {
  readonly projectId: string;
  readonly path: string;
  readonly mode: SandboxScopeMode;
  readonly source: SandboxScopeSource;
  readonly presetId: string | null;
  readonly grantedAt: number;
}

const MODES: readonly SandboxScopeMode[] = ["read", "write"];
const SOURCES: readonly SandboxScopeSource[] = ["preset", "custom", "question"];
const LEVELS: readonly SandboxLevel[] = ["contained", "trusted"];

/**
 * The absolute, normalized form of a scope path.
 *
 * Scope paths are absolute by construction: the sandbox resolves them the
 * same way it resolves every other root, and a relative scope would mean
 * something different depending on where the harness was launched from.
 */
export function normalizeScopePath(path: string): string {
  return resolve(normalize(path));
}

/**
 * Whether a path is a volume root or a system directory, and therefore not
 * a scope.
 *
 * A grant on those is not a scope, it is the end of containment, and the
 * person who wants that wants `trusted` instead. The message says so, so
 * the refusal points at the lever that actually answers the want.
 */
export function systemScopeRefusal(path: string): string | undefined {
  const absolute = normalizeScopePath(path);
  const lower = process.platform === "win32" ? absolute.toLowerCase() : absolute;
  const equals = (candidate: string): boolean => {
    const normalized = process.platform === "win32" ? candidate.toLowerCase() : candidate;
    return lower === normalized;
  };
  const inside = (candidate: string): boolean => {
    const normalized = process.platform === "win32" ? candidate.toLowerCase() : candidate;
    if (lower === normalized) return true;
    return lower.startsWith(`${normalized}${sep}`);
  };

  if (process.platform === "win32") {
    const driveRoot = /^([a-z]:\\?)$/i.exec(absolute);
    if (driveRoot !== null) {
      return (
        `That path is a volume root (${absolute}), and granting it would end ` +
        `containment rather than widen it. Use trusted for this project instead.`
      );
    }
    const systemRoot = (process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows").replace(
      /\\$/,
      "",
    );
    if (equals(systemRoot) || inside(systemRoot)) {
      return (
        `That path is inside the Windows system directory (${systemRoot}), and ` +
        `granting it would end containment rather than widen it. Use trusted ` +
        `for this project instead.`
      );
    }
    return undefined;
  }

  if (absolute === "/") {
    return (
      `That path is the filesystem root (/), and granting it would end ` +
      `containment rather than widen it. Use trusted for this project instead.`
    );
  }
  for (const guarded of ["/etc", "/usr", "/bin", "/sbin", "/boot", "/sys", "/proc", "/dev"]) {
    if (equals(guarded) || inside(guarded)) {
      return (
        `That path is inside the system directory (${guarded}), and granting ` +
        `it would end containment rather than widen it. Use trusted for this ` +
        `project instead.`
      );
    }
  }
  return undefined;
}

/**
 * Validates a custom scope path before it is stored.
 *
 * The path must exist, must be absolute, and must not be a volume root or a
 * system directory. The existence check is deliberate: a preset with a wrong
 * path either grants something nobody intended or silently grants nothing
 * while looking correct, and the person cannot tell which - so a custom path
 * that names nothing is refused rather than stored.
 */
export function validateCustomScopePath(
  path: string,
  exists: (path: string) => boolean = defaultExists,
): string {
  if (typeof path !== "string" || path.trim() === "") {
    throw new StorageError("invalid", { message: "A scope path is required." });
  }
  if (!isAbsolute(path)) {
    throw new StorageError("invalid", {
      message: `That path is not absolute (${path}). A scope names an absolute directory.`,
    });
  }
  const absolute = normalizeScopePath(path);
  const refusal = systemScopeRefusal(absolute);
  if (refusal !== undefined) {
    throw new StorageError("invalid", { message: refusal });
  }
  if (!exists(absolute)) {
    throw new StorageError("invalid", {
      message: `That path does not exist (${absolute}). A scope names a directory that is there.`,
    });
  }
  return absolute;
}

function defaultExists(path: string): boolean {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}

/**
 * Validates a project folder path before it is stored.
 *
 * A folder row is what a turn binds sandbox roots from, so the same bar a
 * scope path clears applies here: absolute, real on this machine, and not a
 * volume root or system directory. This is a sibling of
 * `validateCustomScopePath` rather than a call into it for two reasons: a
 * folder must be a *directory*, which the scope check does not ask, and its
 * refusals should speak of folders, not scopes. The one rule that must not
 * drift - which paths are the end of containment - stays shared, through
 * `systemScopeRefusal`.
 *
 * Returns the normalized absolute form, which is what the store keeps.
 */
export function validateFolderPath(
  path: string,
  stat: (path: string) => { isDirectory(): boolean } | undefined = defaultStat,
): string {
  if (typeof path !== "string" || path.trim() === "") {
    throw new StorageError("invalid", { message: "A project folder path is required." });
  }
  if (!isAbsolute(path)) {
    throw new StorageError("invalid", {
      message: `That path is not absolute (${path}). A project folder names an absolute directory.`,
    });
  }
  const absolute = normalizeScopePath(path);
  const refusal = systemScopeRefusal(absolute);
  if (refusal !== undefined) {
    throw new StorageError("invalid", { message: refusal });
  }
  const found = stat(absolute);
  if (found === undefined) {
    throw new StorageError("invalid", {
      message: `That path does not exist (${absolute}). A project folder names a directory that is there.`,
    });
  }
  if (!found.isDirectory()) {
    throw new StorageError("invalid", {
      message: `That path is not a directory (${absolute}). A project folder names a directory.`,
    });
  }
  return absolute;
}

function defaultStat(path: string): { isDirectory(): boolean } | undefined {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
}

export function readScopeMode(value: unknown): SandboxScopeMode {
  for (const mode of MODES) {
    if (value === mode) return mode;
  }
  throw new StorageError("invalid", { message: "A scope mode is read or write." });
}

export function readScopeSource(value: unknown): SandboxScopeSource {
  for (const source of SOURCES) {
    if (value === source) return source;
  }
  throw new StorageError("invalid", { message: "A scope source is preset, custom, or question." });
}

export function readSandboxLevel(value: unknown): SandboxLevel {
  for (const level of LEVELS) {
    if (value === level) return level;
  }
  return "contained";
}
