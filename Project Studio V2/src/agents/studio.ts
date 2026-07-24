import { defineAgent, type AgentRouteHandler } from "@flue/runtime";

import { STUDIO_MODEL_ID } from "../contracts/models.js";
import { workspaceSummary } from "../tools/workspace-summary.js";

export const route: AgentRouteHandler = async (_context, next) => next();

export default defineAgent(() => ({
  description: "Project Studio's local-first general agent.",
  model: STUDIO_MODEL_ID,
  instructions:
    "Help the user complete work accurately. Use workspace_summary when the user asks about a workspace.",
  tools: [workspaceSummary],
  durability: {
    maxAttempts: 3,
    timeoutMs: 300_000,
  },
}));
