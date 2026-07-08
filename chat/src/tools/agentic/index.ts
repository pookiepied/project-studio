export {
  EXPAND_TOOLS_DEFINITION,
  parseExpandArgs,
  getExpandCountSinceLastUser,
  filterToScope,
  applyExpandFilter,
  KNOWN_EXPAND_MODES,
} from "./expandTools";
export type { ExpandFilter } from "./expandTools";

// Agent coordination primitives — spawn, await, cancel, blackboard
export { spawnAgentTool, AGENT_TYPES, resolveAgentName } from "./spawnAgent";
export { awaitAgentsTool }                               from "./awaitAgents";
export { cancelAgentTool }                               from "./cancelAgent";
export { writeToBlackboardTool, readFromBlackboardTool } from "./blackboard";

import { spawnAgentTool }                               from "./spawnAgent";
import { awaitAgentsTool }                              from "./awaitAgents";
import { cancelAgentTool }                              from "./cancelAgent";
import { writeToBlackboardTool, readFromBlackboardTool } from "./blackboard";

export const studioAgentsTools = [
  spawnAgentTool,
  awaitAgentsTool,
  cancelAgentTool,
  writeToBlackboardTool,
  readFromBlackboardTool,
] as const;
