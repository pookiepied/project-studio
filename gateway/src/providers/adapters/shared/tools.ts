/**
 * Converts raw OpenAI tool definitions (unknown[]) to AI SDK v6 tool format.
 */

import { tool, jsonSchema } from "ai";
import type { Tool }        from "ai";
import type { ToolCall }    from "../../types";

interface RawTool {
  type: "function";
  function: {
    name:        string;
    description?: string;
    parameters?:  Record<string, unknown>;
  };
}

export function toAiSdkTools(rawTools: unknown[]): Record<string, Tool> {
  const result: Record<string, Tool> = {};

  for (const raw of rawTools as RawTool[]) {
    if (raw?.type !== "function" || !raw.function?.name) continue;

    const { name, description, parameters } = raw.function;

    result[name] = tool({
      description: description ?? "",
      // v6 uses `inputSchema`, not `parameters`
      inputSchema: jsonSchema(
        (parameters as any) ?? { type: "object", properties: {}, required: [] },
      ),
    });
  }

  return result;
}

/**
 * Convert an AI SDK v6 tool-call event to the internal ToolCall format.
 * v6 uses `input` (not `args`) for the tool call parameters.
 */
export function toToolCall(tc: {
  toolCallId: string;
  toolName:   string;
  input?:     unknown;
  args?:      unknown; // legacy fallback
}): ToolCall {
  const payload = tc.input ?? tc.args ?? {};
  return {
    id:   tc.toolCallId,
    type: "function",
    function: {
      name:      tc.toolName,
      arguments: typeof payload === "string" ? payload : JSON.stringify(payload),
    },
  };
}
