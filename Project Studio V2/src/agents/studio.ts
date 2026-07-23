import { defineAgent, type AgentRouteHandler } from "@flue/runtime";

import "../models/deterministic-provider.js";
import { workspaceSummary } from "../tools/workspace-summary.js";

export const route: AgentRouteHandler = async (_context, next) => next();

export default defineAgent(() => ({
  description: "Project Studio's local-first general agent.",
  model: "project-studio-test/deterministic",
  instructions:
    "Help the user complete work accurately. Use workspace_summary when the user asks about a workspace.",
  tools: [workspaceSummary],
  durability: {
    maxAttempts: 3,
    timeoutMs: 300_000,
  },
}));
