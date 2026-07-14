import type { ToolExecutionError, ToolExecutionJobRecord, ToolExecutionRequest, ToolJobStatus } from "../contracts";

type JobRow = Record<string, unknown>;

export async function createJob(db: D1Database, request: ToolExecutionRequest, routeKind?: string, targetRef?: string): Promise<ToolExecutionJobRecord> {
  const now = new Date().toISOString();
  const job: ToolExecutionJobRecord = {
    jobId: request.jobId ?? crypto.randomUUID(),
    userId: request.userId,
    sessionId: request.sessionId,
    conversationId: request.conversationId,
    agentExecutionId: request.agentExecutionId,
    toolCallId: request.toolCallId,
    sourceRuntime: request.sourceRuntime,
    toolName: request.toolName,
    status: "running",
    routeKind,
    targetRef,
    idempotencyKey: request.idempotencyKey,
    request,
    createdAt: now,
    startedAt: now,
    updatedAt: now,
  };

  const existing = request.idempotencyKey ? await findByIdempotencyKey(db, request.userId, request.idempotencyKey) : null;
  if (existing) return existing;

  await db.prepare(
    `INSERT INTO tool_execution_jobs (
      job_id, user_id, session_id, conversation_id, agent_execution_id, tool_call_id,
      source_runtime, tool_name, status, route_kind, target_ref, idempotency_key,
      request_json, started_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    job.jobId,
    job.userId,
    job.sessionId ?? null,
    job.conversationId ?? null,
    job.agentExecutionId ?? null,
    job.toolCallId,
    job.sourceRuntime,
    job.toolName,
    job.status,
    job.routeKind ?? null,
    job.targetRef ?? null,
    job.idempotencyKey ?? null,
    JSON.stringify(request),
    job.startedAt,
    job.createdAt,
    job.updatedAt,
  ).run();

  return job;
}

export async function completeJob(db: D1Database, job: ToolExecutionJobRecord, result: unknown): Promise<ToolExecutionJobRecord> {
  return finishJob(db, job, "completed", result, undefined);
}

export async function failJob(db: D1Database, job: ToolExecutionJobRecord, error: ToolExecutionError): Promise<ToolExecutionJobRecord> {
  return finishJob(db, job, "failed", undefined, error);
}

async function finishJob(
  db: D1Database,
  job: ToolExecutionJobRecord,
  status: Extract<ToolJobStatus, "completed" | "failed">,
  result?: unknown,
  error?: ToolExecutionError,
): Promise<ToolExecutionJobRecord> {
  const now = new Date().toISOString();
  await db.prepare(
    `UPDATE tool_execution_jobs
      SET status = ?, result_json = ?, error_json = ?, completed_at = ?, updated_at = ?
      WHERE job_id = ? AND user_id = ?`,
  ).bind(
    status,
    result === undefined ? null : JSON.stringify(result),
    error === undefined ? null : JSON.stringify(error),
    now,
    now,
    job.jobId,
    job.userId,
  ).run();
  return { ...job, status, result, error, completedAt: now, updatedAt: now };
}

async function findByIdempotencyKey(db: D1Database, userId: string, idempotencyKey: string): Promise<ToolExecutionJobRecord | null> {
  const row = await db.prepare("SELECT * FROM tool_execution_jobs WHERE user_id = ? AND idempotency_key = ?").bind(userId, idempotencyKey).first<JobRow>();
  return row ? toJob(row) : null;
}

function toJob(row: JobRow): ToolExecutionJobRecord {
  return {
    jobId: String(row.job_id),
    userId: String(row.user_id),
    sessionId: row.session_id ? String(row.session_id) : undefined,
    conversationId: row.conversation_id ? String(row.conversation_id) : undefined,
    agentExecutionId: row.agent_execution_id ? String(row.agent_execution_id) : undefined,
    toolCallId: String(row.tool_call_id),
    sourceRuntime: row.source_runtime as ToolExecutionJobRecord["sourceRuntime"],
    toolName: String(row.tool_name),
    status: row.status as ToolJobStatus,
    routeKind: row.route_kind ? String(row.route_kind) : undefined,
    targetRef: row.target_ref ? String(row.target_ref) : undefined,
    idempotencyKey: row.idempotency_key ? String(row.idempotency_key) : undefined,
    request: parseJson<ToolExecutionRequest>(row.request_json, {} as ToolExecutionRequest),
    result: row.result_json ? parseJson<unknown>(row.result_json, undefined) : undefined,
    error: row.error_json ? parseJson<ToolExecutionError>(row.error_json, undefined as unknown as ToolExecutionError) : undefined,
    createdAt: String(row.created_at),
    startedAt: row.started_at ? String(row.started_at) : undefined,
    completedAt: row.completed_at ? String(row.completed_at) : undefined,
    updatedAt: String(row.updated_at),
  };
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
