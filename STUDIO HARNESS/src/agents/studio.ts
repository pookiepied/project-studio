import { defineAgent, type AgentRouteHandler } from "@flue/runtime";

import { getStudioRuntime } from "../application/studio-runtime.js";
import {
  conversationArtifactsDirectory,
  conversationAttachmentsDirectory,
  conversationWorkspaceDirectory,
  ensureDirectory,
} from "../platform/paths.js";
import { STUDIO_AGENT_ID } from "../contracts/agents.js";
import { environmentBlock, environmentFacts } from "../context/environment.js";
import { STUDIO_SYSTEM_PROMPT } from "../context/system-prompt.js";
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
    // The static prompt first, then what varies. The order is the cache
    // argument: a breakpoint sits after the tool array, so the tools stay
    // shared across every conversation on the machine and only this block
    // re-bills when a conversation is new or the day has turned.
    //
    // In the instructions rather than on the message, which was tried and
    // reverted: the webview renders a user message's text verbatim into the
    // person's own bubble, so a block carried there is a block they read every
    // time they speak. Paying the system block at full rate on a
    // conversation's first turn is the cheaper of the two mistakes.
    instructions: `${STUDIO_SYSTEM_PROMPT}\n${environmentBlock(
      environmentFacts(workspace, new Date()),
    )}`,
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
      /**
       * The wall-clock ceiling on one submission, which now has to allow for
       * the time a person spends deciding.
       *
       * This was five minutes, chosen when the longest thing a turn could do
       * was think and read. A turn can now stop and ask, and a question in
       * Manual parks the run until somebody answers it - which is minutes if
       * they are at the keyboard and hours if they are not.
       *
       * Measured before changing it, because the contract and the behaviour
       * disagree: Flue documents this as the wall-clock limit on one
       * submission and says a submission over it "is aborted and settled as
       * failed", but on the Node target a question left unanswered for eight
       * minutes was still in the queue, and answering it woke the run and
       * wrote the file. So five minutes was not costing anyone a turn today.
       *
       * It is still the wrong number to be carrying. It describes a patience
       * this agent does not have any more, it is a quarter of what the
       * runtime's own default would give, and the enforcement it depends on
       * not having is enforcement the runtime says it does - which is exactly
       * the kind of assumption a version upgrade turns into a bug report from
       * a user who stepped away from a question. An hour is the runtime's own
       * default and is safe here for a reason worth stating: this bound is not
       * what protects the machine from a run that misbehaves. Every tool call
       * is bounded separately and far more tightly by `CallBounds` (two
       * minutes by default, ten for `shell`), the model's own requests carry
       * their own timeouts, and a person watching has a stop control. What is
       * left for this number to cover is the one thing that legitimately takes
       * a long time: waiting for a human.
       */
      timeoutMs: 3_600_000,
    },
  };
});
