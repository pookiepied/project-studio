/**
 * Google Generative AI adapter
 * Protocol: google-generative-ai
 * Endpoints: POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 *            POST ...:streamGenerateContent?alt=sse (stream)
 * Auth: x-goog-api-key: {apiKey}  (or ?key=)
 * Covers Gemini via AI Studio. Vertex variant shares same wire, different auth - future.
 */

import type { Adapter } from "../../providers/registry.ts";
import type { ModelDefinition } from "../../providers/types.ts";

export const googleGenerativeAdapter: Adapter = {
  protocol: "google-generative-ai",

  async discover(apiKey: string, baseUrl: string): Promise<ModelDefinition[]> {
    // Gemini models list: GET https://generativelanguage.googleapis.com/v1beta/models?key=API_KEY
    // baseUrl may be https://generativelanguage.googleapis.com
    const url = baseUrl.replace(/\/$/, "") + "/v1beta/models?key=" + encodeURIComponent(apiKey);
    // Try with key query first
    let res = await fetch(url);
    if (!res.ok) {
      // Fallback header
      res = await fetch(baseUrl.replace(/\/$/, "") + "/v1beta/models", {
        headers: { "x-goog-api-key": apiKey },
      });
    }
    if (!res.ok) throw new Error(`Google list models ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { models?: Array<{ name: string; displayName?: string; description?: string; inputTokenLimit?: number; outputTokenLimit?: number; supportedGenerationMethods?: string[] }> };
    return (data.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m) => {
        const id = m.name.replace("models/", "");
        return {
          id,
          providerId: "google",
          displayName: m.displayName ?? id,
          description: m.description,
          category: "text" as const,
          inputModalities: ["text", "image"] as const,
          outputModalities: ["text"] as const,
          contextWindow: m.inputTokenLimit ?? null,
          maxOutputTokens: m.outputTokenLimit ?? null,
          supportsTools: true,
          supportsParallelTools: true,
          supportsVision: true,
          supportsReasoning: id.includes("thinking") || id.includes("2.5") || id.includes("3"),
          reasoning: id.includes("2.5") || id.includes("3") ? { type: "dynamic" as const, levels: ["low", "medium", "high"] } : null,
          pricing: null,
          releaseDate: null,
          raw: m,
        };
      });
  },

  async chat(apiKey: string, baseUrl: string, body: unknown, signal: AbortSignal): Promise<Response> {
    const b = body as Record<string, unknown>;
    const stream = b.stream === true;
    const model = (b.model as string) ?? "gemini-2.5-flash";
    const googleBody = translateOpenAIToGoogle(b, model);
    const path = stream ? `:streamGenerateContent?alt=sse` : `:generateContent`;
    const url = `${baseUrl.replace(/\/$/, "")}/v1beta/models/${encodeURIComponent(model)}${path}`;
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify(googleBody),
      signal,
    });
    if (!stream) {
      if (!upstream.ok) return upstream;
      const data = (await upstream.json()) as {
        candidates?: Array<{ content: { parts: Array<{ text?: string }> }; finishReason: string }>;
        usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number };
      };
      const text = data.candidates?.[0]?.content.parts.map((p) => p.text ?? "").join("") ?? "";
      const finish = mapGoogleFinish(data.candidates?.[0]?.finishReason ?? "STOP");
      const openAIResp = {
        id: `chatcmpl_${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: finish }],
        usage: data.usageMetadata
          ? {
              prompt_tokens: data.usageMetadata.promptTokenCount,
              completion_tokens: data.usageMetadata.candidatesTokenCount,
              total_tokens: data.usageMetadata.totalTokenCount,
            }
          : undefined,
      };
      return new Response(JSON.stringify(openAIResp), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (!upstream.ok || !upstream.body) return upstream;
    const translated = translateGoogleSSEToOpenAI(upstream.body, model);
    return new Response(translated, {
      status: 200,
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" },
    });
  },
};

function translateOpenAIToGoogle(body: Record<string, unknown>, _model: string): Record<string, unknown> {
  const messages = (body.messages as Array<{ role: string; content: unknown }>) ?? [];
  let systemInstruction: string | undefined;
  const contents: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    if (m.role === "system" && typeof m.content === "string") {
      systemInstruction = systemInstruction ? systemInstruction + "\n" + (m.content as string) : (m.content as string);
      continue;
    }
    const role = m.role === "assistant" ? "model" : "user";
    const content = m.content;
    const parts: unknown[] = [];
    if (typeof content === "string") parts.push({ text: content });
    else if (Array.isArray(content)) {
      for (const block of content as Array<{ type: string; text?: string; image_url?: { url: string } }>) {
        if (block.type === "text" && block.text) parts.push({ text: block.text });
        else if (block.type === "image_url" && block.image_url?.url) {
          const url = block.image_url.url;
          const match = url.match(/^data:(.+);base64,(.+)$/);
          if (match) parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
          else parts.push({ text: `[image: ${url}]` });
        }
      }
    }
    // tool_calls -> functionCall
    const toolCalls = (m as { tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }).tool_calls;
    if (toolCalls) {
      for (const tc of toolCalls) {
        let args: unknown = {};
        try { args = JSON.parse(tc.function.arguments); } catch { args = {}; }
        parts.push({ functionCall: { name: tc.function.name, args } });
      }
    }
    // tool result -> functionResponse
    if (m.role === "tool") {
      const tr = m as { tool_call_id?: string; content?: string };
      // Google expects functionResponse in user role, need name - we don't have it, use tool_call_id as name fallback
      parts.push({ functionResponse: { name: tr.tool_call_id ?? "tool", response: { result: tr.content ?? "" } } });
    }
    if (parts.length > 0) contents.push({ role, parts });
  }
  const tools = body.tools as Array<{ function: { name: string; description?: string; parameters?: unknown } }> | undefined;
  const functionDeclarations = tools?.map((t) => ({ name: t.function.name, description: t.function.description, parameters: t.function.parameters }));
  let toolChoiceMode: string | undefined;
  const tc = body.tool_choice;
  if (tc === "none") toolChoiceMode = "NONE";
  else if (tc === "required") toolChoiceMode = "ANY";
  else toolChoiceMode = "AUTO";

  const generationConfig: Record<string, unknown> = {};
  if (body.temperature !== undefined) generationConfig.temperature = body.temperature;
  if (body.top_p !== undefined) generationConfig.topP = body.top_p;
  if (body.max_tokens !== undefined) generationConfig.maxOutputTokens = body.max_tokens;
  else if (body.max_completion_tokens !== undefined) generationConfig.maxOutputTokens = body.max_completion_tokens;
  if (body.stop) generationConfig.stopSequences = Array.isArray(body.stop) ? body.stop : [body.stop];

  const out: Record<string, unknown> = { contents, generationConfig };
  if (systemInstruction) out.systemInstruction = { parts: [{ text: systemInstruction }] };
  if (functionDeclarations?.length) {
    out.tools = [{ functionDeclarations }];
    out.toolConfig = { functionCallingConfig: { mode: toolChoiceMode } };
  }
  return out;
}

function mapGoogleFinish(r: string): string {
  if (r === "STOP") return "stop";
  if (r === "MAX_TOKENS") return "length";
  if (r === "SAFETY" || r === "RECITATION") return "content_filter";
  return r.toLowerCase();
}

function translateGoogleSSEToOpenAI(body: ReadableStream<Uint8Array>, model: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";
  let sentRole = false;
  let id = `chatcmpl_${Date.now()}`;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const dataStr = line.slice(6).trim();
          if (!dataStr || dataStr === "[DONE]") continue;
          try {
            const data = JSON.parse(dataStr) as { candidates?: Array<{ content: { parts: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>; usageMetadata?: unknown };
            const candidate = data.candidates?.[0];
            if (!candidate) continue;
            const text = candidate.content.parts.filter((p) => !p.thought).map((p) => p.text ?? "").join("");
            const thinking = candidate.content.parts.filter((p) => p.thought).map((p) => p.text ?? "").join("");
            const content = text || thinking;
            if (content) {
              const chunk = {
                id,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [{ index: 0, delta: { ...(sentRole ? {} : { role: "assistant" }), content }, finish_reason: null }],
              };
              sentRole = true;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
            }
            if (candidate.finishReason) {
              const chunk = {
                id,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [{ index: 0, delta: {}, finish_reason: mapGoogleFinish(candidate.finishReason) }],
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
            }
          } catch {}
        }
      },
      flush(controller) {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      },
    }),
  );
}
