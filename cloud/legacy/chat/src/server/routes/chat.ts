import { Env } from "../../env";
import { logger } from "../../logger";
import { createErrorResponse } from "@gateway/middleware/response";
import { runWithEnv, runWithBaseUrl, runWithCtx, clearRequestRegistry, clearRequestContext } from "../../context";
import { ChatPipelineContext } from "../../pipeline/types";
import { parseRequest } from "../../pipeline/parse";
import { extractUserContext } from "../../pipeline/userContext";
import { preload } from "../../pipeline/preload";
import { assembleMessages } from "../../pipeline/assembleMessages";
import { preprocessVision } from "../../inputs/image";
import { buildLocalDispatch, setupDispatch } from "../../pipeline/dispatch";
import { handleNonStreaming } from "../../pipeline/stream/nonStreaming";
import { handleStreaming } from "../../pipeline/stream";
import { emit } from "../../tracking";

/**
 * Chat completions endpoint — thin coordinator.
 *
 * Sequences the pipeline stages in order. Each stage reads from and writes to
 * the shared ChatPipelineContext. Stages that can short-circuit (validation
 * errors, local model dispatch, vision failures) return a Response directly.
 *
 * Cleanup for the non-streaming path happens in the try/finally below.
 * Cleanup for the streaming path happens inside the stream's own finally block
 * because the coordinator's finally runs when the Response is returned, which
 * is before the stream body is consumed.
 */
export async function handleChat(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  isServiceBinding = false,
): Promise<Response> {
  const requestStart = Date.now();

  try {
    const parsed = await parseRequest(request, env);
    if (parsed instanceof Response) return parsed;

    emit(env, ctx, {
      event: 'chat.request.started',
      data:  { model: parsed.body.model, stream: parsed.body.stream, provider: parsed.provider },
    });

    if (parsed.autoRouterDecision) {
      emit(env, ctx, {
        event: 'router.decided',
        data: {
          tier:         parsed.autoRouterDecision.tier,
          model:        parsed.autoRouterDecision.model,
          usedFallback: parsed.autoRouterDecision.usedFallback,
        },
      });
    }

    const pipelineCtx = {
      request, env, ctx, requestStart,
      isServiceBinding,
      ...parsed,
      userId: undefined,
      userContext: {} as any,
      localEngineConnected: false,
      userProfile: null,
      memoryContext: null,
      skillsIndex: null,
      mcpServers: [],
      mcpDynamicTools: [],
      composioTools: [],
      composioApps: [],
      requestRegistry: null as any,
      messages: [],
      requestId: "",
      threadId: "",
      workerBaseUrl: "",
      tavilyApiKey: "",
    } as ChatPipelineContext;

    await extractUserContext(pipelineCtx);

    // Reject unauthenticated requests when JWT auth is configured.
    // userId is undefined when the token is missing, invalid, or expired.
    if (env.JWT_SECRET && !pipelineCtx.userId) {
      return createErrorResponse("Authentication required.", 401, "unauthorized_error", request);
    }

    await preload(pipelineCtx);
    assembleMessages(pipelineCtx);

    const visionError = await preprocessVision(pipelineCtx);
    if (visionError) return visionError;

    const localResponse = buildLocalDispatch(pipelineCtx);
    if (localResponse) return localResponse;

    setupDispatch(pipelineCtx);

    if (pipelineCtx.body.stream) {
      return runWithCtx(ctx, () =>
        runWithBaseUrl(pipelineCtx.workerBaseUrl, () =>
          runWithEnv(env, () => handleStreaming(pipelineCtx))
        )
      );
    }

    try {
      const response = await runWithCtx(ctx, () =>
        runWithBaseUrl(pipelineCtx.workerBaseUrl, () =>
          runWithEnv(env, () => handleNonStreaming(pipelineCtx))
        )
      );
      emit(env, ctx, {
        event:  'chat.request.completed',
        userId: pipelineCtx.userId,
        runId:  pipelineCtx.requestId,
        data:   { latencyMs: Date.now() - requestStart, stream: false },
      });
      return response;
    } finally {
      clearRequestRegistry(pipelineCtx.requestId);
      clearRequestContext(pipelineCtx.requestId);
      // agentContext (AgentContextDO) removed — no cleanup needed
    }
  } catch (error) {
    logger.error("Chat handler error", error);
    emit(env, ctx, {
      event:    'chat.request.failed',
      severity: 'error',
      data:     { error: error instanceof Error ? error.message : String(error) },
    });
    return error instanceof Error
      ? createErrorResponse(error.message, 500, "internal_error")
      : createErrorResponse("Unexpected error processing chat request.", 500, "internal_error");
  }
}
