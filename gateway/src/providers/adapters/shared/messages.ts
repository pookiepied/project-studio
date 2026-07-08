/**
 * Converts AgentMessage[] (OpenAI wire format) to ModelMessage[] (AI SDK v6 format).
 */

import type { ModelMessage, TextPart, ImagePart, FilePart, ToolCallPart, ToolResultPart } from "ai";
import type { AgentMessage } from "../../types";

function tryParseJson(value: unknown): unknown {
  if (typeof value !== "string") return value ?? null;
  try { return JSON.parse(value); } catch { return value; }
}

export function toCoreMsgs(messages: AgentMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];
    const role = (msg.role as string) === "developer" ? "system" : msg.role;

    // ── system ─────────────────────────────────────────────────────────────
    if (role === "system") {
      out.push({ role: "system", content: typeof msg.content === "string" ? msg.content : "" });
      i++;
      continue;
    }

    // ── user ───────────────────────────────────────────────────────────────
    if (role === "user") {
      if (typeof msg.content === "string" || msg.content === null) {
        out.push({ role: "user", content: msg.content ?? "" });
      } else if (Array.isArray(msg.content)) {
        const parts: (TextPart | ImagePart | FilePart)[] = (msg.content as any[]).map(block => {
          if (block.type === "image_url") {
            const url: string = block.image_url?.url ?? "";
            return {
              type:  "image" as const,
              image: url.startsWith("data:") ? url : new URL(url),
            } satisfies ImagePart;
          }
          if (block.type === "file") {
            // PDF / binary attachments for Anthropic Documents and other providers.
            // `data` is raw base64 (not a data-URL); `mediaType` is IANA media type e.g. "application/pdf".
            return {
              type:      "file" as const,
              mediaType: block.mimeType ?? "application/octet-stream",
              data:      block.data as string,
              ...(block.filename ? { filename: block.filename } : {}),
            } satisfies FilePart;
          }
          if (block.type === "video_url") {
            // Video references for Gemini multimodal input.
            const url: string = block.video_url?.url ?? "";
            return {
              type:      "file" as const,
              mediaType: "video/mp4",
              data:      url.startsWith("data:") ? url : new URL(url),
            } satisfies FilePart;
          }
          return { type: "text" as const, text: block.text ?? "" } satisfies TextPart;
        });
        out.push({ role: "user", content: parts });
      }
      i++;
      continue;
    }

    // ── assistant ──────────────────────────────────────────────────────────
    if (role === "assistant") {
      if (msg.tool_calls?.length) {
        const parts: (TextPart | ToolCallPart)[] = [];
        if (typeof msg.content === "string" && msg.content) {
          parts.push({ type: "text", text: msg.content });
        }
        for (const tc of msg.tool_calls) {
          parts.push({
            type:       "tool-call",
            toolCallId: tc.id,
            toolName:   tc.function.name,
            // v6 uses `input`, not `args`
            input:      tryParseJson(tc.function.arguments) as Record<string, unknown>,
          } as ToolCallPart);
        }
        out.push({ role: "assistant", content: parts });
      } else {
        out.push({
          role:    "assistant",
          content: typeof msg.content === "string" ? msg.content : (msg.content ?? "") as any,
        });
      }
      i++;
      continue;
    }

    // ── tool results — group consecutive messages into one ─────────────────
    if (role === "tool") {
      const resultParts: ToolResultPart[] = [];
      while (i < messages.length && (messages[i].role as string) === "tool") {
        const m = messages[i];
        const raw = typeof m.content === "string"
          ? m.content
          : JSON.stringify(m.content ?? "");
        const parsed = tryParseJson(raw);
        // ToolResultOutput requires { type, value } — not a raw value
        const output = typeof parsed === "string"
          ? { type: "text"  as const, value: parsed }
          : { type: "json"  as const, value: parsed as import("ai").JSONValue };
        resultParts.push({
          type:       "tool-result",
          toolCallId: m.tool_call_id ?? "",
          toolName:   m.name ?? "",
          output,
        } satisfies ToolResultPart);
        i++;
      }
      out.push({ role: "tool", content: resultParts });
      continue;
    }

    i++;
  }

  return out;
}
