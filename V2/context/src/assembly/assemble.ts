import type { ContextPackage, RuntimeConsumer } from "@studio/v2-contracts";
import type { Env } from "../system/env";
import { buildMcpContext } from "../builders/mcp";
import { buildConnectorContext } from "../builders/connectors";
import { buildConversationContext } from "../builders/conversation";
import { buildUserContext } from "../builders/user";
import { buildProjectContext } from "../builders/project";
import { buildSkillContext } from "../builders/skills";
import { buildAgentContext } from "../builders/agents";

/**
 * Orchestrates the layer builders (src/builders/*) and combines their output
 * into one compact, permission-aware ContextPackage for the requesting
 * runtime. Builders run in parallel where independent.
 */

export interface ContextRequest {
  userId: string;
  taskId: string;
  conversationId?: string;
  task: string;
  /** Which runtime is asking — affects what is exposed (e.g. planner gets read-only). */
  consumer: RuntimeConsumer;
}

export async function assembleContext(
  env: Env,
  request: ContextRequest,
): Promise<ContextPackage> {
  const refresh = await env.REGISTRY.fetch("http://registry/sync/platform", { method: "POST", headers: { "x-user-id": request.userId } });
  if (!refresh.ok) throw new Error(`Registry platform refresh failed (${refresh.status}).`);
  const [mcp, connectors, conversation, skills, agents, user, project] = await Promise.all([
    buildMcpContext(env, request.userId, request.task),
    buildConnectorContext(env, request.userId, request.task),
    buildConversationContext(env, request.userId, request.conversationId, request.task),
    buildSkillContext(env, request.userId, request.task),
    buildAgentContext(env, request.userId, request.task),
    soft(() => buildUserContext(env, request.userId, request.task), { preferences: {}, relevantMemories: [], permissions: [] }),
    soft(() => buildProjectContext(env, request.userId, request.task), { relevantFiles: [], documentation: [], workspace: { location: "local" as const, available: false } }),
  ]);
  const preamble = capabilityPreamble(mcp.context, connectors.context);
  return {
    userId: request.userId,
    conversationId: request.conversationId,
    taskId: request.taskId,
    runtime: {
      consumer: request.consumer,
      systemPrompt: systemPromptFor(request.consumer),
      instructions: [preamble],
      // Deliberately open-ended. Context/agent profiles may opt into explicit
      // limits later, but the default runtime path should keep going while it
      // is making progress and infrastructure remains available.
      limits: {},
    },
    user,
    project,
    conversation,
    connectors: connectors.context,
    mcp: mcp.context,
    tools: [...connectors.tools, ...mcp.tools],
    skills,
    agents,
  };
}

async function soft<T>(build: () => Promise<T>, fallback: T): Promise<T> {
  try { return await build(); }
  catch (error) { console.warn("Non-critical context builder failed", error); return fallback; }
}

function capabilityPreamble(mcp: ContextPackage["mcp"], connectors: ContextPackage["connectors"]): string {
  const online = (id: string) => mcp.some((item) => item.ref.id === id && item.available) ? "online" : "offline";
  const cloud = mcp.some((item) => item.location === "cloud" && item.available) ? "available" : "unavailable";
  return `Capability status: Studio Harness: ${online("studio-harness")} · Computer Use: ${online("computer-use")} · Connectors: ${connectors.length} authenticated · Cloud MCP: ${cloud}.`;
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
