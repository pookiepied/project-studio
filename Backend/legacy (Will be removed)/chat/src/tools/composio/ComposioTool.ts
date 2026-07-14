import { BaseTool } from "../base/BaseTool";
import { ToolResult } from "../base/types";
import { logger } from "../../logger";
import { getRequestEnv } from '../../context';

/**
 * Represents a single Composio tool exposed to the LLM.
 *
 * Execution is proxied through mcp/hub (env.MCP binding) which holds
 * COMPOSIO_API_KEY and runs the actual v3 REST call. Tool schemas are
 * discovered via hub's /internal/tools/composio endpoint during preload.
 *
 * Tool name convention: composio_{appName}__{slug_lowercase}
 */
export class ComposioTool extends BaseTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: any;
  readonly executionTarget = "cloud" as const;
  readonly group = "mcp" as const;
  readonly tier = 2 as const;
  readonly allowInSubAgent = true;

  private readonly slug: string;
  private readonly connectionId: string;
  private readonly entityId: string;

  constructor(
    slug:         string,
    toolName:     string,
    description:  string,
    parameters:   any,
    connectionId: string,
    entityId:     string,
  ) {
    super();
    this.slug         = slug;
    this.name         = toolName;
    this.description  = description;
    this.parameters   = parameters ?? { type: "object", properties: {} };
    this.connectionId = connectionId;
    this.entityId     = entityId;
  }

  async execute(args: any, _context?: unknown): Promise<ToolResult> {
    const env = getRequestEnv();
    if (!env?.MCP) {
      logger.error("ComposioTool: MCP binding unavailable", { slug: this.slug });
      return this.errorResult(JSON.stringify({
        status: "error", provider: "composio", slug: this.slug,
        error: "MCP service binding not configured",
        hint: "This is a configuration issue — report it to the administrator.",
      }));
    }

    try {
      const res = await env.MCP.fetch(new Request("http://studio-mcp/internal/composio/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug:         this.slug,
          connectionId: this.connectionId,
          entityId:     this.entityId,
          args:         args ?? {},
        }),
      }));

      const data = await res.json<{ success: boolean; data?: unknown; error?: Record<string, unknown> }>();
      if (data.success) return this.successResult(data.data);
      return this.errorResult(JSON.stringify(data.error ?? { error: "Composio execution failed" }));

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("ComposioTool: hub proxy failed", { slug: this.slug, error: message });
      return this.errorResult(JSON.stringify({
        status: "error", provider: "composio", slug: this.slug, error: message,
        hint: "The Composio execution service could not be reached. Try again.",
      }));
    }
  }
}
