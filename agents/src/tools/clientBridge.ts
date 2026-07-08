/// <reference types="@cloudflare/workers-types" />

import type { ToolExecResult } from "./types";

/**
 * ClientToolBridge — the seam through which an agent executes LOCAL MCP tools
 * (tools running on the user's machine: studio-harness, computer-use, blender, …).
 *
 * The cloud cannot reach the user's machine directly. Just as the main chat
 * agent defers local tool calls to the Tauri desktop over its WebSocket, a
 * sub-agent defers them over its OWN channel to the desktop. That channel is
 * built in a later step (the desktop ↔ sub-agent connection); this interface is
 * the contract it will implement.
 *
 * Until that channel exists, agents run with NotConnectedBridge: cloud tools
 * work fully, and a local tool call returns a clear "not available" error
 * rather than hanging.
 */
export interface ClientToolBridge {
  /** Whether a desktop channel is currently attached. */
  readonly connected: boolean;

  /**
   * Run a local MCP tool on the user's machine and return its result.
   * @param serverName local MCP server name (e.g. "studio-harness")
   * @param toolName   bare tool name on that server
   * @param args       tool arguments
   */
  execute(serverName: string, toolName: string, args: unknown): Promise<ToolExecResult>;
}

/**
 * Default bridge used when no desktop channel is attached. Local tools are
 * unavailable; cloud tools are unaffected (they never touch the bridge).
 */
export class NotConnectedBridge implements ClientToolBridge {
  readonly connected = false;

  async execute(serverName: string, toolName: string): Promise<ToolExecResult> {
    return {
      success: false,
      error:
        `Local tool '${serverName}__${toolName}' requires the user's machine, but no ` +
        `desktop channel is attached to this agent. Local MCP execution for sub-agents ` +
        `is not yet wired (pending the desktop ↔ sub-agent channel).`,
    };
  }
}
