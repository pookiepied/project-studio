import { statSync } from "node:fs";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { VendorError } from "./errors.js";

/**
 * Finds the third-party programs the harness runs.
 *
 * Precedence is fixed and deliberate: **vendored, then system, then a clear
 * refusal.** A vendored copy wins so behaviour is the version we tested against
 * rather than whatever the machine happens to have; the system copy is
 * consulted so a developer who already has git is not made to download a second
 * one; and nothing is ever guessed, because a missing tool with a good message
 * is recoverable and a silently different tool is not.
 *
 * Which slots are actually filled is a packaging decision, not a code one — see
 * ADR 0013. Today ripgrep is vendored and git is resolved from the system.
 */

export type VendorBinaryName = "git" | "rg";

export type BinarySource = "vendored" | "system";

export interface ResolvedBinary {
  readonly name: VendorBinaryName;
  /** Absolute path, which is the only form `runProcess` accepts. */
  readonly path: string;
  readonly source: BinarySource;
}

export interface ResolveBinaryOptions {
  /** Overrides the vendor root. Tests use this; production does not. */
  readonly vendorRoot?: string;
  /** Overrides the search path. Tests use this; production does not. */
  readonly searchPath?: string;
}

/**
 * What to tell the user when a binary is missing.
 *
 * Different tools, different fixes — so this is per binary rather than one
 * generic "not installed" that leaves the user with nowhere to go.
 */
const MISSING_MESSAGE: Record<VendorBinaryName, string> = {
  git: "Git is not installed. Install Git for Windows, then reopen the project.",
  rg: "The search program is missing from this installation of Project Studio.",
};

/** Only the extensions `runProcess` is willing to spawn without a shell. */
const WINDOWS_EXTENSIONS = [".exe", ".com"] as const;

const cache = new Map<string, ResolvedBinary>();

/** `win32-x64`. Vendored builds are per platform and per architecture. */
export function platformKey(): string {
  return `${process.platform}-${process.arch}`;
}

/**
 * Where vendored binaries live.
 *
 * Located relative to this module, **never** relative to the working directory.
 * The harness runs with the user's project as its working directory, so a
 * cwd-relative lookup would let any repository ship its own `vendor/win32-x64/
 * rg.exe` and have us execute it. A shipped asset belongs to the installation,
 * not to whatever happens to be open.
 *
 * Outside `src/` on purpose: these are assets, not source, and megabytes of
 * executables inside the tree that typecheck and tests walk slows both down for
 * no benefit.
 */
export function vendorRoot(options: ResolveBinaryOptions = {}): string {
  if (options.vendorRoot !== undefined) return resolve(options.vendorRoot);

  const configured = process.env.PROJECT_STUDIO_VENDOR_DIR;
  if (configured !== undefined && configured.trim() !== "") return resolve(configured);

  // `src/vendor/` and `dist/vendor/` both sit one level below the package root.
  return resolve(fileURLToPath(new URL("../../vendor/", import.meta.url)));
}

/** True when the path is a real file we could hand to the OS. */
function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function candidateNames(name: VendorBinaryName): readonly string[] {
  if (process.platform !== "win32") return [name];
  return WINDOWS_EXTENSIONS.map((extension) => `${name}${extension}`);
}

function findVendored(
  name: VendorBinaryName,
  options: ResolveBinaryOptions,
): string | undefined {
  const directory = join(vendorRoot(options), platformKey());
  return candidateNames(name)
    .map((candidate) => join(directory, candidate))
    .find(isFile);
}

function findOnSystem(
  name: VendorBinaryName,
  options: ResolveBinaryOptions,
): string | undefined {
  // Reading PATH here is *locating* a program, which is a different act from
  // handing PATH to a child. `runProcess` still refuses to pass it on.
  const searchPath = options.searchPath ?? process.env.PATH ?? "";

  for (const entry of searchPath.split(delimiter)) {
    const directory = entry.trim().replace(/^"|"$/g, "");
    if (directory === "" || !isAbsolute(directory)) continue;

    for (const candidate of candidateNames(name)) {
      const path = join(directory, candidate);
      if (isFile(path)) return path;
    }
  }

  return undefined;
}

/**
 * Resolves a binary, or refuses with a message the user can act on.
 *
 * Results are cached: this walks the whole of PATH, and every git call would
 * otherwise repeat that walk.
 */
export function resolveBinary(
  name: VendorBinaryName,
  options: ResolveBinaryOptions = {},
): ResolvedBinary {
  const overridden = options.vendorRoot !== undefined || options.searchPath !== undefined;
  const cached = overridden ? undefined : cache.get(name);
  if (cached) return cached;

  const vendored = findVendored(name, options);
  const path = vendored ?? findOnSystem(name, options);

  if (path === undefined) {
    throw new VendorError("not_found", { message: MISSING_MESSAGE[name] });
  }

  const resolved: ResolvedBinary = {
    name,
    path,
    source: vendored === undefined ? "system" : "vendored",
  };

  if (!overridden) cache.set(name, resolved);
  return resolved;
}

/** Clears the resolution cache. For tests, and for after an on-demand install. */
export function clearBinaryCache(): void {
  cache.clear();
}
