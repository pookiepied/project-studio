/// <reference types="@cloudflare/workers-types" />

import type { Env } from "../env";
import type { AgentToolDescriptor, ToolExecResult } from "./types";
import type { ClientToolBridge } from "./clientBridge";
import { hubNativeExecute, hubComposioExecute, hubRemoteExecute } from "./hubClient";

/**
 * Execute a single agent tool call by routing on its source:
 *   native / composio / remote_mcp → studio-mcp hub (cloud execution)
 *   local_mcp                      → ClientToolBridge (desktop relay)
 *
 * Composio uses the userId as the Composio entity id (the hub's convention).
 */
export interface ExecuteOptions {
  userId: string;
  bridge: ClientToolBridge;
}

export async function executeAgentTool(
  env:        Env,
  descriptor: AgentToolDescriptor,
  args:       unknown,
  options:    ExecuteOptions,
): Promise<ToolExecResult> {
  const { routing } = descriptor;

  switch (routing.kind) {
    case "native":
      return hubNativeExecute(env, routing.serviceId, routing.toolName, args);

    case "composio":
      return hubComposioExecute(env, routing.slug, routing.connectionId, options.userId, args);

    case "remote_mcp":
      return hubRemoteExecute(env, routing.url, routing.toolName, args, routing.authToken);

    case "local_mcp":
      return options.bridge.execute(routing.serverName, routing.toolName, args);

    default: {
      const _exhaustive: never = routing;
      return { success: false, error: `Unknown tool routing: ${JSON.stringify(_exhaustive)}` };
    }
  }
}
