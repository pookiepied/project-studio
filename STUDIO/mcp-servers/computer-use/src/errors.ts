/**
 * Computer Use centralized error boundary.
 *
 * Tool failures from the local tool contract already return a clean
 * { error } shape. This wrapper adds the module tag as diagnostic metadata so
 * logs and downstream consumers can attribute the failure to the Computer Use
 * MCP, without leaking raw stack traces to the LLM.
 */
import {
  formatCaughtError,
  type ToolErrorResult,
} from "./tools/tool-contract.js";

export function formatComputerUseError(
  toolName: string,
  err: unknown
): ToolErrorResult {
  const base = formatCaughtError(toolName, err);
  return { ...base, mcp: "computer-use" };
}
