#!/usr/bin/env node
/**
 * Ratchet gate: quality may improve, never regress.
 *
 * A codebase with a pre-existing backlog cannot use a plain `eslint .` as a
 * pass/fail gate -- it is red unconditionally, so it gets ignored. This script
 * compares the current state against a committed baseline and fails only on
 * *new* violations. Fixing violations makes the check pass; the baseline is
 * then lowered with --update so the improvement cannot be undone later.
 *
 *   node scripts/ratchet.mjs lint            check per-file eslint error counts
 *   node scripts/ratchet.mjs cycles          check the set of circular imports
 *   node scripts/ratchet.mjs <check> --update   rewrite the baseline
 *
 * Baselines are per-file / per-cycle rather than a single total: a total-only
 * ratchet lets an agent fix five violations in one file while introducing one
 * somewhere else and still report green.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_DIR = resolve(ROOT, "gate");
/**
 * Run a tool's bin script with the current node binary. Not `npx`: Node refuses
 * to execFile a `.cmd` shim on Windows without a shell, and enabling a shell
 * would put this repo's spaced-out path through cmd.exe quoting.
 */
const BIN = {
  eslint: "node_modules/eslint/bin/eslint.js",
  madge: "node_modules/madge/bin/cli.js",
};

const run = (tool, args) =>
  execFileSync(process.execPath, [resolve(ROOT, BIN[tool]), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });

/** Posix-normalized path relative to STUDIO/, so baselines are portable across OSes. */
const rel = (p) => relative(ROOT, p).split("\\").join("/");

const CHECKS = {
  /** Map of file -> eslint error count. Warnings are excluded; only errors ratchet. */
  lint: {
    baseline: "lint-baseline.json",
    unit: "eslint errors",
    collect() {
      // eslint exits nonzero when errors exist; that is the normal case here.
      let out;
      try {
        out = run("eslint", [".", "-f", "json"]);
      } catch (err) {
        out = err.stdout;
      }
      if (!out) throw new Error("eslint produced no output");
      const counts = {};
      for (const file of JSON.parse(out)) {
        if (file.errorCount > 0) counts[rel(file.filePath)] = file.errorCount;
      }
      return counts;
    },
  },

  /** Map of "a.ts > b.ts" -> 1. Presence is what matters, not a count. */
  cycles: {
    baseline: "cycles-baseline.json",
    unit: "circular imports",
    collect() {
      let out;
      try {
        out = run("madge", [
          "--circular", "--json",
          "--extensions", "ts,tsx",
          "--ts-config", "tsconfig.json",
          "src",
        ]);
      } catch (err) {
        out = err.stdout;
      }
      if (!out) throw new Error("madge produced no output");
      const counts = {};
      for (const cycle of JSON.parse(out)) counts[cycle.join(" > ")] = 1;
      return counts;
    },
  },
};

const [name, ...flags] = process.argv.slice(2);
const check = CHECKS[name];
if (!check) {
  console.error(`usage: ratchet.mjs <${Object.keys(CHECKS).join("|")}> [--update]`);
  process.exit(2);
}
const update = flags.includes("--update");
const baselinePath = resolve(BASELINE_DIR, check.baseline);

const current = check.collect();
const total = (m) => Object.values(m).reduce((a, b) => a + b, 0);

if (update) {
  mkdirSync(BASELINE_DIR, { recursive: true });
  const sorted = Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(baselinePath, JSON.stringify(sorted, null, 2) + "\n");
  console.log(`baseline written: ${rel(baselinePath)} (${total(current)} ${check.unit})`);
  process.exit(0);
}

if (!existsSync(baselinePath)) {
  console.error(`missing baseline ${rel(baselinePath)} -- run: npm run ratchet:${name} -- --update`);
  process.exit(2);
}
const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));

const regressions = [];
const improvements = [];
for (const [key, count] of Object.entries(current)) {
  const was = baseline[key] ?? 0;
  if (count > was) regressions.push(`  + ${key}  ${was} -> ${count}`);
}
for (const [key, was] of Object.entries(baseline)) {
  const now = current[key] ?? 0;
  if (now < was) improvements.push(`  - ${key}  ${was} -> ${now}`);
}

const nowTotal = total(current);
const wasTotal = total(baseline);
console.log(`${name}: ${nowTotal} ${check.unit} (baseline ${wasTotal})`);

if (regressions.length) {
  console.error(`\nREGRESSION -- ${regressions.length} new ${check.unit}:`);
  console.error(regressions.join("\n"));
  console.error(`\nFix them, or justify and re-baseline with: npm run ratchet:${name} -- --update`);
  process.exit(1);
}

if (improvements.length) {
  console.log(`\n${improvements.length} improved:`);
  console.log(improvements.join("\n"));
  console.log(`\nLock it in: npm run ratchet:${name} -- --update`);
}

console.log(`\nOK -- no new ${check.unit}.`);
