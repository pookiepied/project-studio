#!/usr/bin/env node
/**
 * vendor-sync — populate vendor/ with the bundled runtime binaries STUDIO ships.
 *
 * STUDIO bundles a small set of native third-party executables so the harness
 * tools work identically on every machine, including ones that don't have them
 * on PATH (notably Windows). This script is the single, reproducible way to
 * obtain/refresh those binaries. It fetches each tool from a pinned upstream
 * source and writes it into the canonical vendor layout:
 *
 *     vendor/<tool>/<platform>/...
 *
 * where <platform> is `${process.platform}-${process.arch}` (win32-x64, etc.).
 *
 * Two tools, one pipeline (both resolved at runtime by tools/shared/vendor.ts):
 *
 *   ripgrep  — a single prebuilt binary, copied from the @vscode/ripgrep npm
 *              package → vendor/ripgrep/<platform>/rg[.exe]
 *   git      — Git for Windows (PortableGit): a self-contained tree that also
 *              provides Git Bash + the POSIX toolchain. Downloaded from a pinned,
 *              checksummed GitHub release, self-extracted, trimmed, and written
 *              to vendor/git/<platform>/ (Windows only — elsewhere git comes
 *              from the OS). This is what backs both the git_* tools and `bash`.
 *
 * Usage (from the STUDIO folder):
 *   node scripts/vendor-sync.mjs            # sync every tool for THIS platform
 *   node scripts/vendor-sync.mjs git        # sync only the named tool(s)
 *   node scripts/vendor-sync.mjs --force    # re-download even if up to date
 *
 * It only fetches for the platform it runs on — run it on each target OS/arch
 * (or in a CI matrix) to vendor every platform. The results are NOT committed
 * (see .gitignore); the Tauri build runs this first (via scripts/tauri-wrapper)
 * so packaged apps always ship a known-good, offline copy.
 */

import {
  existsSync, mkdirSync, copyFileSync, chmodSync, readFileSync, writeFileSync,
  rmSync, renameSync, statSync, readdirSync,
} from "fs";
import { createRequire } from "module";
import { createHash } from "crypto";
import { spawnSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const VENDOR_DIR = join(ROOT, "vendor");
const require = createRequire(import.meta.url);

const PLATFORM = `${process.platform}-${process.arch}`;
const FORCE = process.argv.includes("--force");

const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

/**
 * One entry per vendored tool.
 *
 *   kind: "file"  — a single binary. `resolve()` returns the upstream path,
 *                   which is copied into vendor/<tool>/<platform>/<exe>.
 *   kind: "tree"  — a directory tree. `syncTree()` downloads + extracts it into
 *                   vendor/<tool>/<platform>/ (used for Git for Windows).
 */
const TOOLS = {
  ripgrep: {
    kind: "file",
    exe: process.platform === "win32" ? "rg.exe" : "rg",
    source: "@vscode/ripgrep",
    resolve() {
      // @vscode/ripgrep exposes rgPath pointing at the prebuilt binary for the
      // platform it was installed on.
      const { rgPath } = require("@vscode/ripgrep");
      return rgPath;
    },
  },

  git: {
    kind: "tree",
    source: "git-for-windows/git",
    version: "2.55.0.2",
    // Only vendored where the OS doesn't guarantee git. On macOS/Linux git is
    // provided by the OS/toolchain, so we deliberately vendor nothing there and
    // the resolver falls through to PATH `git`.
    downloads: {
      "win32-x64": {
        url: "https://github.com/git-for-windows/git/releases/download/v2.55.0.windows.2/PortableGit-2.55.0.2-64-bit.7z.exe",
        sha256: "b20d42da3afa228e9fa6174480de820282667e799440d655e308f700dfa0d0df",
      },
    },
    // Files that MUST exist after extraction — the two entry points the runtime
    // resolver (tools/shared/vendor.ts) looks for. Their presence is our
    // integrity gate: if either is missing the extraction is treated as failed.
    entry: ["cmd/git.exe", "bin/bash.exe"],
    // Deleted after extraction to shrink the ~400 MB raw tree. All safe for a
    // headless coding harness — docs, man pages, translations, and the Tcl/Tk
    // GUI front-ends (gitk / git-gui) which we never launch. The git.exe,
    // bash.exe, DLLs, libexec subcommands and POSIX utilities all stay intact.
    trim: [
      // Docs, man pages, translations — never read by a headless harness.
      "mingw64/share/doc",
      "mingw64/share/man",
      "mingw64/share/info",
      "mingw64/share/locale",
      "usr/share/doc",
      "usr/share/man",
      "usr/share/info",
      "usr/share/locale",
      "ReleaseNotes.html",
      // vim (44 MB): STUDIO edits files with write_file/edit_file; nano stays as
      // a lightweight fallback editor for any raw `git commit` without -m.
      "usr/share/vim",
      // Tcl/Tk GUI front-ends (gitk / git-gui) — we run headless, never launch them.
      "mingw64/share/git-gui",
      "mingw64/share/gitk",
      "mingw64/bin/gitk",
      "mingw64/bin/wish.exe",
      "mingw64/bin/wish86.exe",
      "mingw64/bin/tclsh.exe",
      "mingw64/bin/tclsh86.exe",
      "mingw64/bin/tcl86.dll",
      "mingw64/bin/tk86.dll",
      "mingw64/lib/tcl8.6",
      "mingw64/lib/tk8.6",
      "mingw64/libexec/git-core/git-gui.exe",
      "mingw64/libexec/git-core/gitk",
    ],
  },
};

// ── helpers ──────────────────────────────────────────────────────────────────

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function dirSizeMB(path) {
  let bytes = 0;
  const walk = (p) => {
    let st;
    try { st = statSync(p); } catch { return; }
    if (st.isDirectory()) {
      for (const e of readdirSync(p)) walk(join(p, e));
    } else {
      bytes += st.size;
    }
  };
  walk(path);
  return bytes / 1048576;
}

async function download(url, dest) {
  // Node 18+ global fetch; follows GitHub's redirect to the CDN automatically.
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // Write to a .part file first so an interrupted download never looks complete.
  const part = `${dest}.part`;
  writeFileSync(part, buf);
  renameSync(part, dest);
}

// ── file-kind sync (ripgrep) ─────────────────────────────────────────────────

function syncFileTool(name, tool) {
  const destDir = join(VENDOR_DIR, name, PLATFORM);
  const dest = join(destDir, tool.exe);

  // Idempotent: if the binary is already vendored, skip re-copying. This mirrors
  // the tree-kind version gate and — importantly — means a re-run succeeds even
  // when the upstream source package isn't installed (the binary is what the app
  // needs; the source is only needed to (re)produce it). Use --force to refresh.
  if (!FORCE && existsSync(dest)) {
    console.log(green(`  ${name}: `) + `already present — ` + dim(dest));
    return {
      relPath: `${name}/${PLATFORM}/${tool.exe}`.replace(/\\/g, "/"),
      exe: tool.exe.replace(/\.exe$/, ""),
      source: tool.source,
    };
  }

  let src;
  try {
    src = tool.resolve();
  } catch (e) {
    console.error(
      red(`  ${name}: could not locate upstream binary.`) +
        `\n    Install the source package first:  npm install ${tool.source}` +
        `\n    (${e.message})`
    );
    return false;
  }

  if (!existsSync(src)) {
    console.error(red(`  ${name}: upstream binary not found at ${src}`));
    return false;
  }

  mkdirSync(destDir, { recursive: true });
  copyFileSync(src, dest);
  if (process.platform !== "win32") chmodSync(dest, 0o755);

  console.log(green(`  ${name}: `) + dim(src) + `\n    -> ${dest}`);
  return {
    relPath: `${name}/${PLATFORM}/${tool.exe}`.replace(/\\/g, "/"),
    exe: tool.exe.replace(/\.exe$/, ""),
    source: tool.source,
  };
}

// ── tree-kind sync (git for windows) ─────────────────────────────────────────

function extractAndInstall(name, tool, cache, finalDir) {
  // Extract into a temp dir next to the final one, so the final dir only ever
  // appears fully-formed (atomic install; a crash mid-extract can't corrupt an
  // existing good copy).
  const tmpExtract = join(VENDOR_DIR, name, `.tmp-${PLATFORM}-${process.pid}`);
  rmSync(tmpExtract, { recursive: true, force: true });
  mkdirSync(tmpExtract, { recursive: true });

  console.log(dim(`    extracting…`));
  // PortableGit is a 7-Zip self-extractor: `-o<dir> -y` extracts silently.
  const r = spawnSync(cache, [`-o${tmpExtract}`, "-y"], { stdio: "ignore" });
  if (r.status !== 0 && r.status !== null) {
    rmSync(tmpExtract, { recursive: true, force: true });
    throw new Error(`self-extractor exited ${r.status}`);
  }

  // Integrity gate: the entry points MUST exist, or the archive was bad.
  const missing = tool.entry.filter((rel) => !existsSync(join(tmpExtract, rel)));
  if (missing.length) {
    rmSync(tmpExtract, { recursive: true, force: true });
    throw new Error(
      `extraction incomplete — missing ${missing.join(", ")} (corrupt archive?)`
    );
  }

  // Trim the fat.
  const before = dirSizeMB(tmpExtract);
  for (const rel of tool.trim) {
    rmSync(join(tmpExtract, rel), { recursive: true, force: true });
  }
  const after = dirSizeMB(tmpExtract);
  console.log(dim(`    trimmed ${before.toFixed(0)} MB -> ${after.toFixed(0)} MB`));

  writeFileSync(join(tmpExtract, ".vendor-version"), tool.version + "\n", "utf8");

  // Atomic swap: remove any existing tree, move the fresh one into place.
  rmSync(finalDir, { recursive: true, force: true });
  mkdirSync(dirname(finalDir), { recursive: true });
  renameSync(tmpExtract, finalDir);
  return after;
}

async function syncTreeTool(name, tool) {
  const dl = tool.downloads[PLATFORM];
  if (!dl) {
    console.log(
      dim(`  ${name}: not vendored on ${PLATFORM} (provided by the OS) — skipped.`)
    );
    return "skip";
  }

  const finalDir = join(VENDOR_DIR, name, PLATFORM);
  const entryOk = tool.entry.every((rel) => existsSync(join(finalDir, rel)));
  const stamp = join(finalDir, ".vendor-version");
  const haveVersion = existsSync(stamp) ? readFileSync(stamp, "utf8").trim() : null;

  const result = {
    relDir: `${name}/${PLATFORM}`.replace(/\\/g, "/"),
    version: tool.version,
    source: tool.source,
    entry: tool.entry,
  };

  if (!FORCE && entryOk && haveVersion === tool.version) {
    console.log(green(`  ${name}: `) + `already at ${tool.version} — ` + dim(finalDir));
    return result;
  }

  const cache = join(tmpdir(), `studio-vendor-${name}-${PLATFORM}.7z.exe`);

  try {
    // Re-use a previously cached download only if it still matches the pinned
    // checksum; otherwise (re)download. Attempted twice so a single corrupt or
    // interrupted transfer self-heals before we give up.
    for (let attempt = 1; attempt <= 2; attempt++) {
      const cached = !FORCE && existsSync(cache) && sha256(cache) === dl.sha256;
      if (cached) {
        console.log(green(`    cached download checksum OK`));
      } else {
        console.log(
          cyan(`  ${name}: downloading ${tool.version} `) + dim(`(~56 MB)`) +
            `\n    ${dl.url}`
        );
        await download(dl.url, cache);
        const got = sha256(cache);
        if (got !== dl.sha256) {
          rmSync(cache, { force: true });
          if (attempt === 2) {
            throw new Error(
              `checksum mismatch after retry (expected ${dl.sha256.slice(0, 12)}…, got ${got.slice(0, 12)}…)`
            );
          }
          console.log(yellow(`    checksum mismatch — retrying download`));
          continue;
        }
        console.log(green(`    checksum OK`));
      }

      const finalMB = extractAndInstall(name, tool, cache, finalDir);
      console.log(
        green(`  ${name}: `) + `${tool.version} -> ` + dim(finalDir) +
          green(` (${finalMB.toFixed(0)} MB)`)
      );
      return result;
    }
  } catch (e) {
    console.error(red(`  ${name}: ${e.message}`));
    return false;
  }
}

async function syncOne(name) {
  const tool = TOOLS[name];
  if (!tool) {
    console.error(red(`Unknown tool "${name}". Known: ${Object.keys(TOOLS).join(", ")}`));
    return false;
  }
  return tool.kind === "tree" ? syncTreeTool(name, tool) : syncFileTool(name, tool);
}

function updateManifest(results) {
  const manifestPath = join(VENDOR_DIR, "manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    manifest = { tools: {} };
  }
  manifest.tools ??= {};

  for (const [name, res] of Object.entries(results)) {
    if (!res || res === "skip") continue;
    const t = (manifest.tools[name] ??= {});
    if (res.relPath) {
      // file kind
      t.exe ??= res.exe;
      t.source ??= res.source;
      t.platforms ??= {};
      t.platforms[PLATFORM] = res.relPath;
    } else if (res.relDir) {
      // tree kind
      t.kind = "tree";
      t.source = res.source;
      t.version = res.version;
      t.entry = res.entry;
      t.platforms ??= {};
      t.platforms[PLATFORM] = res.relDir;
    }
  }

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(cyan(`\nUpdated ${manifestPath}`));
}

async function main() {
  const requested = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const names = requested.length ? requested : Object.keys(TOOLS);

  console.log(cyan(`vendor-sync — platform ${PLATFORM}${FORCE ? " (--force)" : ""}`));
  console.log(cyan(`Syncing: ${names.join(", ")}\n`));

  const results = {};
  let ok = true;
  for (const name of names) {
    const res = await syncOne(name);
    if (res === false) ok = false;
    else results[name] = res;
  }

  const real = Object.fromEntries(
    Object.entries(results).filter(([, v]) => v && v !== "skip")
  );
  if (Object.keys(real).length) updateManifest(real);

  if (!ok) {
    console.log(yellow("\nSome tools failed — see messages above."));
    process.exit(1);
  }
  console.log(green("\nvendor-sync complete."));
}

main().catch((e) => {
  console.error(red(`\nvendor-sync failed: ${e.stack || e.message}`));
  process.exit(1);
});
