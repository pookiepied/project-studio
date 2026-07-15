/**
 * runtime/index.ts — the Local Runtime's public barrel.
 *
 * The ONLY path outside code may use to import the runtime:
 *   import { useRuntimeInit, wsPool, executeLocalTools, ... } from "@/runtime";
 *
 * No file outside `runtime/` may deep-import a `runtime/**` internal path.
 * That barrel *is* the subsystem boundary (D-1).
 */

// protocol — the runtime's public wire contract (D-9, audit B1)
export type { ChatRequestBody } from "./protocol";

// servers — catalogue + lifecycle + manifest
export {
  LOCAL_MCP_SERVERS,
  getLocalMcpServer,
  readLocalMcpPermission,
  setLocalMcpPermission,
  type LocalMcpServerDef,
} from "./servers/catalog";
export { startLocalMcp, stopLocalMcp } from "./servers/manifest";
export {
  HARNESS_PERMISSION_KEY,
  COMPUTER_USE_PERMISSION_KEY,
  type LocalPermissionGrants,
} from "./servers/lifecycle";
export { useRuntimeInit } from "./servers/useRuntimeInit";

// transport — WebSocket pool + React driver
export { wsPool } from "./transport/wsPool";
export { useAgentChat } from "./transport/useAgentChat";

// execution — local tool executor + permission gate
export { executeLocalTools, type ToolExecutionCallbacks } from "./execution/executeLocalTools";

// capabilities — what's running + turn body builder
export { checkLocalCapabilities } from "./capabilities/capabilityService";
export type { LocalCapabilitiesSnapshot, LocalCapabilityId } from "./capabilities/types";
export { buildChatBody, getMcpServers } from "./capabilities/buildChatBody";

// ui — tool-card display
export { toolLabel, getToolIcon } from "./ui/toolCardUtils";
export { classifyToolDisplay, extractGeneratedImageIds, deleteRemoteImages } from "./ui/classifyToolDisplay";
export { ToolPermissionCard } from "./ui/ToolPermissionCard";
export { RuntimeStepCard } from "./ui/RuntimeStepCard";
export { InlineToolSteps } from "./ui/InlineToolSteps";
