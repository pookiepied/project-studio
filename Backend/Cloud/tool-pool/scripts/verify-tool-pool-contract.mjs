import { readFileSync } from "node:fs";

const contracts = readFileSync(new URL("../src/contracts.ts", import.meta.url), "utf8");
const build = readFileSync(new URL("../src/inventory/build.ts", import.meta.url), "utf8");
const defaults = readFileSync(new URL("../src/tools/defaultTools.ts", import.meta.url), "utf8");
const routes = readFileSync(new URL("../src/server/routes.ts", import.meta.url), "utf8");

const checks = [
  ["source health contract", contracts.includes("SourceHealth") && contracts.includes("sourceHealth: SourceHealth[]")],
  ["eligibility contract", contracts.includes("ToolEligibilityStatus") && contracts.includes("eligibility: ToolEligibilityStatus")],
  ["conflict metadata contract", contracts.includes("strategy: \"unchanged\" | \"namespaced\" | \"shadowed\"")],
  ["projection carries source health", build.includes("sourceHealth:") && build.includes('source: "tool-pool"')],
  ["safe inventory fallback", build.includes("safeInventory") && build.includes('status: "unavailable"')],
  ["eligibility filtering", build.includes("applyEligibility") && build.includes('summary.eligibility === "eligible"')],
  ["planner read-only rule", build.includes("planner_read_only")],
  ["conflict metadata application", build.includes("applyConflictMetadata") && build.includes('strategy = (counts.get(canonicalName) ?? 0) > 1 ? "namespaced" : "unchanged"')],
  ["discover and resolve are only defaults", defaults.includes('DISCOVER_TOOLS_NAME = "discover_tools"') && defaults.includes('RESOLVE_TOOL_NAME = "resolve_tool"') && !defaults.includes('"expand_tool"')],
  ["tool pool does not execute tools", !routes.includes("/execute")],
];

const failed = checks.filter(([, pass]) => !pass);
if (failed.length) {
  for (const [name] of failed) console.error(`FAIL ${name}`);
  process.exit(1);
}

for (const [name] of checks) console.log(`PASS ${name}`);
