export type { PermissionModeId, PermissionIconKey } from "./types";
export { getPermissionModesForEngine } from "./config";
export type { ToolRiskClass } from "./toolRisk";
export { RISK_CLASS_META } from "./toolRisk";

// -- Enforcement engine (runtime permission decisions) ----------------------
export type { ActionMode, GrantScope, ManagementKind, PermissionDecision } from "./model";
export { evaluateToolCall } from "./engine";
export {
  isLocalMcpServer,
  isSystemManagedMcpServer,
  managementKindFor,
  chatModeFromStorageScope,
  deriveLocalContext,
} from "./scope";
export { extractTargetPaths } from "./paths";
export {
  getWorkspaceTrust,
  hasGlobalGrant,
  setGlobalGrant,
  clearSessionGrants,
  recordGrant,
  buildGrantLookupForConversation,
  listWorkspaceTrust,
  revokeWorkspaceTrust,
  listGlobalMachineGrants,
  revokeGlobalMachineGrant,
  listGlobalToolGrants,
  listWorkspaceToolGrants,
  revokeToolGrant,
  hasManagementGrant,
  recordManagementGrant,
  clearAllPermissions,
} from "./grants";
