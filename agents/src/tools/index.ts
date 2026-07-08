/**
 * Agents-worker tool plane — gives any agent running here the same "any tool
 * from anywhere" reach as the main chat agent.
 *
 *   loader   → build the catalog (native / composio / remote_mcp / local_mcp)
 *   executor → run a tool call (cloud via the hub, local via the ClientToolBridge)
 *
 * See STUDIO_AGENT_TOOL_PLAN.md.
 */
export * from "./types";
export * from "./clientBridge";
export * from "./loader";
export * from "./executor";
export * from "./hubClient";
