/**
 * Adapter SSE translators — Anthropic and Google SSE → OpenAI SSE.
 * Extracted from 2 adapter translators (anthropic-messages:187, google:177).
 * Stable IDs via crypto.randomUUID() per request.
 */

function mapAnthropicStop(s: string): string {
  if (s === "end_turn") return "stop";
  if (s === "max_tokens") return "length";
  if (s === "tool_use") return "tool_calls";
  return s;
}

function mapGoogleFinish(r: string): string {
  if (r === "STOP") return "stop";
  if (r === "MAX_TOKENS") return "length";
  if (r === "SAFETY" || r === "RECITATION") return "content_filter";
  return r.toLowerCase();
}

export function translateAnthropicSSEToOpenAI(body: ReadableStream<Uint8Array>, model: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";
  let id = `chatcmpl_${crypto.randomUUID()}`;
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
              const finish = mapAnthropicStop(data.delta.stop_reason);
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

export function translateGoogleSSEToOpenAI(body: ReadableStream<Uint8Array>, model: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";
  let sentRole = false;
  const id = `chatcmpl_${crypto.randomUUID()}`;
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
          } catch {
            // ignore
          }
        }
      },
      flush(controller) {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      },
    }),
  );
}
