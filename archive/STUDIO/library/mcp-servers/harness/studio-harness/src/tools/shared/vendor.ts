/**
 * Vendored binary resolver
 * =========================
 * STUDIO ships some third-party native executables (currently ripgrep) bundled
 * with the app so tools work on machines that don't have them on PATH — notably
 * Windows, where `rg` is not installed by default. Those binaries live in the
 * app-wide vendor folder at the STUDIO project root:
 *
 *     vendor/<tool>/<platform>/<exe>
 *
 * This module locates that folder at runtime — in both dev and packaged builds —
 * and returns the absolute path to a vendored binary when present.
 *
 * Tools use `resolveBinary(name, exe)`:
 *   1. vendored binary  (preferred: always present, known-good version)
 *   2. the bare command  (falls through to a PATH lookup by the caller / spawn)
 * Both are real ripgrep, so search behavior is identical. There is deliberately no
 * pure-JS fallback — the tools run ripgrep or return a clear error, never a
 * silently-diverging search.
 */

import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const PLATFORM = `${process.platform}-${process.arch}`;

interface VendorManifest {
  tools?: Record<
    string,
    { exe?: string; platforms?: Record<string, string> }
  >;
}

/** Absolute path to `library/mcp-servers/vendor`, resolved once and cached. */
let cachedVendorDir: string | null | undefined;

function locateVendorDir(): string | null {
  if (cachedVendorDir !== undefined) return cachedVendorDir;

  // Anchor points to search up from: this module's own location (the bundled
  // dist/index.js) and the entry script node was launched with. In every layout
  // the harness bundle sits at `library/mcp-servers/harness/studio-harness/dist/...`,
  // so the vendor folder is found by walking up from there.
  const anchors: string[] = [];
  try {
    anchors.push(path.dirname(fileURLToPath(import.meta.url)));
  } catch {
    /* import.meta.url unavailable — ignore */
  }
  if (process.argv[1]) anchors.push(path.dirname(path.resolve(process.argv[1])));

  for (const anchor of anchors) {
    // Walk up a few levels looking for a `vendor` dir with our manifest.
    let dir = anchor;
    for (let i = 0; i < 6; i++) {
      const candidate = path.join(dir, "vendor");
      if (existsSync(path.join(candidate, "manifest.json"))) {
        cachedVendorDir = candidate;
        return candidate;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  cachedVendorDir = null;
  return null;
}

let cachedManifest: VendorManifest | null | undefined;

function readManifest(vendorDir: string): VendorManifest | null {
  if (cachedManifest !== undefined) return cachedManifest;
  try {
    cachedManifest = JSON.parse(
      readFileSync(path.join(vendorDir, "manifest.json"), "utf8")
    ) as VendorManifest;
  } catch {
    cachedManifest = null;
  }
  return cachedManifest;
}

/**
 * Resolve a runtime binary.
 *
 * @param tool         key in the vendor manifest, e.g. "ripgrep"
 * @param fallbackCmd  the bare command name to use when no vendored binary is
 *                     found (spawned as-is, so it resolves via PATH). Defaults to
 *                     the manifest `exe` for the tool.
 * @returns the absolute path to the vendored binary if it exists on disk,
 *          otherwise `fallbackCmd`.
 */
export function resolveBinary(tool: string, fallbackCmd: string): string {
  const vendorDir = locateVendorDir();
  if (!vendorDir) return fallbackCmd;

  const manifest = readManifest(vendorDir);
  const entry = manifest?.tools?.[tool];

  // Prefer the manifest's per-platform path; fall back to the conventional
  // `<tool>/<platform>/<exe>` layout so a stale manifest can't break resolution.
  const relFromManifest = entry?.platforms?.[PLATFORM];
  const candidates: string[] = [];
  if (relFromManifest) candidates.push(path.join(vendorDir, relFromManifest));

  const exeBase = entry?.exe ?? fallbackCmd;
  const exeName = process.platform === "win32" ? `${exeBase}.exe` : exeBase;
  candidates.push(path.join(vendorDir, tool, PLATFORM, exeName));

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return fallbackCmd;
}

/** Convenience: resolve the ripgrep binary (vendored → PATH `rg`). */
export function resolveRipgrep(): string {
  return resolveBinary("ripgrep", "rg");
}

// ---------------------------------------------------------------------------
// Git-for-Windows tree
//
// Unlike ripgrep (a single exe), git ships as a directory tree at
// `vendor/git/<platform>/` (git.exe + bash.exe + their libexec/DLLs/usr-bin).
// git.exe and bash.exe resolve their own support files relative to their
// location, so the whole tree must stay intact — we just resolve the two entry
// points inside it.
// ---------------------------------------------------------------------------

/** Absolute path to the vendored git tree for this platform, or null. */
function locateVendoredGitDir(): string | null {
  const vendorDir = locateVendorDir();
  if (!vendorDir) return null;
  const dir = path.join(vendorDir, "git", PLATFORM);
  return existsSync(dir) ? dir : null;
}

/**
 * Resolve the git executable: vendored Git-for-Windows → PATH `git`.
 * On non-Windows platforms nothing is vendored, so this returns `git` (PATH),
 * where git is guaranteed by the OS/toolchain.
 */
export function resolveGit(): string {
  const tree = locateVendoredGitDir();
  if (tree) {
    const exe = path.join(tree, "cmd", "git.exe");
    if (existsSync(exe)) return exe;
  }
  return "git";
}

/**
 * Resolve the vendored Git Bash executable, or null if no vendored tree is
 * present. Windows only — callers use this as the top priority and fall back to
 * a PATH-installed Git Bash before erroring. There is deliberately no cmd.exe
 * fallback: cmd is a divergent shell that mangles quoting/heredocs.
 */
export function resolveVendoredGitBash(): string | null {
  const tree = locateVendoredGitDir();
  if (tree) {
    const exe = path.join(tree, "bin", "bash.exe");
    if (existsSync(exe)) return exe;
  }
  return null;
}
