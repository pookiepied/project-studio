import type { ContextCacheStatus, RuntimeConsumer } from "../contracts";
import type { Env } from "../system/env";

export interface AssemblyRecordInput {
  userId: string;
  conversationId?: string;
  branchId?: string;
  consumer: RuntimeConsumer;
  taskId: string;
  sourceProjectionId?: string;
  sourceLastSequence?: number;
  toolProjectionGeneratedAt?: string;
  cacheStatus: ContextCacheStatus;
}

export async function recordContextAssembly(env: Env, input: AssemblyRecordInput): Promise<void> {
  await env.CONTEXT_DB.prepare(
    `INSERT INTO context_assemblies
      (id,user_id,conversation_id,branch_id,runtime_consumer,task_id,source_projection_id,
       source_last_sequence,tool_projection_generated_at,cache_status)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    `ctxasm_${crypto.randomUUID()}`,
    input.userId,
    input.conversationId ?? null,
    input.branchId ?? "main",
    input.consumer,
    input.taskId,
    input.sourceProjectionId ?? null,
    input.sourceLastSequence ?? 0,
    input.toolProjectionGeneratedAt ?? null,
    input.cacheStatus,
  ).run();
}

