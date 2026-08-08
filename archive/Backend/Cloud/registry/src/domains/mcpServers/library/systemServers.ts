import type { McpServerRecord } from "../types";

const now = "2026-07-15T00:00:00.000Z";

const agentRunRefSchema = {
  type: "object",
  properties: {
    runId: { type: "string" },
    parentRunId: { type: "string" },
    status: { type: "string", enum: ["queued", "running", "completed", "failed", "cancelled", "timeout"] },
    createdAt: { type: "string" },
  },
  required: ["runId", "status"],
  additionalProperties: false,
};

const reportSchema = {
  type: "object",
  properties: {
    reportId: { type: "string" },
    runId: { type: "string" },
    parentRunId: { type: "string" },
    type: { type: "string", enum: ["progress", "partial", "final", "error", "requires_input"] },
    status: { type: "string", enum: ["accepted", "stored", "delivered"] },
    message: { type: "string" },
    createdAt: { type: "string" },
  },
  required: ["reportId", "runId", "type", "status"],
  additionalProperties: true,
};

const skillRefSchema = {
  type: "object",
  properties: {
    skillId: { type: "string" },
    name: { type: "string" },
    version: { type: "string" },
    status: { type: "string" },
    source: { type: "string", enum: ["system", "user"] },
  },
  required: ["skillId", "name", "version", "status", "source"],
  additionalProperties: false,
};

export const systemMcpServerRegistrations: McpServerRecord[] = [
  {
    id: "studio-agent-execution-mcp",
    ownerType: "system",
    ownerKey: "system",
    name: "Studio Agent Execution MCP",
    slug: "studio-agent-execution-mcp",
    description: "Runtime interface for spawning, monitoring, awaiting, cancelling, and receiving reports from Studio sub-agents.",
    origin: "studio",
    status: "active",
    currentVersion: "0.1.0",
    transport: "streamable-http",
    endpointRef: "service-binding://studio-agent-execution-mcp",
    configRef: "bundled://mcp-library/mcp-servers/studio-agent-execution-mcp.json",
    tools: [
      {
        name: "spawn_agent",
        description: "Use this when the main agent needs to delegate a bounded task to a system or user-scoped sub-agent.",
        inputSchema: {
          type: "object",
          properties: {
            agentId: { type: "string", description: "Registered agent id to execute." },
            task: { type: "string", description: "The delegated task for the sub-agent." },
            parentRunId: { type: "string", description: "Current parent agent run id." },
            conversationId: { type: "string", description: "Conversation or task context id." },
            mode: { type: "string", enum: ["async", "await"], default: "async" },
            contextRefs: { type: "array", items: { type: "string" }, default: [] },
            timeoutMs: { type: "integer", minimum: 1000, maximum: 3600000 },
          },
          required: ["agentId", "task", "parentRunId"],
          additionalProperties: false,
        },
        outputSchema: agentRunRefSchema,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        enabled: true,
        metadata: { category: "execution", effect: "write" },
      },
      {
        name: "await_agent",
        description: "Use this when the parent agent needs to wait for a spawned sub-agent before continuing.",
        inputSchema: {
          type: "object",
          properties: {
            runId: { type: "string" },
            timeoutMs: { type: "integer", minimum: 1000, maximum: 3600000, default: 60000 },
            includeReports: { type: "boolean", default: true },
          },
          required: ["runId"],
          additionalProperties: false,
        },
        outputSchema: {
          type: "object",
          properties: {
            runId: { type: "string" },
            status: { type: "string", enum: ["completed", "failed", "cancelled", "timeout"] },
            result: { type: "object" },
            reports: { type: "array", items: reportSchema },
            error: { type: "object" },
          },
          required: ["runId", "status"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        enabled: true,
        metadata: { category: "execution", effect: "read" },
      },
      {
        name: "get_agent_status",
        description: "Use this when the parent agent needs the current state of a spawned sub-agent without waiting for completion.",
        inputSchema: {
          type: "object",
          properties: {
            runId: { type: "string" },
          },
          required: ["runId"],
          additionalProperties: false,
        },
        outputSchema: agentRunRefSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        enabled: true,
        metadata: { category: "execution", effect: "read" },
      },
      {
        name: "report_back",
        description: "Use this from a sub-agent to send progress, partial results, final output, errors, or user-input requests to its parent run.",
        inputSchema: {
          type: "object",
          properties: {
            parentRunId: { type: "string" },
            runId: { type: "string" },
            type: { type: "string", enum: ["progress", "partial", "final", "error", "requires_input"] },
            message: { type: "string" },
            data: { type: "object" },
            artifactRefs: { type: "array", items: { type: "string" }, default: [] },
          },
          required: ["parentRunId", "runId", "type", "message"],
          additionalProperties: false,
        },
        outputSchema: reportSchema,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        enabled: true,
        metadata: { category: "execution", effect: "write" },
      },
      {
        name: "read_agent_result",
        description: "Use this to retrieve the final result, error, reports, logs, or execution metadata for a completed sub-agent run.",
        inputSchema: {
          type: "object",
          properties: {
            runId: { type: "string" },
            includeLogs: { type: "boolean", default: false },
            includeReports: { type: "boolean", default: true },
          },
          required: ["runId"],
          additionalProperties: false,
        },
        outputSchema: {
          type: "object",
          properties: {
            runId: { type: "string" },
            status: { type: "string" },
            result: { type: "object" },
            reports: { type: "array", items: reportSchema },
            logs: { type: "array", items: { type: "object" } },
            metadata: { type: "object" },
          },
          required: ["runId", "status"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        enabled: true,
        metadata: { category: "execution", effect: "read" },
      },
      {
        name: "cancel_agent",
        description: "Use this when a parent agent must stop a spawned sub-agent that is no longer needed or unsafe to continue.",
        inputSchema: {
          type: "object",
          properties: {
            runId: { type: "string" },
            reason: { type: "string" },
          },
          required: ["runId", "reason"],
          additionalProperties: false,
        },
        outputSchema: agentRunRefSchema,
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        enabled: true,
        metadata: { category: "execution", effect: "destructive" },
      },
    ],
    permissions: ["studio.agents.spawn", "studio.agents.read", "studio.agents.report", "studio.agents.cancel"],
    tags: ["studio", "execution", "agents", "delegation", "orchestration"],
    metadata: {
      category: "execution",
      lifecycle: "built-in-system",
      platformManaged: false,
      definitionRef: "mcp-library:studio-agent-execution-mcp@0.1.0",
      communicationModel: "parent-child-report-back",
    },
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "studio-skill-library-mcp",
    ownerType: "system",
    ownerKey: "system",
    name: "Studio Skill Library MCP",
    slug: "studio-skill-library-mcp",
    description: "Discovery and progressive loading interface for Studio skills using SKILL.md-compatible skill bundles.",
    origin: "studio",
    status: "active",
    currentVersion: "0.1.0",
    transport: "streamable-http",
    endpointRef: "service-binding://studio-skill-library-mcp",
    configRef: "bundled://mcp-library/mcp-servers/studio-skill-library-mcp.json",
    tools: [
      {
        name: "skill_list",
        description: "Use this to list available skills by scope, status, category, or tag without loading full instructions.",
        inputSchema: {
          type: "object",
          properties: {
            scope: { type: "string", enum: ["system", "user", "all"], default: "all" },
            status: { type: "string", enum: ["active", "draft", "disabled", "archived"] },
            tag: { type: "string" },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
          },
          additionalProperties: false,
        },
        outputSchema: {
          type: "object",
          properties: {
            items: { type: "array", items: skillRefSchema },
          },
          required: ["items"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        enabled: true,
        metadata: { category: "skills", effect: "read" },
      },
      {
        name: "skill_search",
        description: "Use this to find relevant skills by natural-language task, metadata, tags, or activation hints.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            scope: { type: "string", enum: ["system", "user", "all"], default: "all" },
            limit: { type: "integer", minimum: 1, maximum: 20, default: 5 },
          },
          required: ["query"],
          additionalProperties: false,
        },
        outputSchema: {
          type: "object",
          properties: {
            items: { type: "array", items: skillRefSchema },
          },
          required: ["items"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        enabled: true,
        metadata: { category: "skills", effect: "read" },
      },
      {
        name: "skill_get",
        description: "Use this to inspect skill metadata, versions, permissions, activation rules, and available resources before reading instructions.",
        inputSchema: {
          type: "object",
          properties: {
            skillId: { type: "string" },
            version: { type: "string", default: "latest" },
          },
          required: ["skillId"],
          additionalProperties: false,
        },
        outputSchema: {
          type: "object",
          properties: {
            skill: skillRefSchema,
            frontmatter: { type: "object" },
            resources: { type: "array", items: { type: "object" } },
            permissions: { type: "array", items: { type: "string" } },
          },
          required: ["skill"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        enabled: true,
        metadata: { category: "skills", effect: "read" },
      },
      {
        name: "skill_read",
        description: "Use this to read the top-level SKILL.md instructions for a selected skill using progressive disclosure.",
        inputSchema: {
          type: "object",
          properties: {
            skillId: { type: "string" },
            version: { type: "string", default: "latest" },
          },
          required: ["skillId"],
          additionalProperties: false,
        },
        outputSchema: {
          type: "object",
          properties: {
            skill: skillRefSchema,
            content: { type: "string" },
            frontmatter: { type: "object" },
            resourceRefs: { type: "array", items: { type: "string" } },
          },
          required: ["skill", "content"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        enabled: true,
        metadata: { category: "skills", effect: "read" },
      },
      {
        name: "skill_read_resource",
        description: "Use this to read a supporting file from a skill bundle after SKILL.md references it.",
        inputSchema: {
          type: "object",
          properties: {
            skillId: { type: "string" },
            resourcePath: { type: "string" },
            version: { type: "string", default: "latest" },
          },
          required: ["skillId", "resourcePath"],
          additionalProperties: false,
        },
        outputSchema: {
          type: "object",
          properties: {
            skill: skillRefSchema,
            resourcePath: { type: "string" },
            contentType: { type: "string" },
            content: { type: "string" },
          },
          required: ["skill", "resourcePath", "contentType", "content"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        enabled: true,
        metadata: { category: "skills", effect: "read" },
      },
      {
        name: "skill_resolve",
        description: "Use this to resolve a skill into the ordered files and resources that should be loaded for the current task.",
        inputSchema: {
          type: "object",
          properties: {
            skillId: { type: "string" },
            task: { type: "string" },
            version: { type: "string", default: "latest" },
          },
          required: ["skillId", "task"],
          additionalProperties: false,
        },
        outputSchema: {
          type: "object",
          properties: {
            skill: skillRefSchema,
            loadOrder: { type: "array", items: { type: "string" } },
            warnings: { type: "array", items: { type: "string" } },
          },
          required: ["skill", "loadOrder"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        enabled: true,
        metadata: { category: "skills", effect: "read" },
      },
    ],
    permissions: ["studio.skills.list", "studio.skills.read"],
    tags: ["studio", "skills", "skill-library", "progressive-disclosure", "read-only"],
    metadata: {
      category: "skills",
      lifecycle: "built-in-system",
      platformManaged: false,
      definitionRef: "mcp-library:studio-skill-library-mcp@0.1.0",
      skillFormat: "SKILL.md bundle",
    },
    createdAt: now,
    updatedAt: now,
  },
];

export function listSystemMcpServerRegistrations(): McpServerRecord[] {
  return systemMcpServerRegistrations;
}
