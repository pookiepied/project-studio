/**
 * mcpInvoker — centralized MCP tool invocation contract
 *
 * This is the single source of truth for how MCP tool calls are made from the
 * STUDIO frontend. Every code path that executes a local MCP tool (sendMessage,
 * regenerateResponse, continueResponse, and any future paths) must go through
 * the functions here — never call `invoke("mcp_call_tool", ...)` directly.
 *
 * Mirrors the reliability contract in studio-harness/src/tools/tool-contract.ts:
 *   1. Timeout ceiling — every call has a max wait before we give up
 *   2. Structured error feedback — failures return LLM-readable error objects
 *   3. No retry on timeout — only retry on connection-level errors
 */

import { invoke } from "@tauri-apps/api/core";
import { logger } from "../logging/logger";

// ---------------------------------------------------------------------------
// Contract constants
// ---------------------------------------------------------------------------

/**
 * Frontend timeout for a single MCP tool call attempt.
 *
 * This is the IPC backstop — the last resort if every layer below it fails
 * to terminate the call on time. The correct ordering of timeouts is:
 *
 *   per-tool ceiling (≤ 120 s)  →  Rust IPC ceiling (180 s)  →  this (300 s)
 *
 * Per-tool ceilings are set in studio-harness/src/tools/tool-contract.ts.
 * The longest ceiling is SHELL_COMMAND = 120 s. Those fire first.
 * If the Node.js process hangs without producing output, mcp.rs fires at 180 s.
 * Only if the Rust runtime also fails to surface that error does this fire.
 *
 * IMPORTANT: This must always be GREATER than the longest per-tool ceiling
 * (currently 120 s). A value shorter than the tool ceiling creates false
 * timeouts for legitimate long-running commands.
 */
export const MCP_INVOKE_TIMEOUT_MS = 300_000;

/**
 * Maximum characters of MCP tool output forwarded to the LLM.
 * Prevents context flooding on large outputs (e.g. grep across a huge codebase).
 */
export const MAX_MCP_OUTPUT_CHARS = 50_000;

// ---------------------------------------------------------------------------
// Core invocation — invokeMcpTool
// ---------------------------------------------------------------------------

/**
 * Call an MCP tool via Tauri with a per-call timeout.
 *
 * Retry policy:
 *   - Timeout errors: NO retry. A 300 s wait already indicates a genuinely hung tool.
 *     Retrying would mean another full wait before the user sees an error.
 *   - Connection errors ("server not running", "connection closed"): ONE retry
 *     after a 1 s pause. These are transient — the server may have just been
 *     restarting.
 *   - All other errors: NO retry. Tool-level errors (bad args, permission denied,
 *     etc.) will produce the same error on every attempt.
 *
 * Returns the raw Value from the server on success.
 * Throws an Error on failure — callers should catch and call formatMcpError().
 */
export async function invokeMcpTool(
  server: string,
  tool: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const CONNECTION_ERROR_PATTERNS = [
    "is not running",
    "closed connection",
    "connection closed",
    "ECONNRESET",
    "EPIPE",
  ];

  let lastError: Error = new Error("Unknown error");

  for (let attempt = 1; attempt <= 2; attempt++) {
    let timedOut = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      const result = await Promise.race<unknown>([
        invoke("mcp_call_tool", { server, tool, args }),
        new Promise<never>((_resolve, reject) => {
          timeoutId = setTimeout(() => {
            timedOut = true;
            reject(
              new Error(
                `Tool '${tool}' on server '${server}' timed out after ${
                  MCP_INVOKE_TIMEOUT_MS / 1000
                }s. ` +
                  `The server process may be overloaded or the tool is taking longer than expected. ` +
                  `Try calling it again. If it times out again, split the work into smaller steps.`
              )
            );
          }, MCP_INVOKE_TIMEOUT_MS);
        }),
      ]);
      clearTimeout(timeoutId);
      return result;
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      lastError = err instanceof Error ? err : new Error(String(err));

      // Never retry timeout errors — the tool is hung, not transiently unavailable.
      if (timedOut) {
        logger.warn("mcpInvoker", `Tool '${tool}' on '${server}' timed out (no retry)`, {
          attempt,
          timeout: MCP_INVOKE_TIMEOUT_MS,
        });
        break;
      }

      const isConnectionError = CONNECTION_ERROR_PATTERNS.some((p) =>
        lastError.message.toLowerCase().includes(p.toLowerCase())
      );

      // Only retry connection-level errors on the first attempt.
      if (attempt === 1 && isConnectionError) {
        logger.warn("mcpInvoker", `Connection error on attempt ${attempt}, retrying`, {
          server,
          tool,
          error: lastError.message,
        });
        await new Promise<void>((r) => setTimeout(r, 1_000));
        continue;
      }

      // All other errors: give up immediately.
      logger.warn("mcpInvoker", `Tool '${tool}' on '${server}' failed (no retry)`, {
        attempt,
        error: lastError.message,
      });
      break;
    }
  }

  throw lastError;
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

/**
 * Truncate oversized MCP tool output before forwarding to the LLM.
 * Returns the original value unchanged if it fits within the limit.
 */
export function truncateMcpOutput(result: unknown): unknown {
  const str = typeof result === "string" ? result : JSON.stringify(result);
  if (str.length <= MAX_MCP_OUTPUT_CHARS) return result;
  return (
    `${str.slice(0, MAX_MCP_OUTPUT_CHARS)}\n\n` +
    `[Output truncated — ${str.length.toLocaleString()} total chars, ` +
    `showing first ${MAX_MCP_OUTPUT_CHARS.toLocaleString()}. ` +
    `Use offset/limit parameters or redirect output to a file to get more.]`
  );
}

/**
 * Extract base64 image blobs from an MCP tool result content array.
 * Used for screenshot-producing tools (screenshot/vision tools).
 *
 * Returns data URLs (self-contained, always renderable, survive JSON
 * round-trips) plus any accompanying text.
 */
export function extractMcpImages(result: unknown): {
  dataUrls: string[];
  textOnly: string;
} {
  if (!result || typeof result !== "object") {
    return {
      dataUrls: [],
      textOnly: typeof result === "string" ? result : JSON.stringify(result),
    };
  }
  const r = result as Record<string, unknown>;
  if (!Array.isArray(r.content)) {
    return { dataUrls: [], textOnly: JSON.stringify(result) };
  }
  const dataUrls: string[] = [];
  const texts: string[] = [];
  for (const item of r.content as any[]) {
    if (item?.type === "image" && item.data) {
      const mime = (item.mimeType as string) ?? "image/png";
      dataUrls.push(`data:${mime};base64,${item.data}`);
    } else if (item?.type === "text" && item.text) {
      texts.push(item.text as string);
    }
  }
  return { dataUrls, textOnly: texts.join("\n") };
}

// ---------------------------------------------------------------------------
// Error formatting
// ---------------------------------------------------------------------------

/**
 * Build a structured, LLM-readable error object from a caught MCP invocation
 * error. The LLM sees this as the tool result when a call fails after all
 * retry attempts are exhausted.
 *
 * The `hint` field tells the LLM exactly what to do next.
 */
export function formatMcpError(
  server: string,
  tool: string,
  err: unknown
): Record<string, unknown> {
  const message = err instanceof Error ? err.message : String(err);
  const isTimeout = message.includes("timed out");
  const isNotRunning = message.includes("is not running");
  const isClosed = message.includes("closed connection");

  let hint: string;
  if (isTimeout) {
    hint =
      "The tool timed out. Try calling it again. " +
      "If it times out again, break the work into smaller steps or increase the `timeout` parameter if the tool supports it.";
  } else if (isNotRunning || isClosed) {
    hint =
      "The MCP server is not running or crashed. " +
      "Report this to the user — they need to restart the server from Settings.";
  } else {
    hint =
      "The tool failed after all retry attempts. " +
      "You can try calling it again with corrected arguments, or use a different approach.";
  }

  return {
    status: "error",
    server,
    tool,
    error: message,
    hint,
  };
}
