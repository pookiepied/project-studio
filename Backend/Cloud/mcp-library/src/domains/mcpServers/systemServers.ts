import type { McpServerDefinition } from "./types";

export const systemMcpServerDefinitions: McpServerDefinition[] = [
  {
    id: "studio-docs-mcp",
    name: "Studio Docs MCP",
    slug: "studio-docs-mcp",
    description: "Read-only access to curated Studio product and architecture documentation.",
    version: "0.1.0",
    status: "draft",
    owner: { type: "system" },
    transport: "streamable-http",
    endpointRef: "service-binding://studio-docs-mcp",
    configRef: "bundled://mcp-library/mcp-servers/studio-docs-mcp.json",
    tools: [
      {
        name: "search_studio_docs",
        description: "Search curated Studio documentation by query, category, or tag.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search text." },
            category: { type: "string", description: "Optional documentation category." },
            limit: { type: "integer", minimum: 1, maximum: 20, default: 5 },
          },
          required: ["query"],
          additionalProperties: false,
        },
        enabled: true,
        metadata: { category: "knowledge", effect: "read" },
      },
      {
        name: "get_studio_doc",
        description: "Fetch a curated Studio documentation entry by id.",
        inputSchema: {
          type: "object",
          properties: {
            documentId: { type: "string", description: "Documentation entry id." },
          },
          required: ["documentId"],
          additionalProperties: false,
        },
        enabled: true,
        metadata: { category: "knowledge", effect: "read" },
      },
    ],
    permissions: ["studio.docs.read"],
    tags: ["studio", "knowledge", "documentation", "read-only"],
    metadata: {
      category: "knowledge",
      lifecycle: "built-in-system",
      platformManaged: false,
      summary: "A lightweight Cloudflare-compatible MCP server for curated Studio documentation retrieval.",
    },
  },
  {
    id: "studio-workflow-mcp",
    name: "Studio Workflow MCP",
    slug: "studio-workflow-mcp",
    description: "Read-only access to Studio workflow runbooks, checklists, and task templates.",
    version: "0.1.0",
    status: "draft",
    owner: { type: "system" },
    transport: "streamable-http",
    endpointRef: "service-binding://studio-workflow-mcp",
    configRef: "bundled://mcp-library/mcp-servers/studio-workflow-mcp.json",
    tools: [
      {
        name: "list_studio_runbooks",
        description: "List available Studio runbooks and workflow templates by category.",
        inputSchema: {
          type: "object",
          properties: {
            category: { type: "string", description: "Optional runbook category." },
            limit: { type: "integer", minimum: 1, maximum: 20, default: 10 },
          },
          additionalProperties: false,
        },
        enabled: true,
        metadata: { category: "workflow", effect: "read" },
      },
      {
        name: "get_studio_runbook",
        description: "Fetch a Studio runbook, checklist, or task template by id.",
        inputSchema: {
          type: "object",
          properties: {
            runbookId: { type: "string", description: "Runbook or template id." },
          },
          required: ["runbookId"],
          additionalProperties: false,
        },
        enabled: true,
        metadata: { category: "workflow", effect: "read" },
      },
    ],
    permissions: ["studio.workflow.read"],
    tags: ["studio", "workflow", "runbooks", "templates", "read-only"],
    metadata: {
      category: "workflow",
      lifecycle: "built-in-system",
      platformManaged: false,
      summary: "A lightweight Cloudflare-compatible MCP server for Studio workflow guidance and runbooks.",
    },
  },
];

export function listSystemMcpServerDefinitions(): McpServerDefinition[] {
  return systemMcpServerDefinitions;
}
