#!/usr/bin/env node
/**
 * Tauri CLI wrapper.
 *
 * Auto-loads signing credentials so `npm run tauri build` works without
 * manually exporting environment variables.
 *
 * Signing is attempted only when the password is explicitly available:
 *   ✅ release.mjs already set both TAURI_SIGNING_PRIVATE_KEY +
 *      TAURI_SIGNING_PRIVATE_KEY_PASSWORD in the environment
 *   ✅ ~/.tauri/studio.key  +  ~/.tauri/studio.key.password  both exist
 *
 * When the password is unavailable (most dev builds), updater artifact
 * creation is disabled via --config so the .exe is produced cleanly
 * without any signing error.  Use `node scripts/release.mjs` for releases.
 *
 * To enable local signing without release.mjs:
 *   echo YOUR_PASSWORD > ~/.tauri/studio.key.password
 */

import { execSync }                                from "child_process";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { join, dirname }                           from "path";
import { fileURLToPath }                           from "url";
import { homedir, tmpdir }                         from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Credential paths ────────────────────────────────────────────────────────

const home    = homedir();
const keyPath = join(home, ".tauri", "studio.key");
const pwdPath = join(home, ".tauri", "studio.key.password");

// ── Determine what credentials are available ─────────────────────────────────

const keyInEnv  = !!process.env.TAURI_SIGNING_PRIVATE_KEY;
const pwdInEnv  = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD !== undefined;
const keyOnDisk = existsSync(keyPath);
const pwdOnDisk = existsSync(pwdPath);

// Signing can proceed when:
//  a) release.mjs already set both env vars before calling us, OR
//  b) Key file is on disk AND password is available (disk file OR env var)
const willSign =
  (keyInEnv && pwdInEnv) ||
  (keyOnDisk && (pwdOnDisk || pwdInEnv));

// ── Load credentials when signing is possible ────────────────────────────────

if (willSign) {
  if (!keyInEnv && keyOnDisk) {
    try {
      const key = readFileSync(keyPath, "utf8")
        .replace(/^﻿/, "")        // strip Windows BOM
        .replace(/\r\n/g, "\n")   // normalise CRLF → LF (minisign is LF-sensitive)
        .trim();
      if (key) {
        process.env.TAURI_SIGNING_PRIVATE_KEY = key;
        console.log("[tauri-wrapper] Signing key loaded from ~/.tauri/studio.key");
      }
    } catch {
      console.warn("[tauri-wrapper] Could not read signing key — signing will likely fail.");
    }
  }

  if (!pwdInEnv && pwdOnDisk) {
    try {
      const pwd = readFileSync(pwdPath, "utf8")
        .replace(/^﻿/, "")
        .trim();
      process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = pwd;
      console.log("[tauri-wrapper] Signing password loaded from ~/.tauri/studio.key.password");
    } catch {
      console.warn("[tauri-wrapper] Could not read password file.");
    }
  }

  if (!process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
    // Ensure the env var is always a string so Tauri's parser doesn't complain.
    process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "";
  }
}

// ── Forward arguments to the Tauri CLI ─────────────────────────────────────

// process.argv: [node, scripts/tauri-wrapper.mjs, ...tauriArgs]
const args = process.argv.slice(2);

// ── Ensure vendored runtime binaries are present before dev/build ───────────
// git (for Windows) + ripgrep are fetched at build time by vendor-sync, not
// committed. This is idempotent — it no-ops in a second or two once the vendor
// tree is current, and downloads once on a fresh checkout. A packaged app that
// shipped without these would have broken git/bash/search, so a failure here is
// fatal rather than silently degrading.
if (args[0] === "build" || args[0] === "dev") {
  try {
    console.log("[tauri-wrapper] Ensuring vendored runtime binaries (git, ripgrep)…");
    execSync(`node "${join(__dirname, "vendor-sync.mjs")}"`, { stdio: "inherit", env: process.env });
  } catch (err) {
    console.error("[tauri-wrapper] vendor-sync failed — cannot build/run without bundled git + ripgrep.");
    process.exit(typeof err.status === "number" ? err.status : 1);
  }
}

let tmpConfigPath = null;

if (!willSign && args[0] === "build") {
  // Disable updater artifact creation so the build doesn't require a signing
  // key.  The .exe is still produced; only the .sig (updater signature) is
  // skipped.  Use release.mjs for signed production builds.
  console.log("[tauri-wrapper] No signing password available — disabling updater artifact creation.");
  console.log("[tauri-wrapper]   Create ~/.tauri/studio.key.password to enable local signed builds.");
  // Write the override to a temp file — passing raw JSON inline on Windows
  // shells is unreliable due to quote escaping.
  tmpConfigPath = join(tmpdir(), "tauri-dev-override.json");
  writeFileSync(tmpConfigPath, JSON.stringify({ bundle: { createUpdaterArtifacts: false } }), "utf8");
  args.push("--config", `"${tmpConfigPath}"`);
}

try {
  execSync(`tauri ${args.join(" ")}`, { stdio: "inherit", env: process.env });
} catch (err) {
  process.exit(typeof err.status === "number" ? err.status : 1);
}

// Clean up the temp config file we created (if any)
if (tmpConfigPath && existsSync(tmpConfigPath)) {
  try { unlinkSync(tmpConfigPath); } catch { /* non-critical */ }
}
