export type { PermissionModeId, PermissionModeDef, PermissionIconKey } from "./types";
export {
  PERMISSION_MODES,
  getPermissionModesForEngine,
  getPermissionMode,
  studioModeFromAutopilot,
} from "./config";
export type {
  ToolRiskClass,
  ToolRiskCategory,
  RiskClassMeta,
} from "./toolRisk";
export {
  TOOL_RISK,
  RISK_CLASS_META,
  getToolRisk,
  getRiskMeta,
  isReadOnlyTool,
} from "./toolRisk";

// -- Enforcement engine (runtime permission decisions) ----------------------
export type {
  ChatMode,
  LocalContext,
  WorkspaceTrust,
  ActionMode,
  GrantScope,
  PermissionOutcome,
  PermissionDenyCode,
  PermissionPromptCode,
  PermissionReasonCode,
  PermissionDecision,
  PermissionContext,
  GrantLookup,
} from "./model";
export { evaluateToolCall } from "./engine";
export {
  LOCAL_MCP_SERVER_NAMES,
  isLocalMcpServer,
  chatModeFromStorageScope,
  allowsLocalCapabilities,
  deriveLocalContext,
  filterMcpServersForConversationScope,
} from "./scope";
export {
  extractTargetPaths,
  isPathWithinRoots,
  isAbsolutePath,
  normalizePath,
  resolveAgainst,
} from "./paths";
export type { WorkspaceTrustEntry, GlobalMachineGrantEntry } from "./grants";
export {
  workspaceId,
  getWorkspaceTrust,
  setWorkspaceTrust,
  hasGlobalGrant,
  setGlobalGrant,
  clearSessionGrants,
  recordGrant,
  buildGrantLookup,
  buildGrantLookupForConversation,
  listWorkspaceTrust,
  revokeWorkspaceTrust,
  listGlobalMachineGrants,
  revokeGlobalMachineGrant,
  listGlobalToolGrants,
  listWorkspaceToolGrants,
  revokeToolGrant,
  clearAllPermissions,
} from "./grants";
