import type { ToolExecutionError, ToolExecutionJobRecord, ToolExecutionRequest, ToolTranscriptEventRef } from "../contracts";
import { upstreamError } from "../errors";
import { jsonHeaders } from "../system/http";
import type { Env } from "../system/env";

type ToolEventKind = "tool_call" | "tool_result";

export async function persistToolCallEvent(env: Env, job: ToolExecutionJobRecord, request: ToolExecutionRequest): Promise<ToolTranscriptEventRef | undefined> {
  if (!request.conversationId) return undefined;
  return appendToolEvent(env, request, {
    id: `ce_tool_call_${job.jobId}`,
    kind: "tool_call",
    role: null,
    summary: `Called ${request.toolName}.`,
    content: JSON.stringify({ toolName: request.toolName, arguments: request.arguments }),
    metadata: {
      jobId: job.jobId,
      routeKind: job.routeKind,
      targetRef: job.targetRef,
      sourceRuntime: request.sourceRuntime,
    },
  });
}

export async function persistToolResultEvent(
  env: Env,
  job: ToolExecutionJobRecord,
  request: ToolExecutionRequest,
  outcome: { ok: true; result: unknown } | { ok: false; error: ToolExecutionError },
): Promise<ToolTranscriptEventRef | undefined> {
  if (!request.conversationId) return undefined;
  return appendToolEvent(env, request, {
    id: `ce_tool_result_${job.jobId}`,
    kind: "tool_result",
    role: "tool",
    summary: outcome.ok ? `Completed ${request.toolName}.` : `Failed ${request.toolName}: ${outcome.error.message}`,
    content: JSON.stringify(outcome.ok ? outcome.result : { error: outcome.error }),
    metadata: {
      jobId: job.jobId,
      ok: outcome.ok,
      sourceRuntime: request.sourceRuntime,
    },
  });
}

async function appendToolEvent(
  env: Env,
  request: ToolExecutionRequest,
  event: {
    id: string;
    kind: ToolEventKind;
    role: "tool" | null;
    summary: string;
    content: string;
    metadata: Record<string, unknown>;
  },
): Promise<ToolTranscriptEventRef> {
  const response = await env.DATA.fetch("https://data/transcripts/events", {
    method: "POST",
    headers: jsonHeaders(request.userId),
    body: JSON.stringify({
      id: event.id,
      conversationId: request.conversationId,
      turnId: request.metadata?.turnId ?? request.toolCallId,
      branchId: typeof request.metadata?.branchId === "string" ? request.metadata.branchId : "main",
      runId: request.agentExecutionId ?? request.sessionId,
      source: "tool-execution",
      kind: event.kind,
      visibility: event.kind === "tool_result" ? "model" : "internal",
      role: event.role,
      content: event.content,
      summary: event.summary,
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      metadata: event.metadata,
    }),
  });
  const body = await readJson(response);
  if (!response.ok) throw upstreamError("Studio Data transcript append failed.", body, response.status >= 500);
  return { eventId: event.id, kind: event.kind };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}
