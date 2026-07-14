import type { ToolExecutionRequest, ToolExecutionResult } from "../contracts";
import type { Env } from "../system/env";
import { notImplemented, toToolError } from "../errors";
import { completeJob, createJob, failJob } from "../jobs/repository";
import { dispatchAgentRuntime } from "./agentRuntime";
import { dispatchMcpTool } from "./mcp";
import { resolveRoute, targetRef } from "./routes";
import { dispatchSkillLibrary } from "./skillLibrary";

export async function executeToolCall(env: Env, request: ToolExecutionRequest): Promise<ToolExecutionResult> {
  const route = await resolveRoute(env, request);
  const startedAt = new Date().toISOString();
  const job = await createJob(env.TOOL_EXECUTION_DB, request, route.kind, targetRef(route));
  if (job.status === "completed") {
    return {
      ok: true,
      jobId: job.jobId,
      toolCallId: job.toolCallId,
      toolName: job.toolName,
      status: "completed",
      result: job.result,
      route,
      startedAt: job.startedAt ?? startedAt,
      completedAt: job.completedAt ?? job.updatedAt,
    };
  }
  if (job.status === "failed") {
    return {
      ok: false,
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

  try {
    const result = await dispatch(env, request, route);
    const completed = await completeJob(env.TOOL_EXECUTION_DB, job, result);
    return {
      ok: true,
      jobId: completed.jobId,
      toolCallId: completed.toolCallId,
      toolName: completed.toolName,
      status: "completed",
      result,
      route,
      startedAt: completed.startedAt ?? startedAt,
      completedAt: completed.completedAt ?? new Date().toISOString(),
    };
  } catch (error) {
    const normalized = toToolError(error);
    const failed = await failJob(env.TOOL_EXECUTION_DB, job, normalized);
    return {
      ok: false,
      jobId: failed.jobId,
      toolCallId: failed.toolCallId,
      toolName: failed.toolName,
      status: "failed",
      error: normalized,
      route,
      startedAt: failed.startedAt ?? startedAt,
      completedAt: failed.completedAt ?? new Date().toISOString(),
    };
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
      return dispatchMcpTool(request, route);
    case "connector":
      throw notImplemented("Connector dispatch requires a stable Connectors execution contract.");
    case "native-cloud":
      throw notImplemented("Native cloud tool dispatch requires a stable Native Tools service contract.");
    case "local-relay":
      throw notImplemented("Local relay dispatch requires the desktop relay protocol.");
    case "memory":
      throw notImplemented("Memory dispatch requires the Memory service contract.");
  }
}
