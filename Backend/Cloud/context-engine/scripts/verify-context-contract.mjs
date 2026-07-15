import { readFileSync } from "node:fs";

const contracts = readFileSync(new URL("../src/contracts.ts", import.meta.url), "utf8");
const conversation = readFileSync(new URL("../src/builders/conversation.ts", import.meta.url), "utf8");
const catalog = readFileSync(new URL("../src/projection/catalog.ts", import.meta.url), "utf8");
const runtimeContracts = [
  ["execution-runtime", readFileSync(new URL("../../runtime/execution-runtime/src/contracts.ts", import.meta.url), "utf8")],
  ["planner-runtime", readFileSync(new URL("../../runtime/planner-runtime/src/contracts.ts", import.meta.url), "utf8")],
  ["agent-runtime", readFileSync(new URL("../../runtime/agent-runtime/src/contracts.ts", import.meta.url), "utf8")],
];

const checks = [
  ["resolved resource contract", contracts.includes("ResolvedContextResource")],
  ["conversation includes resolved resources", contracts.includes("resolvedResources: ResolvedContextResource[]")],
  ["provider-neutral model input contract", contracts.includes("ProviderNeutralModelInput") && contracts.includes('"studio.model-input.v1"')],
  ["sendable carries model input", contracts.includes("modelInput: ProviderNeutralModelInput")],
  ["provider-neutral message parts", contracts.includes("image_ref") && contracts.includes("file_ref") && contracts.includes("artifact_ref") && contracts.includes("tool_result")],
  ["artifact event kinds included", contracts.includes("artifact_permission_requested") && contracts.includes("artifact_completed")],
  ["artifact resolver calls data", conversation.includes("http://data/artifacts/")],
  ["attachment resolver calls data", conversation.includes("http://data/uploads/")],
  ["data calls user scoped", conversation.includes('headers: { "x-user-id": userId }')],
  ["safe text resource reader", conversation.includes("readTextResource") && conversation.includes("24_000")],
  ["runtime data redaction", conversation.includes("safeRuntimeData") && conversation.includes("[redacted]")],
  ["sendable resolved resources", catalog.includes('id: "resolved_resources"')],
  ["resolved resources dynamic section", catalog.includes('"resolved_resources"')],
  ["model input builder", catalog.includes("buildProviderNeutralModelInput") && catalog.includes("modelInput: buildProviderNeutralModelInput")],
  ["reference-only image/file lowering", catalog.includes('images: "reference-only"') && catalog.includes('files: "reference-only"')],
  ["runtime contract copies accept model input", runtimeContracts.every(([, content]) => content.includes("modelInput?: ProviderNeutralModelInput") && content.includes('"studio.model-input.v1"'))],
];

const failed = checks.filter(([, pass]) => !pass);
if (failed.length) {
  for (const [name] of failed) console.error(`FAIL ${name}`);
  process.exit(1);
}

for (const [name] of checks) console.log(`PASS ${name}`);
