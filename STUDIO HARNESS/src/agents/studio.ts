import { defineAgent, type AgentRouteHandler } from "@flue/runtime";

import { getStudioRuntime } from "../application/studio-runtime.js";
import {
  conversationArtifactsDirectory,
  conversationAttachmentsDirectory,
  conversationWorkspaceDirectory,
  ensureDirectory,
} from "../platform/paths.js";
import { STUDIO_AGENT_ID } from "../contracts/agents.js";
import {
  DEFAULT_MODEL_PROVIDER,
  reasoningChoiceOr,
  runThinkingLevelForChoice,
  STUDIO_MODEL_ID,
} from "../contracts/models.js";

export const route: AgentRouteHandler = async (_context, next) => next();

/**
 * Why every root argument below is passed instead of inherited.
 *
 * A normal conversation has no project, and a projectless turn needs somewhere
 * to stand that is not somebody else's working directory. This module used to
 * pass neither `projectRoot` nor `projectId`, so `createAgentSandbox` fell back
 * to the runtime default — the harness process's own cwd, which under the
 * desktop host is the Tauri build directory — and `cwd` was `runtime.projectRoot`,
 * the same place. Every read that `defaultVerdict` allows without a grant (a
 * studio-authored read-only capability) therefore reached whatever source tree
 * surrounded the process.
 *
 * Now each conversation gets a directory of its own under the Studio home:
 * `workspace/` is the sandbox root and starts empty, so what a default-allowed
 * read can see is exactly what this conversation owns. `attachments/` and
 * `artifacts/` are siblings on purpose — nothing inside them is the model's to
 * browse by default.
 *
 * This first-run initializer is also where the tree is created. Admission of
 * the first prompt is when a conversation comes into existence; a send the
 * harness refuses never reaches here and creates nothing. Flue re-runs an
 * initializer for every run, which recursive directory creation absorbs.
 *
 * A conversation belonging to a project will resolve its roots from the project
 * store here rather than take this tree. The shape is ready for that:
 * `createAgentSandbox` already accepts both arguments per call.
 *
 * ---- Where the model comes from -------------------------------------------
 *
 * The model and reasoning level a person picked are read from the conversation
 * index, once per run, right here. A submission cannot carry them: Flue parses
 * the payload down to `message` and images, and this initializer receives only
 * `{ id }` - so the durable row, settled by the turn-settings middleware before
 * the run was admitted, is the only channel that exists. The reference is in
 * the local runtime's own `<provider>/<model>` vocabulary; prefixed with the
 * studio provider it becomes the specifier Flue resolves, whose id the local
 * adapter parses back out to route the request at the named model.
 *
 * An unset model stays the stable alias, which routes to the harness's own
 * default. A run already in flight keeps the model its initializer resolved;
 * a change takes effect from the next run.
 */
export default defineAgent(async ({ id }) => {
  const runtime = getStudioRuntime();
  await runtime.start();
  await runtime.reconcile();

  ensureDirectory(conversationWorkspaceDirectory(id));
  ensureDirectory(conversationAttachmentsDirectory(id));
  ensureDirectory(conversationArtifactsDirectory(id));
  const workspace = conversationWorkspaceDirectory(id);

  const settings = runtime.conversationTurnSettings(id);
  const model =
    settings.modelId === null
      ? STUDIO_MODEL_ID
      : `${DEFAULT_MODEL_PROVIDER}/${settings.modelId}`;
  // "default" and an unset level both mean the provider's own behaviour; the
  // mapping turns them into the run's "no explicit effort" rather than letting
  // a substitute decide the level for the person who did not choose one.
  const thinkingLevel = runThinkingLevelForChoice(
    reasoningChoiceOr(settings.reasoningLevel),
  );

  return {
    description: "Project Studio's local-first general agent.",
    model,
    thinkingLevel,
    cwd: workspace,
    instructions: "Help the user complete work accurately.",
    // `id` is the agent *instance* — one per conversation thread, measured
    // rather than assumed — so it is the conversation, and the agent is named
    // separately. Feeding it to `agentId` was #69.
    sandbox: runtime.createAgentSandbox({
      agentId: STUDIO_AGENT_ID,
      conversationId: `conversation:${id}`,
      // Per conversation, always. Passing these explicitly is the whole reason
      // this conversation cannot read the host's build directory by default;
      // a project conversation overrides them from its project record later.
      projectRoot: workspace,
    }),
    durability: {
      maxAttempts: 3,
      timeoutMs: 300_000,
    },
  };
});
