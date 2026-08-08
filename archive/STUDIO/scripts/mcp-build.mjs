#!/usr/bin/env node
/**
 * MCP server build helper.
 *
 * When STUDIO_RELEASE=1 (set by release.mjs before it calls `npm run tauri build`),
 * MCP servers have already been built and pruned — skip rebuilding them so the pruned
 * node_modules are not clobbered.
 *
 * Without the env var this script behaves identically to the old inline commands in
 * beforeBuildCommand, so `npm run tauri build` continues to work on its own.
 */

import { execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

if (process.env.STUDIO_RELEASE === "1") {
  console.log("[mcp-build] STUDIO_RELEASE=1 — MCP servers already built, skipping.");
  process.exit(0);
}

function run(cmd, cwd = ROOT) {
  execSync(cmd, { stdio: "inherit", cwd });
}

console.log("[mcp-build] Building MCP servers...");
for (const server of [
  "harness/studio-harness",
  "desktop/computer-use",
  "system/mcp-management",
  "system/skill-management",
  "system/skill-execution",
]) run(`npm --prefix library/mcp-servers/${server} run build`);
console.log("[mcp-build] Done.");
