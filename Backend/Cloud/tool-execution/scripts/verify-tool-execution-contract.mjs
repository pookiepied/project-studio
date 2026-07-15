import { readFileSync } from "node:fs";

const contracts = readFileSync(new URL("../src/contracts.ts", import.meta.url), "utf8");
const executor = readFileSync(new URL("../src/execution/executor.ts", import.meta.url), "utf8");
const validation = readFileSync(new URL("../src/execution/validation.ts", import.meta.url), "utf8");
const transcripts = readFileSync(new URL("../src/execution/transcripts.ts", import.meta.url), "utf8");
const serviceDispatch = readFileSync(new URL("../src/execution/serviceDispatch.ts", import.meta.url), "utf8");
const env = readFileSync(new URL("../src/system/env.ts", import.meta.url), "utf8");
const wrangler = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");

const checks = [
  ["request envelope version", contracts.includes('"studio.tool-execution.request.v1"')],
  ["result envelope version", contracts.includes('"studio.tool-execution.result.v1"')],
  ["materialized tool descriptor", contracts.includes("MaterializedToolDescriptor") && validation.includes("normalizeMaterializedTool")],
  ["route can come from descriptor", validation.includes("normalizeRoute(readOptionalObject(input.tool)?.route)")],
  ["tool transcript event refs", contracts.includes("ToolTranscriptEventRef") && executor.includes("transcriptEvents")],
  ["artifact updates returned", contracts.includes("ToolArtifactUpdate") && executor.includes("extractArtifactUpdates")],
  ["studio data transcript persistence", env.includes("DATA: Fetcher") && transcripts.includes("https://data/transcripts/events")],
  ["connector dispatch", env.includes("CONNECTORS: Fetcher") && serviceDispatch.includes("dispatchConnector") && executor.includes("dispatchConnector")],
  ["native cloud dispatch", env.includes("NATIVE_TOOLS: Fetcher") && serviceDispatch.includes("dispatchNativeCloud") && executor.includes("dispatchNativeCloud")],
  ["memory dispatch", env.includes("MEMORY: Fetcher") && serviceDispatch.includes("dispatchMemory") && executor.includes("dispatchMemory")],
  ["agent skill mcp dispatch preserved", executor.includes("dispatchAgentRuntime") && executor.includes("dispatchSkillLibrary") && executor.includes("dispatchMcpTool")],
  ["idempotent replay guarded", executor.includes("duplicate_in_progress")],
  ["tool execution does not discover tools", !executor.includes("/discover") && !serviceDispatch.includes("/discover")],
  ["wrangler service bindings", wrangler.includes('binding = "DATA"') && wrangler.includes('binding = "CONNECTORS"') && wrangler.includes('binding = "NATIVE_TOOLS"') && wrangler.includes('binding = "MEMORY"')],
];

const failed = checks.filter(([, pass]) => !pass);
if (failed.length) {
  for (const [name] of failed) console.error(`FAIL ${name}`);
  process.exit(1);
}

for (const [name] of checks) console.log(`PASS ${name}`);
