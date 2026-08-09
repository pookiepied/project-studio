import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProviderConfig } from "../../config/env.js";
import { toMcpError } from "../../errors/response.js";
import { SearchInputSchema } from "./schema.js";
import { handleSearch } from "./handler.js";

export function registerSearchTool(server: McpServer, getConfig: () => ProviderConfig) {
  server.registerTool(
    "search",
    {
      title: "Web Search",
      description: "Search the web. Returns normalized results from Tavily (primary) with Brave fallback. Provider selection is automatic — do not choose a vendor.",
      inputSchema: SearchInputSchema.shape,
    },
    async (args) => {
      try {
        const cfg = getConfig();
        const result = await handleSearch(args, cfg);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (e) {
        const { code, message } = toMcpError(e);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: { code, message } }, null, 2) }],
          isError: true,
        };
      }
    },
  );
}
