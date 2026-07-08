import { BaseTool } from "../../base/BaseTool";
import { ToolResult } from "../../base/types";
import { logger } from "../../../logger";
import { emit } from "../../../tracking";
import { getRequestEnv } from "../../../context";

/**
 * A single tool exposed by a Cloudflare service-binding-backed MCP server.
 *
 * Unlike RemoteMCPTool (which calls a public HTTP URL), ServiceBindingMCPTool
 * routes MCP JSON-RPC calls through a Cloudflare service binding — zero egress,
 * no public URL needed, same Worker network.
 *
 * Used exclusively for STUDIO built-in servers (e.g. studio-memory) that are
 * always available system-wide, regardless of what the user has installed.
 *
 * Tool name convention: mcp_{serverName}__{toolName}
 * e.g. "mcp_studio_memory__memory_recall"
 *
 * Execution happens in the Worker (allowInSubAgent = true).
 */
export class ServiceBindingMCPTool extends BaseTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: any;
  readonly executionTarget = "remote_mcp" as const;
  readonly group = "mcp" as const;
  readonly allowInSubAgent = true;

  /**
   * Marks this as a STUDIO built-in tool.
   * Used by ToolRegistry.getContextualDefinitions() to apply tier filtering
   * to built-in tools independently of user-installed remote MCP servers.
   */
  readonly builtin = true;

  private readonly serverName: string;
  private readonly toolName: string;
  private readonly bindingKey: string;

  /**
   * @param serverName   Hyphenated server name (e.g. "studio-memory")
   * @param toolName     Exact tool name as registered on the MCP server
   * @param description  Tool description shown to the LLM
   * @param parameters   JSON Schema for tool arguments
   * @param bindingKey   Key on Env that holds the Fetcher binding (default: "MEMORY")
   * @param tier         1 = always visible, 2 = behind expand_tools (default: 2)
   */
  constructor(
    serverName: string,
    toolName: string,
    description: string,
    parameters: any,
    bindingKey = "MEMORY",
    tier: 1 | 2 = 2,
  ) {
    super();
    const safeServer = serverName.replace(/-/g, "_");
    this.name        = `mcp_${safeServer}__${toolName}`;
    this.serverName  = serverName;
    this.toolName    = toolName;
    this.description = description;
    this.parameters  = parameters;
    this.bindingKey  = bindingKey;
    (this as any).tier = tier;
  }

  async execute(args: any, _context?: unknown): Promise<ToolResult> {
    const env = getRequestEnv();
    const binding = env?.[this.bindingKey as keyof typeof env] as Fetcher | undefined;

    if (!binding) {
      return this.errorResult(
        `Service binding '${this.bindingKey}' not available — ${this.serverName} is not wired.`
      );
    }

    try {
      const result = await this.callViaBinding(
        binding,
        (env as any).MEMORY_AUTH_SECRET as string | undefined,
        args,
      );
      return { success: true, result };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`ServiceBindingMCPTool: ${this.name} failed`, { error: message });
      if (env) {
        emit(env, undefined, {
          event:    "provider.error",
          severity: "error",
          data:     { provider: "mcp", server: this.serverName, tool: this.toolName, error: message },
        });
      }
      return this.errorResult(message);
    }
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private async callViaBinding(
    binding: Fetcher,
    authSecret: string | undefined,
    args: any,
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      "Content-Type":                  "application/json",
      "Accept":                        "application/json, text/event-stream",
    };
    if (authSecret) headers["Authorization"] = `Bearer ${authSecret}`;

    const body = JSON.stringify({
      jsonrpc: "2.0",
      id:      1,
      method:  "tools/call",
      params:  { name: this.toolName, arguments: args ?? {} },
    });

    const response = await binding.fetch(
      new Request(`http://${this.serverName}/mcp`, { method: "POST", headers, body })
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `${this.serverName} returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`
      );
    }

    const ct = response.headers.get("content-type") ?? "";

    if (ct.includes("application/json")) {
      const json: any = await response.json();
      if (json.error) {
        throw new Error(`${this.serverName} error: ${json.error.message ?? JSON.stringify(json.error)}`);
      }
      return this.extractContent(json.result);
    }

    if (ct.includes("text/event-stream")) {
      return this.parseSSEResult(response);
    }

    return response.text();
  }

  private extractContent(result: any): unknown {
    if (!result) return null;
    if (Array.isArray(result.content)) {
      return result.content
        .map((c: any) => (c.type === "text" ? c.text : JSON.stringify(c)))
        .filter(Boolean)
        .join("\n");
    }
    return result;
  }

  private async parseSSEResult(response: Response): Promise<unknown> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error(`No response body from ${this.serverName}`);

    const dec = new TextDecoder();
    let buf   = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += typeof value === "string" ? value : dec.decode(value, { stream: true });

        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const msg: any = JSON.parse(data);
            if (msg.result !== undefined) return this.extractContent(msg.result);
            if (msg.error) {
              throw new Error(
                `${this.serverName} error: ${msg.error.message ?? JSON.stringify(msg.error)}`
              );
            }
          } catch (parseErr: any) {
            if (parseErr.message?.includes("error:")) throw parseErr;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    throw new Error(`${this.serverName} did not return a result`);
  }
}
