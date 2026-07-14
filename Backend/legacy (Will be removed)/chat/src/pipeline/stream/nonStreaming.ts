import { ChatPipelineContext } from "../types";
import { createProvider } from "../../server/providers";
import { getRequestEnv } from "../../context";
import { AgentMessage, ToolCall } from "../../agent/state";
import { addCORSHeaders } from "@gateway/middleware/cors";
import { emit } from "../../tracking";
import { serializeToolCall } from "./helpers";
import { runAgentLoop, AgentLoopInput } from "../../agent/loop";
import { fireMemoryProcess } from "../preload";

/**
 * Non-streaming chat path.
 *
 * For models without tool support: calls the provider directly and returns
 * the response. For tool-capable models: runs the full agent loop and returns
 * the final assistant message. If the loop stops on local tool calls, returns
 * a local_tools_pending payload for the client to resume.
 */
export async function handleNonStreaming(ctx: ChatPipelineContext): Promise<Response> {
  const adapter = createProvider(ctx.provider, ctx.apiKey, ctx.apiBaseUrl, getRequestEnv(), ctx.userId ?? undefined);

  if (!ctx.supportsTools) {
    try {
      const message = await adapter.complete({
        model: ctx.modelId,
        messages: ctx.messages,
        temperature: ctx.body.temperature ?? 0.7,
        maxTokens: ctx.body.max_tokens,
      });

      // Fire-and-forget memory processing
      fireMemoryProcess(ctx, [...ctx.messages, message]);

      return addCORSHeaders(
        new Response(
          JSON.stringify({
            id: `chatcmpl-${Date.now()}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: ctx.body.model,
            choices: [{ index: 0, message, finish_reason: "stop" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
    } catch (err: any) {
      emit(ctx.env, ctx.ctx, {
        event: 'chat.request.failed',
        severity: 'error',
        userId: ctx.userId,
        runId: ctx.requestId,
        data: { provider: ctx.provider, model: ctx.body.model, error: err?.message ?? String(err) },
      });
      throw err;
    }
  }

  // Tool-capable path — run the full agent loop
  const loopInput: AgentLoopInput = {
    messages:             ctx.messages,
    modelId:              ctx.modelId,
    provider:             ctx.provider,
    apiKey:               ctx.apiKey,
    apiBaseUrl:           ctx.apiBaseUrl,
    temperature:          ctx.body.temperature ?? 0.7,
    maxTokens:            ctx.body.max_tokens,
    localEngineConnected: ctx.localEngineConnected,
    runningMcpServers:    ctx.body.running_mcp_servers ?? [],
    tavilyApiKey:         ctx.tavilyApiKey,
    userContext:          ctx.userContext,
    requestId:            ctx.requestId,
  };

  let loopResult;
  try {
    // Non-streaming path — we don't emit SSE, just collect the result
    const devNull = (_: string) => { /* discard SSE events in non-streaming mode */ };
    loopResult = await runAgentLoop(loopInput, devNull);
  } catch (err: any) {
    emit(ctx.env, ctx.ctx, {
      event: 'chat.request.failed',
      severity: 'error',
      userId: ctx.userId,
      runId: ctx.requestId,
      data: { provider: ctx.provider, model: ctx.body.model, error: err?.message ?? String(err) },
    });
    throw err;
  }

  if (loopResult.localToolsPending) {
    // Find the pending tool calls from the last assistant message in the loop
    const resolvedMessages = loopResult.resolvedMessages;
    const lastAssistant = [...resolvedMessages].reverse().find(
      (m: AgentMessage) => m.role === "assistant" && m.tool_calls?.length
    );
    const pendingToolCalls: ToolCall[] = lastAssistant?.tool_calls ?? [];

    emit(ctx.env, ctx.ctx, {
      event:    'agent.local_tools.pending',
      severity: 'info',
      userId:   ctx.userId,
      runId:    ctx.requestId,
      data:     { toolCallCount: pendingToolCalls.length },
    });
    return addCORSHeaders(
      new Response(
        JSON.stringify({
          type:      "local_tools_pending",
          messages:  resolvedMessages,
          toolCalls: pendingToolCalls.map((tc: ToolCall) => serializeToolCall(tc)),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
  }

  const finalMessage = [...loopResult.resolvedMessages]
    .reverse()
    .find((m: AgentMessage) => m.role === "assistant" && !m.tool_calls?.length);

  if (ctx.autoRouter && ctx.autoRouterDecision) {
    await ctx.autoRouter.recordRequest(ctx.autoRouterDecision);
  }

  // Fire-and-forget memory processing
  fireMemoryProcess(ctx, loopResult.resolvedMessages);

  return addCORSHeaders(
    new Response(
      JSON.stringify({
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: ctx.body.model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: finalMessage?.content ?? "" },
            finish_reason: "stop",
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  );
}
