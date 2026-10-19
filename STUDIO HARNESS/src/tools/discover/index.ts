import type { CallGate } from "../gate.js";
import { createDiscoverTool, type DiscoverToolRegistration } from "./discover.js";

export type {
  DiscoverToolRegistration,
} from "./discover.js";

/**
 * The discovery family: the question of what this conversation could reach,
 * and the door it loads what it finds through.
 *
 * A family of one, beside the ask and plan families. It is alone because the
 * mechanism (ADR 0048) keeps browsing, inspection and loading in one tool,
 * and because every MCP server contributes its tools here rather than gaining
 * a discovery tool of its own;
 * a second way in would be a second permanent schema in the prefix, which is
 * the cost the mechanism exists to stop.
 */
export function registerDiscoverTools(gate: CallGate, dependencies: DiscoverToolRegistration): void {
  gate.register(createDiscoverTool(dependencies));
}
