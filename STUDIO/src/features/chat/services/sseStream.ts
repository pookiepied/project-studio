/**
 * SSE (Server-Sent Events) streaming — kept for useLiveSession voice mode only.
 *
 * The main chat path uses useAgentChat (WebSocket) instead.
 * Do NOT add new callers — use useAgentChat for any new streaming feature.
 *
 * @deprecated Prefer useAgentChat for all new streaming use-cases.
 */

import { apiClient }                              from "@/utils/api";
import type { APIChatMessage, AutoRoutedInfo, LocalToolCall } from "./types";
import { decodeChunk }                            from "./daemonService";

/**
 * Streams tokens from the HTTP /chat/completions SSE endpoint.
 * Used exclusively by useLiveSession (voice mode).
 *
 * Removed dead params vs the original:
 *   - daemonPort / pendingSpecialist (daemon path never fires for voice)
 *   - onSubAgentStart/ToolBatch/Complete/Failed (server no longer emits these on SSE)
 *   - onIterationLimitReached (server no longer emits iteration_limit_reached on SSE)
 *   - onVisionSubstitutions / onThinkingDelta / reasoningBudget (voice path doesn't use them)
 *
 * Signature positions 1-14 match the existing useLiveSession call-site exactly.
 */
export async function* chatStream(
  messages:             APIChatMessage[],
  model:                string,
  temperature          = 0.7,
  localEngineConnected = false,
  onToolProgress?:      (tools: string[]) => void,
  onThinking?:          () => void,
  onAgentError?:        (msg: string) => void,
  onToolStart?:         (callId: string, tool: string, args: Record<string, unknown>) => void,
  onToolComplete?:      (callId: string, tool: string, result: unknown) => void,
  onLocalToolsPending?: (messages: APIChatMessage[], toolCalls: LocalToolCall[], pendingSpecialist?: Record<string, unknown>) => Promise<void>,
  onAutoRouted?:        (info: AutoRoutedInfo) => void,
  runningMcpServers?:   string[],
  _onIterationLimitReached?: (messages: APIChatMessage[]) => Promise<void>,  // kept for call-site compat, server no longer emits this
  signal?:              AbortSignal,
): AsyncGenerator<string, void, unknown> {
  const request = {
    model,
    messages: messages.filter((m) => !(m.role === "system" && model.startsWith("local:"))),
    temperature,
    stream: true,
    local_engine_connected: localEngineConnected,
    running_mcp_servers:    runningMcpServers,
  };

  const response = await apiClient.postStream("/chat/completions", request, signal);
  if (!response.ok) throw new Error(`Stream request failed: ${response.status}`);

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  const processLine = async (line: string): Promise<string | null> => {
    if (!line.startsWith("data: ")) return null;
    const data = line.slice(6);
    if (data === "[DONE]") return null;
    try {
      const parsed = JSON.parse(data);
      switch (parsed.type) {
        case "thinking":      onThinking?.();                                                           return null;
        case "tool_progress": onToolProgress?.(parsed.tools ?? []);                                    return null;
        case "tool_start":    onToolStart?.(parsed.callId, parsed.tool, parsed.args ?? {});            return null;
        case "tool_complete": onToolComplete?.(parsed.callId, parsed.tool, parsed.result);             return null;
        case "local_tools_pending":
          await onLocalToolsPending?.(parsed.messages ?? [], parsed.toolCalls ?? [], parsed.pendingSpecialist);
          return "DONE";
        case "auto_routed":
          onAutoRouted?.({ tier: parsed.tier, model: parsed.model, usedFallback: parsed.usedFallback, usedEmergency: parsed.usedEmergency });
          return null;
        case "error":
          onAgentError?.(parsed.message ?? "Agent error");
          return null;
        default:
          return parsed.choices?.[0]?.delta?.content ?? null;
      }
    } catch {
      return null;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decodeChunk(decoder, value);
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const result = await processLine(line);
      if (result === "DONE") return;
      if (result) yield result;
    }
  }
}
