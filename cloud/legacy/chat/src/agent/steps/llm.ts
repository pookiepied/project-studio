import { AgentStateType, AgentMessage } from "../state";
import { createProvider } from "../../server/providers";
import { getRequestEnv, getRegistryById } from "../../context";
import { logger } from "../../logger";
import { spanStart, spanEnd } from "../../tracking";
import type { CapturedUsage } from "@gateway/providers/types";
import { LLMToolDefinition } from "../../tools/base/types";
import {
  EXPAND_TOOLS_DEFINITION,
  parseExpandArgs,
  getExpandCountSinceLastUser,
  filterToScope,
  applyExpandFilter,
} from "../../tools/agentic/expandTools";

export interface LlmStepResult {
  message: AgentMessage;
  capturedUsage: CapturedUsage | null;
}

/**
 * LLM step — the reasoning step of the ReAct loop.
 *
 * Sends the full conversation history plus tool definitions to the provider.
 * Returns the assistant's response message (with or without tool_calls).
 *
 * Tool visibility rules:
 *   1. expand_tools was called in the most recent tool batch → show a
 *      scoped expansion set for one iteration.
 *   2. Otherwise → always include core tools, filter MCP schemas by keyword
 *      match against recent messages (plus already-active servers), and append
 *      expand_tools so the LLM can request more if needed.
 *
 * All provider-specific behaviour (token cleaning, 402 retry, tool quirks)
 * is handled by the provider adapter — this step is provider-agnostic.
 */
/**
 * @param enqueue  When provided the step uses streamFull() to emit tokens in
 *                 real-time (same pattern as Phase 1 in the HTTP path). Pass
 *                 this from the WebSocket agent loop so the client sees each
 *                 token as it arrives instead of the whole response at once.
 *                 Omit (or pass undefined) to use the original complete() path.
 */
export async function runLlmStep(
  state: AgentStateType,
  enqueue?: (data: string) => void,
): Promise<LlmStepResult> {
  // The loop may have already obtained this turn's assistant message via direct
  // streaming (Phase 1). Return it immediately and clear the field so subsequent
  // iterations call the provider normally.
  if (state.precomputedAssistantMessage) {
    logger.info("LLM step: returning precomputed message from direct stream", {
      hasToolCalls: !!state.precomputedAssistantMessage.tool_calls?.length,
    });
    return { message: state.precomputedAssistantMessage, capturedUsage: null };
  }

  const registry = getRegistryById(state.requestId);

  // Signal 1: expand_tools was called in the MOST RECENT tool batch only.
  const lastAssistantIdx = (() => {
    for (let i = state.messages.length - 1; i >= 0; i--) {
      if (state.messages[i].role === "assistant") return i;
    }
    return -1;
  })();
  const recentToolResults = lastAssistantIdx >= 0
    ? state.messages.slice(lastAssistantIdx + 1)
    : [];
  const expandRequested = recentToolResults.some(
    (m) => m.role === "tool" && m.name === "expand_tools"
  );
  const expandCountSinceLastUser = getExpandCountSinceLastUser(state.messages);
  const canOfferExpand = expandCountSinceLastUser < 2;
  const expandCall = lastAssistantIdx >= 0
    ? state.messages[lastAssistantIdx]?.tool_calls?.find((tc) => tc.function.name === "expand_tools")
    : undefined;
  const expandArgs = parseExpandArgs(expandCall?.function?.arguments);

  // Signal 2: which specific MCP servers have been used in this conversation.
  const activeServers = new Set<string>();
  for (const m of state.messages) {
    if (m.role === "assistant" && m.tool_calls?.length) {
      for (const tc of m.tool_calls) {
        if (tc.function.name.startsWith("mcp_")) {
          const withoutPrefix = tc.function.name.slice(4);
          const sep = withoutPrefix.indexOf("__");
          if (sep !== -1) activeServers.add(withoutPrefix.slice(0, sep).toLowerCase());
        }
      }
    }
  }

  if (state.localEngineConnected) {
    activeServers.add("studio_harness");
  }


  const expandIsIndex = expandRequested && expandArgs.filter === "index";
  const shouldExpandSchemas = expandRequested && !expandIsIndex;

  const recentContextText = state.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-5)
    .map((m) => {
      if (typeof m.content === "string") return m.content;
      if (Array.isArray(m.content)) {
        return (m.content as { type: string; text?: string }[])
          .filter((p) => p.type === "text")
          .map((p) => p.text ?? "")
          .join(" ");
      }
      return "";
    })
    .join(" ");

  let toolDefinitions: LLMToolDefinition[];

  if (shouldExpandSchemas) {
    const scope = filterToScope(expandArgs.filter);
    let defs = registry.getContextualDefinitions(state.localEngineConnected, {
      scope,
      message: expandArgs.filter === "mcp" ? expandArgs.hint : undefined,
      coreMode: "all",
    });
    defs = applyExpandFilter(
      defs,
      (name) => registry.get(name)?.executionTarget,
      expandArgs.filter
    );
    toolDefinitions = defs;
  } else {
    toolDefinitions = [
      ...registry.getContextualDefinitions(state.localEngineConnected, {
        message: recentContextText || undefined,
        activeServers: activeServers.size > 0 ? activeServers : undefined,
        coreMode: "baseline",
      }),
      ...(canOfferExpand ? [EXPAND_TOOLS_DEFINITION] : []),
    ];
  }

  if (state.localEngineConnected) {
    // LSP tools are internal plumbing — never exposed to the model.
    // The main agent otherwise has full access to every harness tool.
    toolDefinitions = toolDefinitions.filter(
      (t) => !t.function.name.startsWith("mcp_studio_harness__lsp_")
    );
  }

  logger.info("LLM step: calling provider", {
    provider: state.provider,
    model: state.modelId,
    messages: state.messages.length,
    tools: toolDefinitions.length,
  });

  if (state.provider === "local") {
    throw new Error(
      "Local Ollama model inference is not supported in this version. " +
        "Please select a cloud model (Groq, OpenRouter, Anthropic, etc.)."
    );
  }

  const adapter = createProvider(state.provider, state.apiKey, state.apiBaseUrl, getRequestEnv(), (state.userContext as any)?.userId as string | undefined);

  const llmStart = Date.now();
  let capturedUsage: CapturedUsage | null = null;
  const env    = getRequestEnv()!;
  const userId = (state.userContext as any)?.userId as string | undefined;
  const spanId = crypto.randomUUID();

  spanStart({
    env,
    spanId,
    runId:        state.requestId,
    spanType:     'llm',
    name:         `${state.provider}/${state.modelId}`,
    userId,
    metadata:     { provider: state.provider, model: state.modelId, tools: toolDefinitions.length },
  });

  try {
    let message: AgentMessage;

    if (enqueue) {
      // ── Streaming path (WebSocket agent loop) ─────────────────────────
      // Mirrors runPhase1: iterate streamFull() and emit each token over the
      // WebSocket so the client sees output as it arrives.
      let content = "";
      const toolCalls: import("../state").ToolCall[] = [];
      let hadReasoning = false;

      for await (const event of adapter.streamFull({
        model:       state.modelId,
        messages:    state.messages,
        temperature: state.temperature,
        maxTokens:   state.maxTokens,
        tools:       toolDefinitions.length > 0 ? toolDefinitions : undefined,
        toolChoice:  toolDefinitions.length > 0 ? "auto" : undefined,
      })) {
        if (event.type === "content") {
          content += event.chunk;
          enqueue(JSON.stringify({ type: "stream", choices: [{ delta: { content: event.chunk } }] }));
        } else if (event.type === "reasoning") {
          if (!hadReasoning) {
            enqueue(JSON.stringify({ type: "thinking" }));
            hadReasoning = true;
          }
          enqueue(JSON.stringify({ type: "thinking_delta", chunk: event.chunk }));
        } else if (event.type === "tool_calls") {
          toolCalls.push(...event.calls);
        } else if (event.type === "usage") {
          capturedUsage = event.data;
        }
      }

      message = {
        role:      "assistant",
        content,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      };
    } else {
      // ── Non-streaming path (HTTP agent loop / backward compat) ─────────
      message = await adapter.complete({
        model:        state.modelId,
        messages:     state.messages,
        temperature:  state.temperature,
        maxTokens:    state.maxTokens,
        tools:        toolDefinitions.length > 0 ? toolDefinitions : undefined,
        toolChoice:   toolDefinitions.length > 0 ? "auto" : undefined,
        captureUsage: (u) => { capturedUsage = u; },
      });
    }

    logger.info("LLM step: response received", {
      hasToolCalls:  !!message.tool_calls?.length,
      toolCallCount: message.tool_calls?.length ?? 0,
      contentLength: message.content?.length ?? 0,
      streaming:     !!enqueue,
    });

    const outputPreview = typeof message.content === 'string'
      ? message.content.slice(0, 300)
      : undefined;

    const cu = capturedUsage as CapturedUsage | null;
    spanEnd({
      env,
      spanId,
      status:     'success',
      outputPreview,
      tokensIn:   cu?.prompt_tokens,
      tokensOut:  cu?.completion_tokens,
      costUsd:    cu?.cost,
    });

    return { message, capturedUsage };
  } catch (err: unknown) {
    spanEnd({
      env,
      spanId,
      status: 'error',
      error:  err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
