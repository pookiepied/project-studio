import type { ToolArtifactUpdate, ToolExecutionRequest, ToolExecutionResult, ToolTranscriptEventRef } from "../contracts";
import type { Env } from "../system/env";
import { notImplemented, toToolError } from "../errors";
import { completeJob, createJob, failJob } from "../jobs/repository";
import { dispatchAgentRuntime } from "./agentRuntime";
import { dispatchMcpTool } from "./mcp";
import { resolveRoute, targetRef } from "./routes";
import { dispatchConnector, dispatchMemory, dispatchNativeCloud } from "./serviceDispatch";
import { dispatchSkillLibrary } from "./skillLibrary";
import { persistToolCallEvent, persistToolResultEvent } from "./transcripts";

export async function executeToolCall(env: Env, request: ToolExecutionRequest): Promise<ToolExecutionResult> {
  const route = await resolveRoute(env, request);
  const startedAt = new Date().toISOString();
  const job = await createJob(env.TOOL_EXECUTION_DB, request, route.kind, targetRef(route));
  if (job.status === "completed") {
    return {
      ok: true,
      format: "studio.tool-execution.result.v1",
      jobId: job.jobId,
      toolCallId: job.toolCallId,
      toolName: job.toolName,
      status: "completed",
      result: job.result,
      artifacts: extractArtifactUpdates(job.result),
      route,
      startedAt: job.startedAt ?? startedAt,
      completedAt: job.completedAt ?? job.updatedAt,
    };
  }
  if (job.status === "failed") {
    return {
      ok: false,
      format: "studio.tool-execution.result.v1",
      jobId: job.jobId,
      toolCallId: job.toolCallId,
      toolName: job.toolName,
      status: "failed",
      error: job.error ?? { code: "unknown_error", message: "Tool call failed.", retryable: false },
      route,
      startedAt: job.startedAt ?? startedAt,
      completedAt: job.completedAt ?? job.updatedAt,
    };
  }

  if (job.replayed) {
    const normalized = toToolError(new Error("Tool call is already running for this idempotency key."));
    return {
      ok: false,
      format: "studio.tool-execution.result.v1",
      jobId: job.jobId,
      toolCallId: job.toolCallId,
      toolName: job.toolName,
      status: "failed",
      error: { ...normalized, code: "duplicate_in_progress", retryable: true },
      route,
      startedAt: job.startedAt ?? startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  const transcriptEvents: ToolTranscriptEventRef[] = [];
  try {
    const callEvent = await safePersist(() => persistToolCallEvent(env, job, request));
    if (callEvent) transcriptEvents.push(callEvent);
    const result = await dispatch(env, request, route);
    const completed = await completeJob(env.TOOL_EXECUTION_DB, job, result);
    const resultEvent = await safePersist(() => persistToolResultEvent(env, completed, request, { ok: true, result }));
    if (resultEvent) transcriptEvents.push(resultEvent);
    return {
      ok: true,
      format: "studio.tool-execution.result.v1",
      jobId: completed.jobId,
      toolCallId: completed.toolCallId,
      toolName: completed.toolName,
      status: "completed",
      result,
      artifacts: extractArtifactUpdates(result),
      transcriptEvents,
      route,
      startedAt: completed.startedAt ?? startedAt,
      completedAt: completed.completedAt ?? new Date().toISOString(),
    };
  } catch (error) {
    const normalized = toToolError(error);
    const failed = await failJob(env.TOOL_EXECUTION_DB, job, normalized);
    const resultEvent = await safePersist(() => persistToolResultEvent(env, failed, request, { ok: false, error: normalized }));
    if (resultEvent) transcriptEvents.push(resultEvent);
    return {
      ok: false,
      format: "studio.tool-execution.result.v1",
      jobId: failed.jobId,
      toolCallId: failed.toolCallId,
      toolName: failed.toolName,
      status: "failed",
      error: normalized,
      transcriptEvents,
      route,
      startedAt: failed.startedAt ?? startedAt,
      completedAt: failed.completedAt ?? new Date().toISOString(),
    };
  }
}

async function safePersist(write: () => Promise<ToolTranscriptEventRef | undefined>): Promise<ToolTranscriptEventRef | undefined> {
  try {
    return await write();
  } catch (error) {
    console.warn("Tool transcript persistence failed", error);
    return undefined;
  }
}

async function dispatch(env: Env, request: ToolExecutionRequest, route: Awaited<ReturnType<typeof resolveRoute>>): Promise<unknown> {
  switch (route.kind) {
    case "agent-runtime":
      return dispatchAgentRuntime(env, request, route);
    case "skill-library":
      return dispatchSkillLibrary(env, request, route);
    case "mcp-server":
    case "remote-mcp":
      if (route.endpoint.startsWith("service-binding://")) return dispatchServiceBoundMcp(env, request, route);
      return dispatchMcpTool(request, route);
    case "connector":
      return dispatchConnector(env, request, route);
    case "native-cloud":
      return dispatchNativeCloud(env, request, route);
    case "local-relay":
      throw notImplemented("Local relay dispatch requires the desktop relay protocol.");
    case "memory":
      return dispatchMemory(env, request, route);
  }
}

function dispatchServiceBoundMcp(env: Env, request: ToolExecutionRequest, route: Extract<Awaited<ReturnType<typeof resolveRoute>>, { kind: "mcp-server" | "remote-mcp" }>): Promise<unknown> {
  const toolName = route.toolName ?? request.toolName;
  if (route.serverId === "studio-agent-execution-mcp") {
    return dispatchAgentRuntime(env, { ...request, toolName }, { kind: "agent-runtime", action: asAgentAction(toolName) });
  }
  if (route.serverId === "studio-skill-library-mcp") {
    return dispatchSkillLibrary(env, { ...request, toolName }, { kind: "skill-library", action: asSkillAction(toolName) });
  }
  throw notImplemented(`No service-binding dispatcher is registered for MCP server ${route.serverId}.`);
}

function asAgentAction(toolName: string): Parameters<typeof dispatchAgentRuntime>[2]["action"] {
  if (toolName === "spawn_agent" || toolName === "await_agent" || toolName === "get_agent_status" || toolName === "report_back" || toolName === "read_agent_result" || toolName === "cancel_agent") return toolName;
  throw notImplemented(`MCP tool ${toolName} is not a supported agent execution action.`);
}

function asSkillAction(toolName: string): Parameters<typeof dispatchSkillLibrary>[2]["action"] {
  if (toolName === "skill_list" || toolName === "skill_search" || toolName === "skill_get" || toolName === "skill_read" || toolName === "skill_read_resource" || toolName === "skill_resolve") return toolName;
  throw notImplemented(`MCP tool ${toolName} is not a supported skill library action.`);
}

function extractArtifactUpdates(result: unknown): ToolArtifactUpdate[] | undefined {
  if (typeof result !== "object" || result === null) return undefined;
  const artifacts = (result as { artifacts?: unknown }).artifacts;
  if (!Array.isArray(artifacts)) return undefined;
  const updates = artifacts.flatMap((item): ToolArtifactUpdate[] => {
    if (typeof item !== "object" || item === null) return [];
    const value = item as Record<string, unknown>;
    if (typeof value.artifactId !== "string") return [];
    return [{
      artifactId: value.artifactId,
      artifactVersionId: typeof value.artifactVersionId === "string" ? value.artifactVersionId : undefined,
      eventId: typeof value.eventId === "string" ? value.eventId : undefined,
      status: typeof value.status === "string" ? value.status : undefined,
      title: typeof value.title === "string" ? value.title : undefined,
    }];
  });
  return updates.length ? updates : undefined;
}
