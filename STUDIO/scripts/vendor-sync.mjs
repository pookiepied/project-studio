#!/usr/bin/env node
/**
 * vendor-sync — populate mcp-servers/vendor/ with bundled runtime binaries.
 *
 * STUDIO ships a handful of native third-party executables (currently ripgrep)
 * so the harness tools work on machines that don't have them on PATH. This script
 * is the reproducible way to obtain/refresh those binaries: it fetches them from
 * their upstream npm packages and copies them into the canonical vendor layout
 *
 *     mcp-servers/vendor/<tool>/<platform>/<exe>
 *
 * where <platform> is `${process.platform}-${process.arch}` (win32-x64, etc.).
 *
 * Usage (from the STUDIO folder):
 *   node scripts/vendor-sync.mjs            # sync every tool for THIS platform
 *   node scripts/vendor-sync.mjs ripgrep    # sync only the named tool(s)
 *
 * It only fetches the binary for the platform it runs on — run it on each target
 * OS/arch (or in a CI matrix) to vendor all platforms. Commit the results so
 * builds are reproducible and work offline.
 */

import { existsSync, mkdirSync, copyFileSync, chmodSync, readFileSync, writeFileSync } from "fs";
import { createRequire } from "module";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const VENDOR_DIR = join(ROOT, "vendor");
const require = createRequire(import.meta.url);

const PLATFORM = `${process.platform}-${process.arch}`;

const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;

/**
 * One entry per vendored tool. `resolve()` returns the absolute path to the
 * upstream binary for the current platform (installing the source package is the
 * caller's responsibility — see the error hint each resolver throws).
 */
const TOOLS = {
  ripgrep: {
    exe: process.platform === "win32" ? "rg.exe" : "rg",
    source: "@vscode/ripgrep",
    resolve() {
      // @vscode/ripgrep exposes rgPath pointing at the prebuilt binary for the
      // platform it was installed on.
      const { rgPath } = require("@vscode/ripgrep");
      return rgPath;
    },
  },
};

function syncTool(name) {
  const tool = TOOLS[name];
  if (!tool) {
    console.error(red(`Unknown tool "${name}". Known: ${Object.keys(TOOLS).join(", ")}`));
    return false;
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

  const destDir = join(VENDOR_DIR, name, PLATFORM);
  const destExe = tool.exe;
  const dest = join(destDir, destExe);
  mkdirSync(destDir, { recursive: true });
  copyFileSync(src, dest);
  if (process.platform !== "win32") chmodSync(dest, 0o755);

  console.log(green(`  ${name}: ${src}`) + `\n    -> ${dest}`);
  return { relPath: `${name}/${PLATFORM}/${destExe}`.replace(/\\/g, "/") };
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
    if (!res) continue;
    manifest.tools[name] ??= {};
    const t = manifest.tools[name];
    t.exe ??= TOOLS[name].exe.replace(/\.exe$/, "");
    t.source ??= TOOLS[name].source;
    t.platforms ??= {};
    t.platforms[PLATFORM] = res.relPath;
  }

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(cyan(`\nUpdated ${manifestPath}`));
}

function main() {
  const requested = process.argv.slice(2);
  const names = requested.length ? requested : Object.keys(TOOLS);

  console.log(cyan(`vendor-sync — platform ${PLATFORM}`));
  console.log(cyan(`Syncing: ${names.join(", ")}\n`));

  const results = {};
  let ok = true;
  for (const name of names) {
    const res = syncTool(name);
    if (res === false) ok = false;
    else results[name] = res;
  }

  if (Object.keys(results).length) updateManifest(results);

  if (!ok) {
    console.log(yellow("\nSome tools failed — see messages above."));
    process.exit(1);
  }
  console.log(green("\nvendor-sync complete."));
}

main();
