/**
 * expand_tools — virtual meta-tool for on-demand tool discovery.
 *
 * NOT registered in the ToolRegistry. The LLM node injects
 * EXPAND_TOOLS_DEFINITION into the tool list, and the tools node
 * handles execution inline.
 *
 * Filter modes:
 *   "index"      — directory of all connected servers/categories (free — no limit)
 *   "core"       — built-in cloud tools only (web, memory, generation, etc.)
 *   "local_mcp"  — tools from local MCP servers (run via Tauri subprocess)
 *   "cloud_mcp"  — tools from remote/cloud MCP servers (run via HTTP in Worker)
 *   "mcp"        — all MCP tools (local + cloud combined)
 *   "all"        — everything (use as last resort)
 *   "<name>"     — tools from a specific server, e.g. "studio_harness" or "github"
 */

import { LLMToolDefinition } from "../base/types";
import { AgentMessage } from "../../agent/state";

/**
 * The filter value passed to expand_tools.
 * Can be a known mode string or a server name.
 */
export type ExpandFilter = string;

/**
 * Known mode constants — used for runtime checks to distinguish
 * mode strings from server-name strings.
 */
export const KNOWN_EXPAND_MODES = new Set([
  "index",
  "core",
  "local_mcp",
  "cloud_mcp",
  "mcp",
  "all",
]);

/**
 * Maps an ExpandFilter to the scope value expected by
 * ToolRegistry.getContextualDefinitions(). Server-name filters
 * map to "mcp" so only MCP tools are fetched before narrowing.
 */
export function filterToScope(filter: ExpandFilter): "core" | "mcp" | "all" {
  if (filter === "core") return "core";
  if (filter === "local_mcp" || filter === "cloud_mcp" || filter === "mcp") return "mcp";
  if (filter === "all" || filter === "index") return "all";
  // Server name → fetch MCP tools first, then narrow by server
  return "mcp";
}

/**
 * Applies local_mcp / cloud_mcp / server-name sub-filtering to a
 * definition list AFTER the initial registry fetch.
 *
 * @param defs            Tool definitions from getContextualDefinitions.
 * @param getExecTarget   Function to look up executionTarget for a tool name.
 * @param filter          The ExpandFilter value to apply.
 */
export function applyExpandFilter<T extends { function: { name: string } }>(
  defs: T[],
  getExecTarget: (name: string) => string | undefined,
  filter: ExpandFilter
): T[] {
  if (filter === "local_mcp") {
    return defs.filter((d) => getExecTarget(d.function.name) === "mcp");
  }
  if (filter === "cloud_mcp") {
    return defs.filter((d) => getExecTarget(d.function.name) === "remote_mcp");
  }
  if (!KNOWN_EXPAND_MODES.has(filter)) {
    // Treat as server name — match against the server part of mcp_<server>__<tool>
    const sf = filter.toLowerCase().replace(/-/g, "_");
    return defs.filter((d) => {
      const name = d.function.name.toLowerCase();
      if (!name.startsWith("mcp_")) return false;
      const withoutPrefix = name.slice(4);
      const sep = withoutPrefix.indexOf("__");
      const serverPart = sep !== -1 ? withoutPrefix.slice(0, sep) : withoutPrefix;
      // Accept: exact match, serverPart contains filter, or filter contains serverPart
      return serverPart === sf || serverPart.includes(sf) || sf.includes(serverPart);
    });
  }
  return defs;
}

export const EXPAND_TOOLS_DEFINITION: LLMToolDefinition = {
  type: "function",
  function: {
    name: "expand_tools",
    description:
      "Discover tools not currently visible. Start with filter=\"index\" to see a directory of all connected servers and categories — this call is free and does not count toward the per-turn limit. Then use a specific server name or category to load those tools. Use this before concluding a capability is unavailable.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        filter: {
          type: "string",
          description:
            "What to discover. \"index\" returns a directory of all connected servers and their tool counts (free call). \"core\" returns built-in tools (web, memory, generation, http). \"local_mcp\" returns all local MCP server tools. \"cloud_mcp\" returns all cloud/remote MCP tools. \"mcp\" returns all MCP tools. \"all\" returns everything. Or pass a specific server name such as \"studio_harness\" or \"github\" to see only that server's tools grouped by category.",
        },
        hint: {
          type: "string",
          description: "Optional: what kind of tool you are looking for, for additional context.",
        },
      },
      required: ["filter"],
    },
  },
};

/**
 * Parses expand_tools arguments from a raw JSON string.
 * Supports both the new "filter" parameter and the legacy "scope" parameter.
 */
export function parseExpandArgs(rawArgs: string | undefined): {
  filter: ExpandFilter;
  hint?: string;
} {
  if (!rawArgs) return { filter: "index" };
  try {
    const parsed = JSON.parse(rawArgs);
    // Accept new "filter" field or legacy "scope" field
    const rawFilter =
      typeof parsed?.filter === "string"
        ? parsed.filter.toLowerCase()
        : typeof parsed?.scope === "string"
        ? parsed.scope.toLowerCase()
        : "index";
    const hint = typeof parsed?.hint === "string" ? parsed.hint : undefined;
    return { filter: rawFilter, hint };
  } catch {
    return { filter: "index" };
  }
}

/**
 * Counts non-index expand_tools calls since the last user message.
 *
 * Index calls (content starts with "[Tool Directory]") are free and
 * excluded from the count. The per-turn limit (currently 2) applies
 * only to real expansion calls.
 */
export function getExpandCountSinceLastUser(messages: AgentMessage[]): number {
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  const slice = lastUserIdx >= 0 ? messages.slice(lastUserIdx + 1) : messages;
  return slice.filter((m) => {
    if (m.role !== "tool" || m.name !== "expand_tools") return false;
    // Index responses begin with "[Tool Directory]" — they are free
    const content = typeof m.content === "string" ? m.content : "";
    return !content.startsWith("[Tool Directory]");
  }).length;
}
