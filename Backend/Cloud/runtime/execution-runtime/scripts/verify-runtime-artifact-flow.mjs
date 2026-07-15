import { readFileSync } from "node:fs";

const runtimeFiles = [
  ["execution-runtime", new URL("../src/runtime/RuntimeSession.ts", import.meta.url)],
  ["planner-runtime", new URL("../../planner-runtime/src/runtime/RuntimeSession.ts", import.meta.url)],
  ["agent-runtime", new URL("../../agent-runtime/src/runtime/RuntimeSession.ts", import.meta.url)],
];
const modelLoopFiles = [
  ["execution-runtime model loop", new URL("../src/runtime/modelLoop.ts", import.meta.url)],
  ["planner-runtime model loop", new URL("../../planner-runtime/src/runtime/modelLoop.ts", import.meta.url)],
  ["agent-runtime model loop", new URL("../../agent-runtime/src/runtime/modelLoop.ts", import.meta.url)],
];

const checksFor = (name, source) => [
  [`${name}: permission result contract`, source.includes("RuntimePermissionRequest") && source.includes("permissionRequest?: RuntimePermissionRequest")],
  [`${name}: artifact refs on tool result`, source.includes("RuntimeArtifactRef") && source.includes("artifacts?: RuntimeArtifactRef[]")],
  [`${name}: runtime approval gate`, source.includes("requiresRuntimeApproval(tool)") && source.includes("createPermissionRequiredResult")],
  [`${name}: creates artifacts through Studio Data`, source.includes('this.postData("/artifacts"') && source.includes("createRuntimeArtifact")],
  [`${name}: emits permission transcript event`, source.includes("artifact.permission.requested") && source.includes("artifact_permission_requested")],
  [`${name}: emits artifact completion/failure events`, source.includes("artifact.completed") && source.includes("artifact_failed")],
  [`${name}: sends tool execution v1 envelope`, source.includes('"studio.tool-execution.request.v1"')],
  [`${name}: sends materialized tool descriptor`, source.includes("tool: tool.descriptor")],
  [`${name}: model proposal is advisory`, source.includes("readArtifactProposal") && source.includes("__studioArtifactProposal")],
  [`${name}: runtime chooses artifact family`, source.includes("artifactFamilyFor") && source.includes("connector_action")],
  [`${name}: runtime event envelope`, source.includes('"studio.runtime.event.v1"') && source.includes("visibilityForRuntimeEvent")],
  [`${name}: websocket streaming`, source.includes("websocketResponse") && source.includes("new WebSocketPair") && source.includes("this.sockets.add")],
  [`${name}: event replay endpoint`, source.includes("eventsResponse") && source.includes('"studio.runtime.events.v1"')],
  [`${name}: event broadcast`, source.includes("broadcast(event)") && source.includes("socket.send(payload)")],
  [`${name}: approval resolution`, source.includes("resolveApproval") && source.includes("/permissions") && source.includes("approval.approved")],
  [`${name}: invokes model loop`, source.includes("runModelLoop") && source.includes("initialTools")],
];

const checksForModelLoop = (name, source) => [
  [`${name}: gateway chat lowering`, source.includes("/v1/chat/completions") && source.includes("lowerContextToMessages")],
  [`${name}: provider neutral messages consumed`, source.includes("context?.sendable?.modelInput") && source.includes("ProviderNeutralMessagePart")],
  [`${name}: tool schema lowering`, source.includes("toGatewayTool") && source.includes('type: "function"')],
  [`${name}: tool call loop`, source.includes("tool_calls") && source.includes("executeTool(tool, args, call.id)")],
  [`${name}: resolve tool refresh`, source.includes('tool.descriptor.name === "resolve_tool"') && source.includes("refreshTools")],
  [`${name}: model loop events`, source.includes("model.call.started") && source.includes("model.call.completed")],
  [`${name}: gateway tool result continuation`, source.includes('role: "tool"') && source.includes("toolCallId")],
];

const routeFiles = [
  ["execution-routes", new URL("../src/server/routes/runs.ts", import.meta.url)],
  ["planner-routes", new URL("../../planner-runtime/src/server/routes/plans.ts", import.meta.url)],
  ["agent-routes", new URL("../../agent-runtime/src/server/routes/invoke.ts", import.meta.url)],
];

const routeChecks = routeFiles.flatMap(([name, url]) => {
  const source = readFileSync(url, "utf8");
  return [
    [`${name}: websocket route`, source.includes("/ws")],
    [`${name}: events replay route`, source.includes("/events") && source.includes("after=")],
  ];
});

const checks = [
  ...runtimeFiles.flatMap(([name, url]) => checksFor(name, readFileSync(url, "utf8"))),
  ...modelLoopFiles.flatMap(([name, url]) => checksForModelLoop(name, readFileSync(url, "utf8"))),
  ...routeChecks,
];
const failed = checks.filter(([, pass]) => !pass);
if (failed.length) {
  for (const [name] of failed) console.error(`FAIL ${name}`);
  process.exit(1);
}

for (const [name] of checks) console.log(`PASS ${name}`);
