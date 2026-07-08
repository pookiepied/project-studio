import { BaseTool } from "../../base/BaseTool";
import { ToolResult } from "../../base/types";
import { getRequestEnv } from "../../../context";
import { logger } from "../../../logger";

/**
 * Represents a single tool exposed by a native system MCP service
 * (e.g. STUDIO Memory, YouTube Transcript).
 *
 * Execution is proxied through the MCP hub (env.MCP binding) which holds
 * the service binding to the actual worker and manages the MCP session.
 *
 * Tool names match the native service's own tool names exactly (no prefix),
 * since they are system-owned and have no naming collision risk.
 */
export class NativeMCPTool extends BaseTool {
  readonly name:            string;
  readonly description:     string;
  readonly parameters:      unknown;
  readonly executionTarget = "cloud" as const;
  readonly group           = "mcp"   as const;
  readonly allowInSubAgent = true;

  private readonly serviceId: string;
  private readonly toolName:  string;

  constructor(
    serviceId:   string,
    toolName:    string,
    description: string,
    parameters?: unknown,
  ) {
    super();
    this.serviceId   = serviceId;
    this.toolName    = toolName;
    this.name        = toolName; // keep the native name (e.g. "memory_recall")
    this.description = description;
    this.parameters  = parameters ?? { type: "object", properties: {} };
  }

  async execute(args: unknown, _context?: unknown): Promise<ToolResult> {
    const env = getRequestEnv();
    if (!env?.MCP) {
      logger.error("NativeMCPTool: MCP binding unavailable", { service: this.serviceId, tool: this.toolName });
      return this.errorResult(`Native tool '${this.name}' requires MCP service binding.`);
    }

    try {
      const res = await env.MCP.fetch(
        new Request("https://studio-mcp/internal/native/execute", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({
            serviceId: this.serviceId,
            toolName:  this.toolName,
            toolArgs:  args ?? {},
          }),
        })
      );

      const data = await res.json<{ success: boolean; data?: unknown; error?: string }>();
      if (data.success) return this.successResult(data.data);
      logger.warn("NativeMCPTool: tool returned failure", { service: this.serviceId, tool: this.toolName, error: data.error });
      return this.errorResult(data.error ?? "Native tool execution failed");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("NativeMCPTool: request failed", { service: this.serviceId, tool: this.toolName, error: message });
      return this.errorResult(message);
    }
  }
}
