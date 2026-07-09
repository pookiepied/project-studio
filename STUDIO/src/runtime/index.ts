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
export type {
  ChatRequestBody,
  AgentChatHandlers,
  PoolConnectionStatus,
  PoolServerMessage,
} from "./protocol";

// servers — catalogue + lifecycle + manifest
export {
  LOCAL_MCP_SERVERS,
  getLocalMcpServer,
  readLocalMcpPermission,
  setLocalMcpPermission,
  HARNESS_ENV,
  type LocalMcpServerDef,
  type LocalMcpPermission,
} from "./servers/catalog";
export {
  startLocalMcp,
  stopLocalMcp,
  resolveLocalMcpPath,
  syncLocalMcpManifest,
} from "./servers/manifest";
export {
  ensureLocalMcpRegistered,
  pushServerManifest,
  resyncPendingManifests,
  resetManifestSyncState,
  startManifestResyncOnReconnect,
  type ManifestTool,
} from "./servers/manifestSync";
export {
  HARNESS_PERMISSION_KEY,
  COMPUTER_USE_PERMISSION_KEY,
  grantedServers,
  registerAndStartLocalServers,
  restartServer,
  HEALTH_CHECK_INTERVAL_MS,
  type LocalPermissionGrants,
} from "./servers/lifecycle";
export { useRuntimeInit, type HarnessInitState } from "./servers/useRuntimeInit";

// transport — WebSocket pool + React driver
export { wsPool } from "./transport/wsPool";
export { parsePoolMessage } from "./transport/wsMessages";
export { useAgentChat, type UseAgentChatReturn } from "./transport/useAgentChat";

// invoke — Tauri invoke contract
export {
  invokeMcpTool,
  formatMcpError,
  truncateMcpOutput,
  extractMcpImages,
  MCP_INVOKE_TIMEOUT_MS,
  MAX_MCP_OUTPUT_CHARS,
} from "./invoke/invokeMcpTool";

// execution — local tool executor + permission gate
export {
  executeLocalTools,
  type ToolExecutionCallbacks,
  type ToolExecutionResult,
} from "./execution/executeLocalTools";

// capabilities — what's running + turn body builder
export { checkLocalCapabilities } from "./capabilities/capabilityService";
export type {
  LocalCapabilitiesSnapshot,
  LocalCapabilityId,
  LocalCapabilityStatus,
} from "./capabilities/types";
export { buildChatBody, getMcpServers, type ChatBodyParams } from "./capabilities/buildChatBody";

// ui — tool-card display
export { toolLabel, getToolIcon, argsPreview } from "./ui/toolCardUtils";
export { resolveMcpService, getMcpActionLabel, type McpServiceInfo } from "./ui/toolCardRegistry";
export { classifyToolDisplay, extractGeneratedImageIds, deleteRemoteImages } from "./ui/classifyToolDisplay";
export { ToolPermissionCard } from "./ui/ToolPermissionCard";
export { RuntimeStepCard } from "./ui/RuntimeStepCard";
export { InlineToolSteps } from "./ui/InlineToolSteps";
