import type { ContextPackage, RuntimeConsumer } from "@studio/v2-contracts";
import type { Env } from "../system/env";
import { buildMcpContext } from "../builders/mcp";
import { buildConnectorContext } from "../builders/connectors";

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
  const [mcp, connectors] = await Promise.all([
    buildMcpContext(env, request.userId, request.task),
    buildConnectorContext(env, request.userId, request.task),
  ]);
  return {
    userId: request.userId,
    conversationId: request.conversationId,
    taskId: request.taskId,
    runtime: {
      consumer: request.consumer,
      systemPrompt: systemPromptFor(request.consumer),
      instructions: [],
      // Deliberately open-ended. Context/agent profiles may opt into explicit
      // limits later, but the default runtime path should keep going while it
      // is making progress and infrastructure remains available.
      limits: {},
    },
    conversation: {
      currentMessage: request.task,
      relevantHistory: [],
      priorToolResults: [],
      attachments: [],
    },
    connectors: connectors.context,
    mcp: mcp.context,
    tools: [...connectors.tools, ...mcp.tools],
    skills: [],
    agents: [],
    user: {
      preferences: {},
      relevantMemories: [],
      permissions: [],
    },
    project: {
      relevantFiles: [],
      documentation: [],
    },
  };
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
