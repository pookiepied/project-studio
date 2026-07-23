import type { CapturedUsage, ToolCall } from "./generation";

export type StreamEvent =
  | { type: "stream.started"; provider: string; model: string }
  | { type: "content"; chunk: string }
  | { type: "model.message.delta"; chunk: string }
  | { type: "reasoning"; chunk: string }
  | { type: "model.reasoning.delta"; chunk: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "model.tool_call.completed"; call: ToolCall }
  | { type: "tool_calls"; calls: ToolCall[] }
  | { type: "usage"; data: CapturedUsage }
  | { type: "model.usage"; data: CapturedUsage }
  | { type: "model.completed" }
  | { type: "stream.error"; error: { code: string; message: string } }
  | { type: "stream.completed" };
