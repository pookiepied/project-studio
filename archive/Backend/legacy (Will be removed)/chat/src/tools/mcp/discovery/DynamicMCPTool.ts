import { BaseTool } from "../../base/BaseTool";
import { ToolResult } from "../../base/types";

/**
 * Represents a single tool exposed by an installed MCP server.
 *
 * Instances are created at request time by mcpLoader, which reads the user's
 * enabled servers from D1 and their tool manifests from KV. They are never
 * registered in the global singleton — only in the per-request registry
 * (see registryContext.ts).
 *
 * Tool name convention: mcp_{serverName}__{toolName}
 * e.g. "mcp_github__search_repos"
 *
 * execute() is a stub — the tools node detects executionTarget === "mcp"
 * and defers execution to the Tauri client, which routes it to the
 * appropriate MCP server subprocess via stdio.
 */
export class DynamicMCPTool extends BaseTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: any;
  readonly executionTarget = "mcp" as const;
  readonly group = "mcp" as const;
  readonly allowInSubAgent = false; // local MCP requires Tauri subprocess

  constructor(serverName: string, toolName: string, description: string, parameters: any) {
    super();
    // Sanitize: replace hyphens with underscores so the name is a valid function identifier
    const safeServer = serverName.replace(/-/g, "_");
    this.name = `mcp_${safeServer}__${toolName}`;
    this.description = description;
    this.parameters = parameters;
  }

  async execute(_args: any, _context?: unknown): Promise<ToolResult> {
    return this.errorResult(
      `MCP tool '${this.name}' requires the local engine. This stub should not be called directly.`
    );
  }
}
