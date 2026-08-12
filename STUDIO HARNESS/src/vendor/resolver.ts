import { statSync } from "node:fs";
import { delimiter, isAbsolute, join, resolve } from "node:path";

import {
  managedBinaryDirectory,
  shippedBinaryDirectory,
} from "../platform/paths.js";
import { VendorError } from "./errors.js";

/**
 * Finds the third-party programs the harness runs.
 *
 * Three places a program can come from, and the order is declared per binary
 * rather than globally, because the right answer genuinely differs:
 *
 * - **shipped** — committed to the repository, in the installation directory.
 *   ripgrep, and only ripgrep: search results that vary with whatever version a
 *   machine happens to have are results that cannot be reproduced.
 * - **system** — the user's own installation, found on PATH. Git, first choice:
 *   it is the copy they maintain, and making a developer download a second one
 *   is rude and doubles the security-update burden.
 * - **managed** — downloaded by us into the user's Studio home, under a
 *   version-stamped directory. Git, as a fallback for a machine without it.
 *
 * Nothing is ever guessed. A missing tool with an actionable message is
 * recoverable; a silently different tool is not.
 */

export type VendorBinaryName = "git" | "rg";

export type BinarySource =
  /** Shipped with the application, reviewed and committed. */
  | "shipped"
  /** The user's own installation, found on PATH. */
  | "system"
  /** Downloaded by us into the user's Studio home. */
  | "managed";

export interface ResolvedBinary {
  readonly name: VendorBinaryName;
  /** Absolute path, which is the only form `runProcess` accepts. */
  readonly path: string;
  readonly source: BinarySource;
}

export interface ResolveBinaryOptions {
  /** Overrides the shipped root. Tests use this; production does not. */
  readonly vendorRoot?: string;
  /** Overrides the managed root. Tests use this; production does not. */
  readonly managedRoot?: string;
  /** Overrides the search path. Tests use this; production does not. */
  readonly searchPath?: string;
}

/**
 * Where each binary may come from, in order.
 *
 * Per binary rather than one global order, because the right answer differs.
 * ripgrep is shipped and nothing else is acceptable — a machine's own copy
 * could be any version, and search results that change between installs cannot
 * be reproduced. Git is the opposite: the user's own installation is the one
 * they maintain and trust, and ours is a fallback for a machine that has none.
 */
const SOURCES: Record<VendorBinaryName, readonly BinarySource[]> = {
  rg: ["shipped"],
  git: ["system", "managed"],
};

/**
 * What to tell the user when a binary is missing.
 *
 * Different tools, different fixes — so this is per binary rather than one
 * generic "not installed" that leaves the user with nowhere to go.
 */
const MISSING_MESSAGE: Record<VendorBinaryName, string> = {
  git: "Git is not available. Install Git, or let Project Studio set it up for you.",
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
 * Where shipped binaries live.
 *
 * Located relative to the installation, **never** relative to the working
 * directory. The harness runs with the user's project as its working directory,
 * so a cwd-relative lookup would let any repository ship its own
 * `vendor/win32-x64/rg.exe` and have us execute it.
 *
 * Outside `src/` on purpose: these are assets, not source, and megabytes of
 * executables inside the tree that typecheck and tests walk slows both down for
 * no benefit.
 */
export function vendorRoot(options: ResolveBinaryOptions = {}): string {
  if (options.vendorRoot !== undefined) return resolve(options.vendorRoot);

  const configured = process.env.PROJECT_STUDIO_VENDOR_DIR;
  if (configured !== undefined && configured.trim() !== "") return resolve(configured);

  return shippedBinaryDirectory();
}

/**
 * Where binaries we downloaded for this user live.
 *
 * In the user's Studio home, because the installation directory is read-only in
 * a packaged build — under `Program Files` on Windows, inside an app bundle
 * elsewhere. Anything acquired at runtime has to live somewhere the user owns.
 */
export function managedRoot(options: ResolveBinaryOptions = {}): string {
  return options.managedRoot !== undefined
    ? resolve(options.managedRoot)
    : managedBinaryDirectory();
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

function findIn(directory: string, name: VendorBinaryName): string | undefined {
  return candidateNames(name)
    .map((candidate) => join(directory, candidate))
    .find(isFile);
}

function findShipped(
  name: VendorBinaryName,
  options: ResolveBinaryOptions,
): string | undefined {
  return findIn(join(vendorRoot(options), platformKey()), name);
}

/**
 * Finds a downloaded binary.
 *
 * Installed under a version-stamped directory, following what comparable tools
 * do, so an upgrade is a new directory rather than an overwrite of a file that
 * may be running. `current` is the pointer the resolver reads.
 */
function findManaged(
  name: VendorBinaryName,
  options: ResolveBinaryOptions,
): string | undefined {
  return findIn(join(managedRoot(options), platformKey(), name, "current"), name);
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
  const overridden =
    options.vendorRoot !== undefined ||
    options.searchPath !== undefined ||
    options.managedRoot !== undefined;
  const cached = overridden ? undefined : cache.get(name);
  if (cached) return cached;

  const lookup: Record<BinarySource, () => string | undefined> = {
    shipped: () => findShipped(name, options),
    system: () => findOnSystem(name, options),
    managed: () => findManaged(name, options),
  };

  let resolved: ResolvedBinary | undefined;
  for (const source of SOURCES[name]) {
    const path = lookup[source]();
    if (path !== undefined) {
      resolved = { name, path, source };
      break;
    }
  }

  if (!resolved) {
    throw new VendorError("not_found", { message: MISSING_MESSAGE[name] });
  }

  if (!overridden) cache.set(name, resolved);
  return resolved;
}

/** Clears the resolution cache. For tests, and for after an on-demand install. */
export function clearBinaryCache(): void {
  cache.clear();
}
