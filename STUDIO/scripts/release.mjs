#!/usr/bin/env node
/**
 * STUDIO release script — Node.js replacement for release.ps1
 *
 * Usage:
 *   node scripts/release.mjs          (from STUDIO folder)
 *   Double-click scripts/release.bat  (Windows shortcut)
 *
 * What it does:
 *   1. Loads signing key from ~/.tauri/studio.key
 *   2. Reads version; syncs Cargo.toml
 *   3. Builds MCP servers (devDependencies still present)
 *   4. Prunes devDependencies from MCP node_modules (shrinks installer ~10 MB)
 *   5. Runs `npm run tauri build` (beforeBuildCommand skips MCP re-build via STUDIO_RELEASE=1)
 *   6. Uploads the installer to the studio-releases R2 bucket
 *   7. Writes the update manifest to Cloudflare KV
 *   8. Deploys the Worker so the new endpoint is live
 */

import { readFileSync, readdirSync, writeFileSync, unlinkSync, rmSync, existsSync } from "fs";
import { execSync } from "child_process";
import { createInterface } from "readline";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT  = join(__dirname, "..");           // STUDIO/
const AI    = join(ROOT, "..", "ai");          // ai/

// ── helpers ─────────────────────────────────────────────────────────────────

const cyan  = (s) => `\x1b[36m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red   = (s) => `\x1b[31m${s}\x1b[0m`;

// Ensure ~/.cargo/bin is in PATH so cargo/rustup are always found.
// env() is a function so it snapshots process.env at call time — any vars
// set after module load (e.g. TAURI_SIGNING_PRIVATE_KEY) are included.
const cargoBin = join(homedir(), ".cargo", "bin");
const buildEnv = () => ({
  ...process.env,
  PATH: `${cargoBin};${process.env.PATH ?? ""}`,
});

function run(cmd, cwd = ROOT) {
  execSync(cmd, { stdio: "inherit", cwd, env: buildEnv() });
}

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function pause() {
  await ask("\nPress Enter to close...");
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  try {
    // 1. Load signing key
    const keyPath = join(homedir(), ".tauri", "studio.key");
    let key;
    try {
      key = readFileSync(keyPath, "utf8")
        .replace(/^\uFEFF/, "")  // strip BOM if present
        .trim();
    } catch {
      throw new Error(
        `Signing key not found at ${keyPath}\nRun: npx tauri signer generate -w ~/.tauri/studio.key`
      );
    }
    process.env.TAURI_SIGNING_PRIVATE_KEY = key;
    console.log(green(`Key loaded (${key.length} chars)`));
    console.log(`Key starts with: ${key.slice(0, 30).replace(/\n/g, "\\n")}`);

    const password = await ask("Signing key password (press Enter if none): ");
    process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = password;

    // 2. Read version from tauri.conf.json and sync it into Cargo.toml
    const conf    = JSON.parse(readFileSync(join(ROOT, "src-tauri", "tauri.conf.json"), "utf8"));
    const version = conf.version;
    const cargoPath = join(ROOT, "src-tauri", "Cargo.toml");
    const cargoRaw  = readFileSync(cargoPath, "utf8");
    const cargoSynced = cargoRaw.replace(/^version\s*=\s*"[^"]*"/m, `version = "${version}"`);
    if (cargoSynced !== cargoRaw) {
      writeFileSync(cargoPath, cargoSynced, "utf8");
      console.log(green(`Cargo.toml version synced to ${version}`));
    }
    console.log(`\n${cyan(`Building STUDIO v${version}...`)}\n`);

    // Clean old bundles to avoid ambiguity with previous version builds
    const bundleDir = join(ROOT, "src-tauri", "target", "release", "bundle", "nsis");
    if (existsSync(bundleDir)) {
      const oldFiles = readdirSync(bundleDir).filter(
        (f) => f.endsWith("-setup.exe") || f.endsWith("-setup.exe.sig")
      );
      if (oldFiles.length > 0) {
        console.log(cyan(`Removing ${oldFiles.length} old bundle file(s) from ${bundleDir}...`));
        for (const f of oldFiles) {
          rmSync(join(bundleDir, f), { force: true });
        }
      }
    }

    // 3. Build MCP servers while devDependencies (esbuild, tsx) are still present.
    //    Prune happens after — devDeps must exist for this step.
    console.log(cyan("\nBuilding MCP servers..."));
    run("node scripts/mcp-build.mjs");
    console.log(green("MCP build complete."));

    // 4. Prune dev dependencies from MCP servers that ship their node_modules.
    //    typescript, esbuild, tsx etc. add ~10 MB to the compressed EXE for no reason.
    //    Must happen AFTER the builds above and BEFORE Tauri packages node_modules.
    console.log(cyan("\nPruning dev dependencies from bundled MCP servers..."));
    for (const server of ["harness/studio-harness", "desktop/computer-use", "system/mcp-management", "system/skill-management", "system/skill-execution"]) {
      run("npm prune --omit=dev", join(ROOT, "library", "mcp-servers", ...server.split("/")));
    }
    console.log(green("Prune complete."));

    // Signal mcp-build.mjs (run by beforeBuildCommand) to skip re-building MCP servers.
    process.env.STUDIO_RELEASE = "1";

    // 5. Verify env var survives into a subprocess, then build
    const envCheck = execSync(
      `node -e "process.stdout.write(String(process.env.TAURI_SIGNING_PRIVATE_KEY?.length ?? 'NOT SET'))"`,
      { env: buildEnv() }
    ).toString().trim();
    console.log(`Env var check (child process sees key length): ${envCheck}`);
    if (envCheck === "NOT SET" || envCheck === "0") {
      throw new Error("TAURI_SIGNING_PRIVATE_KEY did not propagate to child processes.");
    }

    run("npm run tauri build");

    // 6. Locate signed bundle
    const exeName = `STUDIO_${version}_x64-setup.exe`;
    const sigName = `${exeName}.sig`;
    const exePath = join(bundleDir, exeName);
    const sigPath = join(bundleDir, sigName);

    // Verify the expected files actually exist before proceeding
    if (!existsSync(exePath) || !existsSync(sigPath)) {
      const files = readdirSync(bundleDir);
      console.log(`\n${cyan(`Contents of ${bundleDir}:`)}`);
      files.forEach((f) => console.log(`  ${f}`));
      throw new Error(
        `Expected bundle files not found for v${version}:\n` +
        `  Expected: ${exeName}\n` +
        `  Expected: ${sigName}\n` +
        `The build may have failed or used a different version.`
      );
    }

    console.log(green(`\nBundle : ${exePath}`));
    console.log(green(`Sig    : ${sigPath}`));

    // 7. Upload installer to R2
    const r2Key = `windows/x86_64/${exeName}`;
    console.log(`\n${cyan(`Uploading to R2 (studio-releases/${r2Key})...`)}`);
    run(
      `npx wrangler r2 object put "studio-releases/${r2Key}" --file "${exePath}" --content-type "application/octet-stream" --remote`,
      AI
    );

    // 8. Build + write update manifest to KV
    const signature   = readFileSync(sigPath, "utf8").trim();
    const downloadUrl = `https://api.pookiepied.dev/v1/releases/${r2Key}`;
    const pubDate     = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

    const manifest = JSON.stringify(
      {
        version,
        notes:    `STUDIO ${version}`,
        pub_date: pubDate,
        platforms: {
          "windows-x86_64": { signature, url: downloadUrl },
        },
      },
      null,
      2
    );

    console.log(`\n${cyan("Manifest:")}\n${manifest}`);

    // 9. Write manifest to RELEASES_KV in the api gateway Worker
    // Write to a temp file first to avoid shell escaping issues with JSON on Windows
    const API_DIR = join(ROOT, "..", "api");
    const tmpPath = join(API_DIR, ".manifest-tmp.json");
    writeFileSync(tmpPath, manifest, "utf8");
    console.log(`\n${cyan("Writing manifest to RELEASES_KV (studio:latest)...")}`);
    try {
      run(
        `npx wrangler kv key put --namespace-id=35f6ec05519142ca91278067caa2fba9 "studio:latest" --path "${tmpPath}" --remote`,
        API_DIR
      );
    } finally {
      unlinkSync(tmpPath);
    }

    // 10. Deploy Worker
    console.log(`\n${cyan("Deploying Worker...")}`);
    run("npx wrangler deploy", API_DIR);

    // Done
    console.log(`\n${green("========================================")}`);
    console.log(green(` Release ${version} published successfully`));
    console.log(green("========================================"));
    console.log(`Update endpoint : https://api.pookiepied.dev/v1/updates/latest`);
    console.log(`Download URL    : ${downloadUrl}`);
    console.log("\nUsers will see the update prompt the next time they open STUDIO.");

  } catch (err) {
    console.error(`\n${red("FAILED:")} ${err.message}`);
  }

  await pause();
}

main();
