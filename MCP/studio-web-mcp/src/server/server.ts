import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProviderConfig } from "../config/env.js";
import { SERVER_INFO } from "./metadata.js";
import { registerSearchTool } from "../tools/search/index.js";
import { registerFetchTool } from "../tools/fetch/index.js";

export function createMcpServer(getConfig: () => ProviderConfig): McpServer {
  const server = new McpServer(
    {
      name: SERVER_INFO.name,
      version: SERVER_INFO.version,
    },
    {
      capabilities: {
        tools: {},
      },
      instructions: SERVER_INFO.description,
    },
  );

  registerSearchTool(server, getConfig);
  registerFetchTool(server, getConfig);

  return server;
}
