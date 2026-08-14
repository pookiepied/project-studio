import { defineAgent, type AgentRouteHandler } from "@flue/runtime";

import { getStudioRuntime } from "../application/studio-runtime.js";
import { STUDIO_MODEL_ID } from "../contracts/models.js";

export const route: AgentRouteHandler = async (_context, next) => next();

export default defineAgent(async ({ id }) => {
  const runtime = getStudioRuntime();
  await runtime.start();
  await runtime.reconcile();

  return {
    description: "Project Studio's local-first general agent.",
    model: STUDIO_MODEL_ID,
    cwd: runtime.projectRoot,
    instructions: "Help the user complete work accurately.",
    sandbox: runtime.createAgentSandbox({ agentId: id }),
    durability: {
      maxAttempts: 3,
      timeoutMs: 300_000,
    },
  };
});
