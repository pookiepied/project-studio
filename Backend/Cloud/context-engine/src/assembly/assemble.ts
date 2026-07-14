import type { ContextCacheStatus, ContextPackage, RuntimeConsumer } from "../contracts";
import type { Env } from "../system/env";
import { buildMcpContext } from "../builders/mcp";
import { buildConnectorContext } from "../builders/connectors";
import { buildConversationContext } from "../builders/conversation";
import { buildUserContext } from "../builders/user";
import { buildProjectContext } from "../builders/project";
import { buildSkillContext } from "../builders/skills";
import { buildAgentContext } from "../builders/agents";
import { contextCacheKey, readContextCache, writeContextCache } from "../cache/contextCache";
import { buildCapabilityCatalog, buildSendableContext } from "../projection/catalog";
import { defaultTools } from "../projection/defaultTools";

/**
 * Orchestrates the layer builders and combines their output into one compact,
 * permission-aware ContextPackage for the requesting runtime.
 */
export interface ContextRequest {
  userId: string;
  workspaceId?: string;
  agentId?: string;
  taskId: string;
  conversationId?: string;
  task: string;
  /** Which runtime is asking. This affects what is exposed. */
  consumer: RuntimeConsumer;
}

export async function assembleContext(
  env: Env,
  request: ContextRequest,
): Promise<ContextPackage> {
  const cacheKey = contextCacheKey(request);
  const cached = readContextCache(cacheKey);
  if (cached) {
    return { ...cached, contextEngine: { ...cached.contextEngine, cacheStatus: "hit" } };
  }
  const assembled = await buildContextPackage(env, request, cacheKey, "miss");
  writeContextCache(cacheKey, { ...assembled, contextEngine: { ...assembled.contextEngine, cacheStatus: "refreshed" } });
  return assembled;
}

async function buildContextPackage(
  env: Env,
  request: ContextRequest,
  cacheKey: string,
  cacheStatus: ContextCacheStatus,
): Promise<ContextPackage> {
  const [mcp, connectors, conversation, skills, agents, user, project] = await Promise.all([
    buildMcpContext(env, request.userId, request.task),
    buildConnectorContext(env, request.userId, request.task),
    buildConversationContext(env, request.userId, request.conversationId, request.task),
    buildSkillContext(env, request.userId, request.task),
    buildAgentContext(env, request.userId, request.task),
    soft(() => buildUserContext(env, request.userId, request.task), { preferences: {}, relevantMemories: [], recentMemory: [], userProfile: {}, permissions: [] }),
    soft(() => buildProjectContext(env, request.userId, request.task), { relevantFiles: [], documentation: [], workspace: { location: "local" as const, available: false } }),
  ]);
  const defaults = defaultTools();
  const tools = uniqueTools([...defaults, ...connectors.tools, ...mcp.tools]);
  const base = {
    userId: request.userId,
    workspaceId: request.workspaceId,
    agentId: request.agentId,
    conversationId: request.conversationId,
    taskId: request.taskId,
    contextEngine: {
      service: "studio-context-engine" as const,
      projectionId: crypto.randomUUID(),
      cacheKey,
      cacheStatus,
      assembledAt: new Date().toISOString(),
      versions: {
        context: "v1",
        registry: "unknown",
        memory: "unknown",
        capability: "unknown",
      },
    },
    runtime: {
      consumer: request.consumer,
      systemPrompt: systemPromptFor(request.consumer),
      instructions: [capabilityPreamble(mcp.context, connectors.context)],
      limits: {},
    },
    user,
    project,
    conversation,
    connectors: connectors.context,
    mcp: mcp.context,
    tools,
    defaultTools: defaults,
    skills,
    agents,
  } satisfies Omit<ContextPackage, "internal" | "sendable" | "capabilityCatalog">;
  const capabilityCatalog = buildCapabilityCatalog({
    mcp: base.mcp,
    connectors: base.connectors,
    skills: base.skills,
    agents: base.agents,
    tools: base.tools,
    defaultTools: base.defaultTools,
  });
  const withCatalog = {
    ...base,
    capabilityCatalog,
    internal: {
      capabilityCount: capabilityCatalog.length,
      toolCount: tools.length,
      defaultToolCount: defaults.length,
      memoryCategories: ["recent_memory", "user_profile"] as const,
      projection: request.consumer,
    },
  } satisfies Omit<ContextPackage, "sendable">;
  return { ...withCatalog, sendable: buildSendableContext(withCatalog) };
}

async function soft<T>(build: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await build();
  } catch (error) {
    console.warn("Non-critical context builder failed", error);
    return fallback;
  }
}

function capabilityPreamble(mcp: ContextPackage["mcp"], connectors: ContextPackage["connectors"]): string {
  const online = (id: string) => mcp.some((item) => item.ref.id === id && item.available) ? "online" : "offline";
  const cloud = mcp.some((item) => item.location === "cloud" && item.available) ? "available" : "unavailable";
  return `Capability status: Studio Harness: ${online("studio-harness")} | Computer Use: ${online("computer-use")} | Connectors: ${connectors.length} authenticated | Cloud MCP: ${cloud}.`;
}

function systemPromptFor(consumer: RuntimeConsumer): string {
  switch (consumer) {
    case "planner":
      return "You are Studio Planner Runtime. Produce clear plans and do not perform write actions.";
    case "agent":
      return "You are Studio Agent Runtime. Follow the provided agent definition and scoped task.";
    case "execution":
    default:
      return "You are Studio Execution Runtime. Execute the prepared task directly and respect tool, approval, and context boundaries.";
  }
}

function uniqueTools(tools: ContextPackage["tools"]): ContextPackage["tools"] {
  const byName = new Map<string, ContextPackage["tools"][number]>();
  for (const tool of tools) byName.set(tool.name, tool);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
