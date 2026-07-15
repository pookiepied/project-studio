import type {
  ContextPackage,
  ProviderNeutralMessage,
  ProviderNeutralMessagePart,
  ProviderNeutralToolSchema,
  StudioToolDescriptor,
} from "../contracts";
import type { LoopResult, RegisteredTool, RuntimeEnv, RuntimeProfile, ToolExecutionResult } from "./RuntimeSession";

export interface ModelLoopRun {
  runId: string;
  userId: string;
  modelId: string;
  request: string;
  limits?: {
    maxModelSteps?: number;
    maxToolCalls?: number;
    maxTotalTokens?: number;
  };
}

export interface ModelLoopHost<Env extends RuntimeEnv> {
  env: Env;
  profile: RuntimeProfile;
  emit(type: string, payload: Record<string, unknown>): Promise<void>;
  executeTool(tool: RegisteredTool, args: Record<string, unknown>, toolCallId?: string): Promise<ToolExecutionResult>;
  refreshTools(): Promise<Record<string, RegisteredTool>>;
}

interface GatewayChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Array<{ type: "text"; text: string }>;
  toolCallId?: string;
}

interface GatewayTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

interface GatewayToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface GatewayChatResponse {
  id?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: GatewayToolCall[];
    };
    finish_reason?: string | null;
  }>;
  usage?: unknown;
}

export async function runModelLoop<Env extends RuntimeEnv>(input: {
  host: ModelLoopHost<Env>;
  run: ModelLoopRun;
  context: ContextPackage | null;
  systemPrompt: string;
  initialTools: Record<string, RegisteredTool>;
}): Promise<LoopResult> {
  const maxModelSteps = bounded(input.run.limits?.maxModelSteps, 8, 1, 32);
  const maxToolCalls = bounded(input.run.limits?.maxToolCalls, 16, 0, 100);
  let toolCallsUsed = 0;
  let tools = input.initialTools;
  const messages = lowerContextToMessages(input.context, input.systemPrompt, input.run.request);
  const assistantOutputs: string[] = [];

  for (let step = 1; step <= maxModelSteps; step += 1) {
    await input.host.emit("model.call.started", { step, modelId: input.run.modelId, toolCount: Object.keys(tools).length });
    const response = await callGateway(input.host.env, input.run, messages, Object.values(tools).map((entry) => entry.descriptor));
    const choice = response.choices?.[0];
    const assistantText = choice?.message?.content ?? "";
    const toolCalls = choice?.message?.tool_calls ?? [];
    await input.host.emit("model.call.completed", {
      step,
      modelId: input.run.modelId,
      responseId: response.id,
      finishReason: choice?.finish_reason ?? null,
      usage: response.usage,
      textLength: assistantText.length,
      toolCallCount: toolCalls.length,
    });

    if (assistantText) {
      assistantOutputs.push(assistantText);
      messages.push({ role: "assistant", content: assistantText });
      await input.host.emit("assistant.delta", { text: assistantText, channel: "final" });
    }

    if (!toolCalls.length) return { text: finalText(assistantOutputs) };
    for (const call of toolCalls) {
      if (toolCallsUsed >= maxToolCalls) {
        await input.host.emit("tool.call.failed", { toolCallId: call.id, toolName: call.function.name, error: "max_tool_calls_exceeded" });
        return { text: finalText(assistantOutputs) };
      }
      const tool = tools[call.function.name];
      if (!tool) {
        const content = JSON.stringify({ ok: false, error: { code: "tool_not_available", message: `Tool ${call.function.name} is not available.` } });
        messages.push({ role: "tool", toolCallId: call.id, content });
        await input.host.emit("tool.call.failed", { toolCallId: call.id, toolName: call.function.name, error: "tool_not_available" });
        continue;
      }
      toolCallsUsed += 1;
      const args = parseToolArguments(call.function.arguments);
      const result = await input.host.executeTool(tool, args, call.id);
      messages.push({ role: "tool", toolCallId: call.id, content: JSON.stringify(result) });
      if (tool.descriptor.name === "resolve_tool" && result.ok) {
        tools = await input.host.refreshTools();
      }
      if (result.status === "waiting_for_permission") return { text: finalText(assistantOutputs) };
    }
  }

  await input.host.emit("model.loop.stopped", { reason: "max_model_steps_exceeded", maxModelSteps });
  return { text: finalText(assistantOutputs) };
}

function lowerContextToMessages(context: ContextPackage | null, systemPrompt: string, fallbackUserMessage: string): GatewayChatMessage[] {
  const messages: GatewayChatMessage[] = [{ role: "system", content: systemPrompt }];
  const modelInput = context?.sendable?.modelInput;
  if (!modelInput) {
    messages.push({ role: "user", content: fallbackUserMessage });
    return messages;
  }
  for (const message of modelInput.messages) {
    const lowered = lowerMessage(message);
    if (lowered.content.length === 0) continue;
    messages.push(lowered);
  }
  return dedupeCurrentUserMessage(messages, fallbackUserMessage);
}

function lowerMessage(message: ProviderNeutralMessage): GatewayChatMessage {
  return {
    role: message.role,
    content: message.parts.map(lowerPart).filter(Boolean).join("\n\n"),
  };
}

function lowerPart(part: ProviderNeutralMessagePart): string {
  switch (part.kind) {
    case "text":
      return part.text;
    case "summary":
      return part.text;
    case "image_ref":
      return `[Image reference: ${part.title ?? part.resourceId}${part.contentType ? ` (${part.contentType})` : ""}]`;
    case "file_ref":
      return `[File reference: ${part.title ?? part.resourceId}${part.contentType ? ` (${part.contentType})` : ""}]`;
    case "artifact_ref":
      return `[Artifact: ${part.title} (${part.artifactId})${part.summary ? `\n${part.summary}` : ""}]`;
    case "attachment_ref":
      return `[Attachment: ${part.title} (${part.attachmentId})${part.summary ? `\n${part.summary}` : ""}]`;
    case "tool_call":
      return `[Tool call: ${part.toolName}${part.inputSummary ? `\n${part.inputSummary}` : ""}]`;
    case "tool_result":
      return `[Tool result${part.toolName ? `: ${part.toolName}` : ""}\n${part.summary}]`;
  }
}

function dedupeCurrentUserMessage(messages: GatewayChatMessage[], fallbackUserMessage: string): GatewayChatMessage[] {
  if (messages.some((message) => message.role === "user")) return messages;
  return [...messages, { role: "user", content: fallbackUserMessage }];
}

async function callGateway<Env extends RuntimeEnv>(
  env: Env,
  run: ModelLoopRun,
  messages: GatewayChatMessage[],
  tools: StudioToolDescriptor[],
): Promise<GatewayChatResponse> {
  const response = await env.GATEWAY.fetch("https://gateway/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": run.userId },
    body: JSON.stringify({
      model: run.modelId,
      messages,
      tools: tools.map(toGatewayTool),
      toolChoice: tools.length ? "auto" : "none",
      user: run.userId,
    }),
  });
  const body = await readJson<GatewayChatResponse | { error?: unknown }>(response);
  if (!response.ok) throw new Error(`Gateway chat failed (${response.status}): ${JSON.stringify(body)}`);
  return body as GatewayChatResponse;
}

function toGatewayTool(tool: StudioToolDescriptor | ProviderNeutralToolSchema): GatewayTool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema ?? { type: "object", properties: {} },
    },
  };
}

function parseToolArguments(input: string): Record<string, unknown> {
  if (!input.trim()) return {};
  try {
    const parsed = JSON.parse(input);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return { error: text } as T;
  }
}

function bounded(input: number | undefined, fallback: number, min: number, max: number): number {
  if (input === undefined || !Number.isFinite(input)) return fallback;
  return Math.max(min, Math.min(Math.floor(input), max));
}

function finalText(outputs: string[]): string {
  return outputs.join("\n\n").trim();
}
