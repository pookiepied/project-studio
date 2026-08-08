import { Env } from '../../env';
import { ChatMessage } from '../types';
import { createErrorResponse } from '@gateway/middleware/response';
import { recordUsage } from '@gateway/tracking';
import { logger } from '../../logger';
import { createRequestRegistry } from '../../tools';
import { loadMcpTools } from '../../tools/mcp';
import { extractUserId } from '../middleware/auth';
import { runWithEnv } from '../../context';
/**
 * POST /v1/chat/save
 * Called by the desktop app after a local-model conversation completes.
 *
 * Records a usage event so local inference shows up in the Activity Dashboard
 * alongside cloud requests. Local has no monetary cost, so cost_usd /
 * estimated_cost_usd stay null — the logical tag is provider="local" with the
 * engine (lmstudio / ollama) in `source` and the model name in `model`.
 *
 * Token counts and latency are recorded when the desktop app forwards them
 * (LM Studio and Ollama both return OpenAI-style usage); otherwise they are null
 * and the event still captures the request, model, and engine.
 */
export async function handleLocalChatSave(
  request: Request, env: Env, ctx?: ExecutionContext
): Promise<Response> {
  try {
    const body = await request.json() as {
      model:        string;
      messages:     ChatMessage[];
      engine?:      string;   // "lmstudio" | "ollama" | ...
      userId?:      string;
      inputTokens?:  number;
      outputTokens?: number;
      totalTokens?:  number;
      latencyMs?:    number;
    };

    const { model, messages } = body;

    if (!model || !messages || !Array.isArray(messages)) {
      return createErrorResponse('Invalid request: model and messages are required', 400, 'invalid_request');
    }

    const userId = (await extractUserId(request, env).catch(() => null)) ?? body.userId;
    const engine = body.engine?.trim() || 'local';

    const hasTokens =
      body.inputTokens != null || body.outputTokens != null || body.totalTokens != null;
    const capturedUsage = hasTokens
      ? {
          prompt_tokens:     body.inputTokens  ?? undefined,
          completion_tokens: body.outputTokens ?? undefined,
          total_tokens:      body.totalTokens  ?? undefined,
        }
      : null;

    // Fire-and-forget to the tracker worker (cost stays null — local = no cost).
    recordUsage({
      env,
      ctx,
      userId,
      provider:     'local',
      model,
      capturedUsage,
      requestStart: Date.now() - (body.latencyMs ?? 0),
      requestType:  'chat',
      status:       'success',
      source:       engine,
    });

    logger.info('[localInference] Usage recorded', { model, engine, userId, tokens: hasTokens });

    return new Response(JSON.stringify({ success: true, message: 'Conversation saved' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    logger.error('[localInference] Failed to save conversation', { error });
    return createErrorResponse('Failed to save conversation', 500, 'internal_error');
  }
}

/**
 * POST /v1/tool-execute
 * Called by the local daemon when a local model makes a tool call.
 * Executes the tool via the cloud tool registry and returns the result.
 */
export async function handleToolExecute(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as {
      toolName: string;
      toolInput: Record<string, unknown>;
      sessionId?: string;
    };

    const { toolName, toolInput, sessionId } = body;
    const userId = (body as any).userId as string | undefined;

    if (!toolName || toolInput === undefined) {
      return createErrorResponse('Invalid request: toolName and toolInput are required', 400, 'invalid_request');
    }

    logger.info(`[localInference] Tool execute: ${toolName}`, { sessionId });

    const toolResult = await runWithEnv(env, async () => {
      const { tools: mcpTools } = userId && env.MCP && env.MCP_KV
        ? await loadMcpTools(userId, env.MCP, env.MCP_KV, undefined).catch(() => ({ tools: [] }))
        : { tools: [] };
      const registry = createRequestRegistry(mcpTools);
      return registry.execute(toolName, toolInput);
    });

    logger.info(`[localInference] Tool result: ${toolName}`, { success: toolResult.success });

    return new Response(JSON.stringify({
      success: toolResult.success,
      result: toolResult.success ? toolResult.result : undefined,
      error: toolResult.success ? undefined : toolResult.error,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    logger.error('[localInference] Failed to execute tool', { error });
    return createErrorResponse('Failed to execute tool', 500, 'internal_error');
  }
}
