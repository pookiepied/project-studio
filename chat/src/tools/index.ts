import { BaseTool } from "./base/BaseTool";
import { LLMToolDefinition, ToolContext, ToolResult } from "./base/types";
import { userLocationTool } from "./network";
import { taskWriteTool } from "./client";
import { studioAgentsTools } from "./agentic";
import { skillReadTool } from "./retrieval/skillRead";

export class ToolRegistry {
  private readonly tools: Map<string, BaseTool> = new Map();

  constructor() {
    this.registerDefaults();
  }

  // ------------------------------------------------------------------
  // Registration
  // ------------------------------------------------------------------

  register(tool: BaseTool): void {
    this.tools.set(tool.name, tool);
  }

  private registerDefaults(): void {
    // Agentic tools — native execution in chat worker
    this.register(skillReadTool);
    // Client-native tools — stay in chat Worker (no hub)
    this.register(taskWriteTool);

    // studio-agents — agent coordination primitives (spawn / await / cancel / blackboard)
    for (const tool of studioAgentsTools) {
      this.register(tool);
    }

    // MIGRATED to studio-mcp-tools (reach main agent + sub-agents via the
    // studio-mcp hub's native-service catalog — see STUDIO_AGENT_TOOL_PLAN.md):
    //   retrieval: web_search, web_fetch, rag
    //   network:   http_request
    //   generation: image_generate, video_generate, video_status

    // Environment — location (tier 2)
    this.register(userLocationTool);
  }

  // ------------------------------------------------------------------
  // Lookup
  // ------------------------------------------------------------------

  get(name: string): BaseTool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  // ------------------------------------------------------------------
  // Definition lists (for LLM)
  // ------------------------------------------------------------------

  getLLMDefinitions(): LLMToolDefinition[] {
    return Array.from(this.tools.values())
      .filter((t) => !t.contextInjected)
      .map((t) => t.toLLMDefinition());
  }

  getCloudLLMDefinitions(): LLMToolDefinition[] {
    return Array.from(this.tools.values())
      .filter((t) => !t.contextInjected && (t.executionTarget === "cloud" || t.executionTarget === "client"))
      .map((t) => t.toLLMDefinition());
  }

  /**
   * Returns tool definitions filtered by context relevance.
   *
   * Uses declarative tool metadata (tier, contextInjected, group) instead of
   * hardcoded name lists so re-tiering a tool is a one-line change at the
   * tool definition, not a surgery on this method.
   *
   * Tier rules:
   *   contextInjected=true  → always excluded (already in system prompt)
   *   tier=1                → always included in baseline mode
   *   tier=2                → included only when coreMode="all" or name matches message tokens
   *
   * MCP tool filtering (when filter is provided):
   *   - MCP tools whose server name matches keywords in filter.message are included.
   *   - MCP tools whose server appears in filter.activeServers are always included.
   *   - When neither is provided, all MCP tools are included (safe default).
   *
   * @param includeLocal    Pass true to include the local (claude_code) tool.
   * @param filter.message  Recent conversation text for keyword-based MCP filtering.
   * @param filter.activeServers  MCP server names already used this conversation.
   * @param filter.scope    "core" = built-ins only, "mcp" = MCP tools only, "all" = everything.
   * @param filter.coreMode "baseline" = tier-1 tools only, "all" = all tiers.
   */
  getContextualDefinitions(
    includeLocal: boolean = false,
    filter?: {
      message?: string;
      activeServers?: Set<string>;
      scope?: "core" | "mcp" | "all";
      coreMode?: "baseline" | "all";
    },
  ): LLMToolDefinition[] {
    const scope = filter?.scope ?? "all";
    const coreMode = filter?.coreMode ?? "all";

    const messageTokens: Set<string> = filter?.message
      ? new Set(filter.message.toLowerCase().match(/\b\w{2,}\b/g) ?? [])
      : new Set();
    const hasFilter = messageTokens.size > 0 || (filter?.activeServers?.size ?? 0) > 0;

    return Array.from(this.tools.values())
      .filter((t) => {
        // Context-injected tools (e.g. current_time) are never sent to the LLM
        if (t.contextInjected) return false;

        // Cloud tools that require the local engine (e.g. Cloud Coding Agents that
        // relay file/shell calls via Harness) — hidden when Harness is offline.
        if (t.requiresLocalEngine && !includeLocal) return false;

        // Local engine tools
        if (t.executionTarget === "local") return includeLocal;

        // MCP tools — dynamic, loaded per-request
        if (t.executionTarget === "mcp" || t.executionTarget === "remote_mcp") {
          if (scope === "core") return false;

          // Built-in service-binding tools (e.g. studio-memory) respect the tier system.
          // Tier 2 built-ins are hidden in baseline mode — only surfaced via expand_tools.
          // User-installed remote MCP servers always show all their tools (no tier gate).
          if (coreMode === "baseline" && (t as any).builtin === true && t.tier === 2) return false;

          if (!hasFilter) return true;

          const withoutPrefix = t.name.startsWith("mcp_") ? t.name.slice(4) : t.name;
          const serverPart = (withoutPrefix.split("__")[0] ?? "").toLowerCase();
          const serverTokens = serverPart.split("_").filter((s) => s.length >= 2);

          if (filter?.activeServers?.has(serverPart)) return true;

          return (
            serverTokens.some((tok) => messageTokens.has(tok)) ||
            messageTokens.has(serverPart) ||
            messageTokens.has(t.name.toLowerCase())
          );
        }

        // MCP-scope-only pass: skip all non-MCP tools
        if (scope === "mcp") return false;

        if (coreMode === "baseline") {
          // tier-1 tools are always in baseline
          if (t.tier === 1) return true;

          // tier-2 tools: include if the tool name loosely matches recent message text
          if (messageTokens.size > 0) {
            const nameTokens = t.name.toLowerCase().split("_").filter((s) => s.length >= 2);
            return (
              messageTokens.has(t.name.toLowerCase()) ||
              nameTokens.some((tok) => messageTokens.has(tok))
            );
          }

          return false;
        }

        // coreMode="all": include everything (used after expand_tools is called)
        return true;
      })
      .map((t) => t.toLLMDefinition());
  }

  /**
   * Returns the tool definitions available inside sub-agents.
   *
   * Reads allowInSubAgent from each tool's metadata — no hardcoded name lists.
   * Cloud and remote_mcp tools with allowInSubAgent=true are included.
   * Local, mcp (Tauri subprocess), client-native, and context-injected tools are excluded.
   *
   * @param includeLocal  Always false for sub-agents; parameter preserved for API symmetry.
   */
  getSubAgentDefinitions(includeLocal: boolean = false): LLMToolDefinition[] {
    return Array.from(this.tools.values())
      .filter((t) => {
        if (t.contextInjected) return false;
        if (!t.allowInSubAgent) return false;
        if (t.executionTarget === "local") return includeLocal;
        if (t.executionTarget === "mcp" || t.executionTarget === "client") return false;
        return true;
      })
      .map((t) => t.toLLMDefinition());
  }

  // ------------------------------------------------------------------
  // Execution (cloud + remote_mcp tools — local/mcp/client dispatched externally)
  // ------------------------------------------------------------------

  async execute(name: string, args: any, context?: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name);

    if (!tool) {
      return { success: false, error: `Tool '${name}' not found in registry` };
    }

    if (tool.executionTarget === "local" || tool.executionTarget === "mcp") {
      return {
        success: false,
        error: `Tool '${name}' requires the local engine — cannot execute in cloud`,
      };
    }

    try {
      return await tool.execute(args, context);
    } catch (error: any) {
      return { success: false, error: `Tool '${name}' threw: ${error.message}` };
    }
  }

  /**
   * Returns the unique app names of all Composio tools currently registered.
   * Composio tools follow the naming pattern composio_{app}__{action}.
   * Used by SpawnAgentTool to populate userContext.connectedApps.
   */
  getConnectedComposioApps(): string[] {
    const apps = new Set<string>();
    for (const tool of this.tools.values()) {
      if (tool.name.startsWith("composio_")) {
        const appPart = tool.name.slice("composio_".length).split("__")[0];
        if (appPart) apps.add(appPart);
      }
    }
    return [...apps];
  }

  // ------------------------------------------------------------------
  // Extension (per-request dynamic tools)
  // ------------------------------------------------------------------

  extend(dynamicTools: BaseTool[]): ToolRegistry {
    const extended = new ToolRegistry();
    for (const tool of this.tools.values()) {
      extended.register(tool);
    }
    for (const tool of dynamicTools) {
      extended.register(tool);
    }
    return extended;
  }
}

// ------------------------------------------------------------------
// Singleton + per-request factory
// ------------------------------------------------------------------

let registry: ToolRegistry | null = null;

export function getToolRegistry(): ToolRegistry {
  if (!registry) {
    registry = new ToolRegistry();
  }
  return registry;
}

export function createRequestRegistry(mcpTools: BaseTool[] = []): ToolRegistry {
  if (mcpTools.length === 0) return getToolRegistry();
  return getToolRegistry().extend(mcpTools);
}
