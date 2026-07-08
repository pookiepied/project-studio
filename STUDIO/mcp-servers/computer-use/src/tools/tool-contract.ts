/**
 * Tool Contract
 * =============
 * Computer Use source of truth for tool timeout and error standards.
 *
 * Every Computer Use tool must follow three rules:
 *
 *   1. TIMEOUT        Every tool has a time ceiling. No tool hangs the session forever.
 *                     Use TOOL_TIMEOUTS below — never hardcode timeout numbers in tool files.
 *
 *   2. FEEDBACK       On failure, every tool returns { error: "what + why + what to do next" }.
 *                     The LLM reads this to understand what happened and decide how to retry.
 *                     Never let raw Node.js errors (ENOENT, EACCES, etc.) reach the LLM unformatted.
 *
 *   3. RETRY GUIDANCE Error messages must include enough context for the LLM to retry correctly
 *                     on the next attempt — not after three failed guesses.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW TO ADD A NEW TOOL
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Process tool (spawns PowerShell or another local process):
 *   → Import TOOL_TIMEOUTS and pass the right category to the runner function.
 *   - The runner handles the kill-on-timeout internally.
 *   → Tool file: import TOOL_TIMEOUTS, use the right category, done.
 *
 * Pure-JS tool (data processing, image loading, or validation with no subprocess):
 *   → Implement the tool normally with specific inner try/catch for known error cases.
 *   → Export it through the category index.ts using wrapTool() at the export boundary.
 *   → wrapTool() catches anything the inner code misses and formats it as { error }.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TIMEOUT REFERENCE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   FAST_QUERY     20 s   Quick system/desktop queries
 *   LOCAL_PROCESS  30 s   Local process execution, no network
 *   SHELL_COMMAND  120 s  PowerShell default                     (installers, diagnostics)
 *   NETWORK        60 s   Network diagnostics and adapter operations
 *   LONG_BUILD     300 s  Reference value for unusually long local operations
 *                         Not a default — pass explicitly when the task genuinely needs it.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. Timeout categories
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Standard timeout values in milliseconds.
 * Import and use these — never hardcode timeout numbers in individual tool files.
 */
export const TOOL_TIMEOUTS = {
  /** Quick system or desktop queries. Expected: < 1 s. Ceiling: 20 s. */
  FAST_QUERY:    20_000,
  /** Local process execution. No network. Ceiling: 30 s. */
  LOCAL_PROCESS: 30_000,
  /** PowerShell default. Covers installers, diagnostics, and local commands. Ceiling: 120 s. */
  SHELL_COMMAND: 120_000,
  /** Network diagnostics and adapter operations. Ceiling: 60 s. */
  NETWORK:       60_000,
  /** Reference value for unusually long local operations. Not a default. Ceiling: 300 s. */
  LONG_BUILD:    300_000,
} as const;

export type ToolTimeoutCategory = keyof typeof TOOL_TIMEOUTS;

// ─────────────────────────────────────────────────────────────────────────────
// 2. Standard error shape
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every tool returns a plain Record<string, unknown>.
 * On failure it always includes an `error` string.
 * The LLM reads `error` to understand what happened and decide how to proceed.
 */
export interface ToolErrorResult {
  error: string;
  [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Error formatter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts a raw caught exception into a clean { error } result.
 *
 * Handles the most common Node.js error codes with actionable messages so the
 * LLM understands what happened and what to do next.
 *
 * Use this in catch blocks instead of returning raw error objects.
 */
export function formatCaughtError(
  toolName: string,
  e: unknown
): ToolErrorResult {
  const err = e as any;
  const raw: string = err?.message ?? String(e);
  const atPath: string = err?.path ? ` — ${err.path}` : "";

  switch (err?.code) {
    case "ENOENT":
      return { error: `${toolName}: file or directory not found${atPath}. Verify the path exists first.` };
    case "EACCES":
    case "EPERM":
      return { error: `${toolName}: permission denied${atPath}. Check file or directory permissions.` };
    case "ENOTDIR":
      return { error: `${toolName}: expected a directory but found a file${atPath}. Choose a file path when file content is required.` };
    case "EISDIR":
      return { error: `${toolName}: expected a file but found a directory${atPath}. Choose a file path, not a directory.` };
    case "ENOSPC":
      return { error: `${toolName}: disk full — no space left on device.` };
    case "EEXIST":
      return { error: `${toolName}: already exists${atPath}.` };
    default:
      return { error: `${toolName}: ${raw}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. wrapTool — contract enforcement for pure-JS tools
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wraps a pure-JS tool at the export boundary to enforce the contract safety net.
 *
 * What it does:
 *   - Catches any unhandled exception that slipped past inner try/catch blocks
 *   - Returns it as { error } instead of letting it throw (which would crash the MCP server)
 *   - Keeps the function signature identical — callers see no difference
 *
 * What it does NOT do:
 *   - Add a timeout — local OS operations fail fast via OS errors; process tools manage their own
 *   - Replace inner try/catch — keep those for specific, well-worded error messages
 *
 * Applied in category index.ts files, not in the tool files
 * themselves. This keeps implementation files clean and makes the contract enforcement
 * visible in one place per category.
 *
 * Example (in a category index.ts):
 *   import { wrapTool } from "../tool-contract.js";
 *   import { loadImage as _loadImage } from "./imageLoader.js";
 *   export const loadImage = wrapTool("load_image", _loadImage);
 */
export function wrapTool(
  toolName: string,
  fn: (args: Record<string, unknown>) => Promise<Record<string, unknown>>
): (args: Record<string, unknown>) => Promise<Record<string, unknown>> {
  return async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
    try {
      return await fn(args);
    } catch (e) {
      return formatCaughtError(toolName, e);
    }
  };
}
