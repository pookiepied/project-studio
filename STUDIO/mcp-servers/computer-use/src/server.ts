/**
 * MCP server factory for the Computer Use package.
 *
 * This package's registry contains ONLY its own tools, so the server serves
 * every entry in TOOL_DEFINITIONS and dispatches every call via dispatch().
 * The module owns its runtime boundary (centralized error handling +
 * namespaced logging) while using this package's tool implementations.
 *
 * Logging is written to stderr only — MCP speaks JSON-RPC over stdout, so
 * never log to stdout or the protocol breaks.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { TOOL_DEFINITIONS, dispatch } from "./registry.js";
import { formatCaughtError, type ToolErrorResult } from "./tools/tool-contract.js";

// ---------------------------------------------------------------------------
// Logger contract
// ---------------------------------------------------------------------------

export interface McpLogger {
  debug(msg: string, ctx?: unknown): void;
  info(msg: string, ctx?: unknown): void;
  warn(msg: string, ctx?: unknown): void;
  error(msg: string, ctx?: unknown): void;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Structured message → single stderr line. */
function logLine(level: string, tag: string, msg: string, ctx?: unknown): string {
  const tail = ctx !== undefined ? ` ${safeJson(ctx)}` : "";
  return `[${level}][${tag}] ${msg}${tail}\n`;
}

/** Minimal default logger — writes to stderr with a generic tag. */
const defaultLogger: McpLogger = {
  debug: (m, c) => process.stderr.write(logLine("debug", "computer-use", m, c)),
  info:  (m, c) => process.stderr.write(logLine("info",  "computer-use", m, c)),
  warn:  (m, c) => process.stderr.write(logLine("warn",  "computer-use", m, c)),
  error: (m, c) => process.stderr.write(logLine("error", "computer-use", m, c)),
};

/** Build a namespaced logger for an MCP module. */
export function createNamespacedLogger(tag: string): McpLogger {
  return {
    debug: (m, c) => process.stderr.write(logLine("debug", tag, m, c)),
    info:  (m, c) => process.stderr.write(logLine("info",  tag, m, c)),
    warn:  (m, c) => process.stderr.write(logLine("warn",  tag, m, c)),
    error: (m, c) => process.stderr.write(logLine("error", tag, m, c)),
  };
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface CreateMcpServerOptions {
  /** Namespaced logger. Defaults to a generic stderr writer. */
  logger?: McpLogger;
  /** Wrap a raw tool failure into a clean { error } shape. Defaults to formatCaughtError. */
  formatError?: (toolName: string, err: unknown) => ToolErrorResult;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export async function createMcpServer(
  serverName: string,
  options: CreateMcpServerOptions = {}
): Promise<void> {
  const logger = options.logger ?? defaultLogger;
  const formatError = options.formatError ?? ((n, e) => formatCaughtError(n, e));

  const toolDefs = TOOL_DEFINITIONS;
  const toolNames = new Set<string>(toolDefs.map((d) => d.name));

  logger.info("MCP server starting", { server: serverName, tools: toolDefs.length });

  const server = new Server(
    { name: serverName, version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefs,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (!toolNames.has(name)) {
      logger.warn("Unknown tool requested", { server: serverName, tool: name });
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    const a = (args ?? {}) as Record<string, unknown>;
    logger.debug("Tool call", { server: serverName, tool: name });

    try {
      const result = await dispatch(name, a);

      // Tools may return a ready-made MCP content array (e.g. image content).
      if (isMcpContentArray(result)) {
        return { content: result as any[] };
      }

      // Any other value is serialized as text for the LLM.
      return {
        content: [
          {
            type: "text",
            text:
              typeof result === "string"
                ? result
                : JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err: unknown) {
      // Centralized error boundary: never let a raw stack trace reach the LLM.
      const wrapped = formatError(name, err);
      logger.error("Tool execution failed", {
        server: serverName,
        tool: name,
        error: wrapped.error,
      });
      return {
        content: [{ type: "text", text: `Error: ${wrapped.error}` }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("MCP server connected on stdio", { server: serverName });
}

function isMcpContentArray(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  const first = value[0];
  if (typeof first !== "object" || first === null) return false;
  const t = (first as Record<string, unknown>).type;
  return t === "text" || t === "image" || t === "resource";
}
