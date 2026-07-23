import { createSseResponse, encodeSse } from "@/platform/http/sse";
import type { ToolCall } from "@/domain/contracts";
import { toGatewayToolCall, usageFromAiSdk } from "./chatResponse";

export interface GatewayStreamOptions {
  provider: string;
  model: string;
}

export function createAiSdkGatewayStreamResponse(result: { fullStream: AsyncIterable<unknown> }, options: GatewayStreamOptions): Response {
  return createSseResponse(async (writer) => {
    const toolCalls: ToolCall[] = [];

    await writer.write(
      encodeSse(
        {
          type: "stream.started",
          provider: options.provider,
          model: options.model
        },
        "stream.started"
      )
    );

    for await (const part of result.fullStream) {
      const typedPart = part as { type?: string; totalUsage?: unknown };

      if (typedPart.type === "text-delta") {
        const chunk = textFromPart(part);
        if (chunk) {
          await writer.write(encodeSse({ type: "content", chunk }, "content"));
          await writer.write(encodeSse({ type: "model.message.delta", chunk }, "model.message.delta"));
        }
      } else if (typedPart.type === "reasoning-delta") {
        const chunk = textFromPart(part);
        if (chunk) {
          await writer.write(encodeSse({ type: "reasoning", chunk }, "reasoning"));
          await writer.write(encodeSse({ type: "model.reasoning.delta", chunk }, "model.reasoning.delta"));
        }
      } else if (typedPart.type === "tool-call") {
        const call = toGatewayToolCall(part);
        toolCalls.push(call);
        await writer.write(encodeSse({ type: "tool_call", call }, "tool_call"));
        await writer.write(encodeSse({ type: "model.tool_call.completed", call }, "model.tool_call.completed"));
      } else if (typedPart.type === "finish") {
        const usage = usageFromAiSdk(typedPart.totalUsage);
        if (usage) {
          await writer.write(encodeSse({ type: "usage", data: usage }, "usage"));
          await writer.write(encodeSse({ type: "model.usage", data: usage }, "model.usage"));
        }
        await writer.write(encodeSse({ type: "model.completed" }, "model.completed"));
      }
    }

    if (toolCalls.length) {
      await writer.write(encodeSse({ type: "tool_calls", calls: toolCalls }, "tool_calls"));
    }

    await writer.write(encodeSse({ type: "stream.completed" }, "stream.completed"));
    await writer.write(encodeSse("[DONE]"));
  });
}

export function textFromPart(part: unknown): string {
  const candidate = part as { text?: string; textDelta?: string; delta?: string };
  return candidate.text ?? candidate.textDelta ?? candidate.delta ?? "";
}
