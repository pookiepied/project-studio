import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProviderConfig } from "../../config/env.js";
import { toMcpError } from "../../errors/response.js";
import { FetchInputSchema } from "./schema.js";
import { handleFetch } from "./handler.js";

export function registerFetchTool(server: McpServer, getConfig: () => ProviderConfig) {
  server.registerTool(
    "fetch",
    {
      title: "Web Fetch",
      description: "Fetch a URL and return LLM-friendly content. Uses Jina Reader (primary) with Tavily Extract fallback. Content is bounded via max_chars/offset pagination — request next_offset if has_more is true.",
      inputSchema: FetchInputSchema.shape,
    },
    async (args) => {
      try {
        const cfg = getConfig();
        const result = await handleFetch(args, cfg);
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
