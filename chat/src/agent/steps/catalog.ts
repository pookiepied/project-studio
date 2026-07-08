import type { ToolRegistry } from "../../tools";
import type { LLMToolDefinition } from "../../tools/base/types";

/** Converts a snake_case server name to Title Case for display. */
export function toTitleCase(snake: string): string {
  return snake
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Infers a human-readable category name from a tool's full name.
 * Used to group tools in the expanded catalog.
 */
export function inferCategory(toolName: string): string {
  const toolPart = toolName.includes("__")
    ? toolName.split("__").slice(1).join("__").toLowerCase()
    : toolName.toLowerCase();

  if (/^(read_file|write_file|edit_file|glob|list_dir|stat_file|create_file|delete_file|move_file|copy_file)/.test(toolPart))
    return "Filesystem";
  if (/^(grep|outline_file|search_symbol|analyze_file|index_codebase|explore_codebase)/.test(toolPart))
    return "Code Intelligence";
  if (/^(bash|repl|powershell|shell_exec)/.test(toolPart))
    return "Shell & Execution";
  if (/^git_/.test(toolPart))
    return "Git";
  if (/^run_(explorer|planner|coder|tester|debugger|reviewer)_agent/.test(toolPart))
    return "Cloud Coding Agents";
  if (/^ssh_/.test(toolPart))
    return "Remote Access";
  if (/^(get_desktop_guide|screenshot|click|type_text|key_press|mouse_move|focus_window|get_window)/.test(toolPart))
    return "Desktop Control";
  if (/^ask_user_question/.test(toolPart))
    return "Interaction";
  if (/^(sleep|get_coding_guide)/.test(toolPart))
    return "Utilities";

  if (/\b(search|find|query|list|get|fetch|read)\b/.test(toolPart)) return "Read & Query";
  if (/\b(create|add|new|insert|post)\b/.test(toolPart)) return "Create";
  if (/\b(update|edit|modify|patch|put)\b/.test(toolPart)) return "Update";
  if (/\b(delete|remove|clear)\b/.test(toolPart)) return "Delete";

  if (toolName.startsWith("memory_")) return "Memory";
  if (toolName === "web_search" || toolName === "web_fetch" || toolName === "rag") return "Web & Search";
  if (toolName.startsWith("image_") || toolName.startsWith("video_")) return "Generation";
  if (toolName === "http_request") return "Network";
  if (toolName === "think" || toolName === "skill_read" || toolName === "task_write") return "Reasoning";
  if (toolName === "spawn_agent" || toolName === "await_agents") return "Agents";

  return "General";
}

/**
 * Builds a lightweight tool directory listing — the "index" response.
 * Shows all connected servers with tool counts grouped by local vs cloud MCP,
 * plus a summary of built-in cloud tools.
 *
 * Content starts with "[Tool Directory]" so getExpandCountSinceLastUser can
 * identify index calls and exclude them from the per-turn expansion limit.
 */
export function buildToolDirectory(
  registry: ToolRegistry,
  includeLocal: boolean,
  catalogBlocked: Set<string>
): string {
  const allDefs = registry.getContextualDefinitions(includeLocal, { coreMode: "all" });

  const tier1: string[] = [];
  const tier2: string[] = [];
  const localMcp = new Map<string, number>();
  const cloudMcp = new Map<string, number>();

  for (const def of allDefs) {
    if (catalogBlocked.has(def.function.name)) continue;
    if (def.function.name.startsWith("mcp_studio_harness__lsp_")) continue;
    const tool = registry.get(def.function.name);
    if (!tool) continue;

    if (tool.executionTarget === "mcp" || tool.executionTarget === "remote_mcp") {
      const withoutPrefix = def.function.name.startsWith("mcp_")
        ? def.function.name.slice(4)
        : def.function.name;
      const sep = withoutPrefix.indexOf("__");
      const serverPart = sep !== -1 ? withoutPrefix.slice(0, sep) : withoutPrefix;
      const map = tool.executionTarget === "mcp" ? localMcp : cloudMcp;
      map.set(serverPart, (map.get(serverPart) ?? 0) + 1);
    } else if (!tool.contextInjected) {
      if (tool.tier === 1) tier1.push(def.function.name);
      else tier2.push(def.function.name);
    }
  }

  const lines: string[] = ["[Tool Directory]", ""];

  lines.push(`[Built-in Cloud Tools — ${tier1.length + tier2.length} tools]`);
  lines.push(`  Tier 1 (always visible): ${tier1.join(", ")}`);
  if (tier2.length > 0) {
    lines.push(`  Tier 2 (expand with filter="core"): ${tier2.join(", ")}`);
  }
  lines.push("");

  if (localMcp.size > 0) {
    lines.push(`[Local MCP Servers — ${localMcp.size} server${localMcp.size !== 1 ? "s" : ""}]`);
    for (const [server, count] of localMcp) {
      lines.push(`  ${server}  (${toTitleCase(server)}) — ${count} tools`);
    }
    lines.push(`  → expand_tools(filter="<server_name>") to see categorized tools`);
    lines.push("");
  }

  if (cloudMcp.size > 0) {
    lines.push(`[Cloud MCP Servers — ${cloudMcp.size} server${cloudMcp.size !== 1 ? "s" : ""}]`);
    for (const [server, count] of cloudMcp) {
      lines.push(`  ${server}  (${toTitleCase(server)}) — ${count} tools`);
    }
    lines.push(`  → expand_tools(filter="<server_name>") to see categorized tools`);
    lines.push("");
  }

  if (localMcp.size === 0 && cloudMcp.size === 0) {
    lines.push("[No MCP servers connected]");
    lines.push("");
  }

  const totalMcpTools = [...localMcp.values(), ...cloudMcp.values()].reduce((a, b) => a + b, 0);
  const total = tier1.length + tier2.length + totalMcpTools;
  const serverCount = localMcp.size + cloudMcp.size;
  lines.push(`Total: ${total} tools · ${serverCount} MCP server${serverCount !== 1 ? "s" : ""} connected`);

  return lines.join("\n");
}

/**
 * Builds a categorized tool catalog for a specific expansion call.
 * Tools are grouped by inferred category for readability.
 */
export function buildExpandedCatalog(
  defs: LLMToolDefinition[],
  filter: string,
  hint?: string
): string {
  if (defs.length === 0) {
    return (
      `No tools found for filter "${filter}". ` +
      `Use expand_tools(filter="index") to see what is available.`
    );
  }

  const filterLabel =
    filter === "core"      ? "built-in tools"
    : filter === "local_mcp"  ? "local MCP tools"
    : filter === "cloud_mcp"  ? "cloud MCP tools"
    : filter === "mcp"        ? "all MCP tools"
    : filter === "all"        ? "all tools"
    : `${filter} tools`;

  const byCategory = new Map<string, { name: string; desc: string }[]>();
  for (const def of defs) {
    const category = inferCategory(def.function.name);
    if (!byCategory.has(category)) byCategory.set(category, []);
    const raw = def.function.description;
    const desc = raw.length > 90 ? raw.slice(0, 87) + "..." : raw;
    byCategory.get(category)!.push({ name: def.function.name, desc });
  }

  const lines: string[] = [
    `Expanded ${filterLabel} (${defs.length} tools)${hint ? ` — hint: ${hint}` : ""}`,
    "",
  ];
  for (const [category, tools] of byCategory) {
    lines.push(`[${category}]`);
    for (const t of tools) lines.push(`  ${t.name}: ${t.desc}`);
    lines.push("");
  }

  return lines.join("\n").trim();
}
