/**
 * Anthropic Messages adapter - full OpenAI -> Anthropic translation
 * Covers text category only (Anthropic has no image/audio generation)
 */

import type { Adapter } from "../../providers/registry.ts";
import type { ModelDefinition } from "../../providers/types.ts";
import { ANTHROPIC_PRICING, inferReasoningType, type AnthropicModelInfo } from "../../providers/anthropic/types.ts";

const VERSION = "2023-06-01";

export const anthropicMessagesAdapter: Adapter = {
  protocol: "anthropic-messages",

  async discover(apiKey: string, baseUrl: string): Promise<ModelDefinition[]> {
    const all: AnthropicModelInfo[] = [];
    let after: string | undefined;
    for (let i = 0; i < 10; i++) {
      const url = new URL(baseUrl.replace(/\/$/, "") + "/v1/models");
      url.searchParams.set("limit", "100");
      if (after) url.searchParams.set("after_id", after);
      const res = await fetch(url.toString(), {
        headers: { "x-api-key": apiKey, "anthropic-version": VERSION },
      });
      if (!res.ok) throw new Error(`Anthropic list models ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as { data: AnthropicModelInfo[]; has_more: boolean; last_id?: string };
      all.push(...data.data);
      if (!data.has_more || !data.last_id) break;
      after = data.last_id;
    }
    return all.map(toModelDef);
  },

  async chat(apiKey: string, baseUrl: string, body: unknown, signal: AbortSignal): Promise<Response> {
    const b = body as Record<string, unknown>;
    const stream = b.stream === true;
    const anthropicBody = translateOpenAIToAnthropic(b);
    const url = baseUrl.replace(/\/$/, "") + "/v1/messages";
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify(anthropicBody),
      signal,
    });
    if (!stream) {
      // Non-stream: translate Anthropic response back to OpenAI shape
      if (!upstream.ok) return upstream; // pass error through
      const data = (await upstream.json()) as {
        id: string;
        content: Array<{ type: string; text?: string }>;
        usage: { input_tokens: number; output_tokens: number };
        stop_reason: string;
      };
      const text = data.content.filter((x) => x.type === "text").map((x) => x.text ?? "").join("");
      const openAIResp = {
        id: data.id,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: (b.model as string) ?? "unknown",
        choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: mapStop(data.stop_reason) }],
        usage: { prompt_tokens: data.usage.input_tokens, completion_tokens: data.usage.output_tokens, total_tokens: data.usage.input_tokens + data.usage.output_tokens },
      };
      return new Response(JSON.stringify(openAIResp), { status: 200, headers: { "content-type": "application/json" } });
    }
    // Stream: translate Anthropic SSE to OpenAI SSE
    if (!upstream.ok || !upstream.body) return upstream;
    const translated = translateAnthropicSSEToOpenAI(upstream.body, (b.model as string) ?? "unknown");
    return new Response(translated, {
      status: 200,
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" },
    });
  },
};

function toModelDef(m: AnthropicModelInfo): ModelDefinition {
  const pricing = ANTHROPIC_PRICING[m.id] ?? null;
  const reasoning = inferReasoningType(m.capabilities);
  const isVision = m.capabilities?.image_input.supported ?? true;
  const inputModalities: ModelDefinition["inputModalities"] = ["text"];
  if (isVision) inputModalities.push("image");
  return {
    id: m.id,
    providerId: "anthropic",
    displayName: m.display_name,
    category: "text",
    inputModalities,
    outputModalities: ["text"],
    contextWindow: m.max_input_tokens,
    maxOutputTokens: m.max_tokens,
    supportsTools: true,
    supportsParallelTools: true,
    supportsVision: isVision,
    supportsReasoning: reasoning.type !== "none",
    reasoning: reasoning.type === "none" ? null : { type: reasoning.type, levels: reasoning.levels },
    pricing: pricing ? { input: pricing.input, output: pricing.output, cacheRead: null, cacheWrite: null } : null,
    releaseDate: m.created_at,
    raw: m,
  };
}

function translateOpenAIToAnthropic(body: Record<string, unknown>): Record<string, unknown> {
  const messages = (body.messages as Array<{ role: string; content: unknown }>) ?? [];
  let system: string | undefined;
  const anthropicMessages: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    if (m.role === "system" && typeof m.content === "string") {
      system = system ? system + "\n" + (m.content as string) : (m.content as string);
      continue;
    }
    // Map tool role to user with tool_result
    if (m.role === "tool") {
      const toolResult = m as { tool_call_id?: string; content?: string };
      anthropicMessages.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: toolResult.tool_call_id ?? "unknown", content: toolResult.content ?? "" }],
      });
      continue;
    }
    // Map assistant tool_calls
    const assistant = m as { role: string; content?: unknown; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> };
    if (assistant.tool_calls && Array.isArray(assistant.tool_calls)) {
      const blocks: unknown[] = [];
      if (assistant.content) blocks.push({ type: "text", text: assistant.content });
      for (const tc of assistant.tool_calls) {
        let args: unknown = {};
        try { args = JSON.parse(tc.function.arguments); } catch { args = {}; }
        blocks.push({ type: "tool_use", id: tc.id, name: tc.function.name, input: args });
      }
      anthropicMessages.push({ role: "assistant", content: blocks });
      continue;
    }
    anthropicMessages.push({ role: m.role === "assistant" ? "assistant" : "user", content: m.content });
  }
  // Coalesce consecutive tool_result user messages into single user block
  const coalesced: Array<Record<string, unknown>> = [];
  for (const msg of anthropicMessages) {
    const last = coalesced[coalesced.length - 1];
    if (last && last.role === "user" && msg.role === "user" && Array.isArray((last.content as unknown[])) && Array.isArray(msg.content as unknown[])) {
      const lastContent = last.content as unknown[];
      const isToolResult = (c: unknown) => typeof c === "object" && c !== null && "type" in (c as Record<string, unknown>) && (c as Record<string, unknown>).type === "tool_result";
      if (lastContent.some(isToolResult) && (msg.content as unknown[]).some(isToolResult)) {
        last.content = [...lastContent, ...(msg.content as unknown[])];
        continue;
      }
    }
    coalesced.push(msg);
  }
  const tools = body.tools as Array<{ type: string; function: { name: string; description?: string; parameters?: unknown } }> | undefined;
  const anthropicTools = tools?.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters ?? { type: "object", properties: {} },
  }));
  // tool_choice mapping
  let toolChoice: unknown;
  const tc = body.tool_choice;
  if (tc === "auto" || tc === undefined) toolChoice = { type: "auto" };
  else if (tc === "none") toolChoice = { type: "none" };
  else if (tc === "required") toolChoice = { type: "any" };
  else if (tc && typeof tc === "object" && "function" in (tc as Record<string, unknown>)) toolChoice = { type: "tool", name: ((tc as Record<string, unknown>).function as { name: string }).name };

  return {
    model: body.model,
    max_tokens: (body.max_tokens as number) ?? (body.max_completion_tokens as number) ?? 4096,
    ...(system ? { system } : {}),
    messages: coalesced,
    ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
    ...(body.top_p !== undefined ? { top_p: body.top_p } : {}),
    ...(body.stop ? { stop_sequences: Array.isArray(body.stop) ? body.stop : [body.stop] } : {}),
    ...(anthropicTools ? { tools: anthropicTools } : {}),
    ...(toolChoice ? { tool_choice: toolChoice } : {}),
    stream: body.stream ?? false,
  };
}

function mapStop(s: string): string {
  if (s === "end_turn") return "stop";
  if (s === "max_tokens") return "length";
  if (s === "tool_use") return "tool_calls";
  return s;
}

function translateAnthropicSSEToOpenAI(body: ReadableStream<Uint8Array>, model: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";
  let id = `chatcmpl_${Date.now()}`;
  let hasSentRole = false;

  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        let eventName = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventName = line.slice(7).trim();
            continue;
          }
          if (!line.startsWith("data: ")) continue;
          const dataStr = line.slice(6);
          if (!dataStr || dataStr === "[DONE]") continue;
          try {
            const data = JSON.parse(dataStr);
            if (eventName === "message_start" && data.message) {
              id = data.message.id ?? id;
            } else if (eventName === "content_block_delta") {
              const delta = data.delta;
              let content: string | undefined;
              let toolCallDelta: unknown;
              if (delta?.type === "text_delta" && delta.text) content = delta.text;
              else if (delta?.type === "input_json_delta" && delta.partial_json) {
                toolCallDelta = { index: data.index ?? 0, function: { arguments: delta.partial_json } };
              } else if (delta?.type === "thinking_delta") {
                // map thinking to content for now
                content = delta.thinking;
              }
              if (content !== undefined || toolCallDelta) {
                const chunk: Record<string, unknown> = {
                  id,
                  object: "chat.completion.chunk",
                  created: Math.floor(Date.now() / 1000),
                  model,
                  choices: [
                    {
                      index: 0,
                      delta: {
                        ...(hasSentRole ? {} : { role: "assistant" }),
                        ...(content ? { content } : {}),
                        ...(toolCallDelta ? { tool_calls: [toolCallDelta] } : {}),
                      },
                      finish_reason: null,
                    },
                  ],
                };
                hasSentRole = true;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
              }
            } else if (eventName === "content_block_start") {
              const block = data.content_block;
              if (block?.type === "tool_use") {
                const chunk = {
                  id,
                  object: "chat.completion.chunk",
                  created: Math.floor(Date.now() / 1000),
                  model,
                  choices: [{ index: 0, delta: { tool_calls: [{ index: data.index ?? 0, id: block.id, type: "function", function: { name: block.name, arguments: "" } }] }, finish_reason: null }],
                };
                hasSentRole = true;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
              }
            } else if (eventName === "message_delta" && data.delta?.stop_reason) {
              const finish = mapStop(data.delta.stop_reason);
              const chunk = {
                id,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [{ index: 0, delta: {}, finish_reason: finish }],
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
            }
          } catch {
            // ignore parse errors
          }
          eventName = "";
        }
      },
      flush(controller) {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      },
    }),
  );
}
