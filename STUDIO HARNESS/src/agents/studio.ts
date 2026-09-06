'use agent';

import { useModel, useSandbox, type AgentProps } from "@flue/runtime";

import { getStudioRuntime } from "../application/studio-runtime.js";
import { STUDIO_AGENT_ID } from "../contracts/agents.js";
import { conversationWorkspaceDirectory } from "../platform/paths.js";
import { environmentBlock, environmentFacts } from "../context/environment.js";
import { STUDIO_SYSTEM_PROMPT } from "../context/system-prompt.js";
import {
  DEFAULT_MODEL_PROVIDER,
  reasoningChoiceOr,
  runThinkingLevelForChoice,
  STUDIO_MODEL_ID,
  type ReasoningLevel,
} from "../contracts/models.js";

/**
 * The model specifier a conversation runs on, from its settled turn settings.
 *
 * The settings row is settled by the turn-settings middleware before the
 * submission is admitted, so the render can read it synchronously - the
 * measured ordering (Phase 0) is render first, sandbox factory later, and the
 * row never depends on anything the factory does. `modelId` is stored in the
 * local runtime's own `<provider>/<model>` vocabulary; the stable alias when
 * the person has not picked anything, which the model layer resolves to
 * whatever default is configured.
 *
 * Exported for tests: the mapping is the contract between the conversation
 * index and the run, and asserting it keeps the picker's choice riding the
 * request rather than a default deciding for the person.
 */
export function studioModelSpecifier(settings: {
  readonly modelId: string | null;
}): string {
  return settings.modelId === null
    ? STUDIO_MODEL_ID
    : `${DEFAULT_MODEL_PROVIDER}/${settings.modelId}`;
}

/**
 * The thinking level a conversation runs with, from its settled turn settings
 * and the model's supported levels.
 *
 * Exported beside the specifier for the same reason: the mapping is the
 * contract, and it is the one place that keeps a stored "default" resting on
 * medium rather than on silence. The supported levels come from the local
 * runtime's synchronous lookup, which the render reads beside the settings;
 * the resolver then answers medium for a model that has it, the nearest level
 * otherwise, and "off" only for a model that does not reason.
 */
export function studioThinkingLevel(
  settings: { readonly modelId: string | null; readonly reasoningLevel: string | null },
  supported: readonly ReasoningLevel[],
): ReturnType<typeof runThinkingLevelForChoice> {
  return runThinkingLevelForChoice(reasoningChoiceOr(settings.reasoningLevel), supported);
}

/**
 * Why every root argument the sandbox factory receives is passed instead of
 * inherited.
 *
 * A normal conversation has no project, and a projectless turn needs somewhere
 * to stand that is not somebody else's working directory. Passing neither
 * `projectRoot` nor a conversation workspace would drop the sandbox onto the
 * runtime default - the harness process's own cwd, which under the desktop
 * host is the Tauri build directory - and every read that `defaultVerdict`
 * allows without a grant (a studio-authored read-only capability) would
 * reach whatever source tree surrounds the process.
 *
 * So each conversation stands in a directory of its own under the Studio
 * home: `workspace/` is the sandbox root and starts empty, so what a
 * default-allowed read can see is exactly what this conversation owns.
 * `attachments/` and `artifacts/` are siblings on purpose - nothing inside
 * them is the model's to browse by default. The directories themselves are
 * created by the factory's `createSandbox` (Phase 0's measured ordering:
 * the render runs first, the factory once per submission), which is also
 * what makes the tree's existence the consequence of an admitted
 * submission: a send the harness refuses never reaches a render, and
 * creates nothing.
 *
 * A conversation belonging to a project with folders stands in the project's
 * first folder rather than this tree, and the project's other folders join
 * the sandbox's roots in `createAgentSandbox`; both render and factory read
 * the folders from the host's `conversationProjectFolders`, so one run cannot
 * disagree with itself about where it is.
 *
 * ---- Where the model comes from -------------------------------------------
 *
 * The model and reasoning level a person picked are read from the conversation
 * index, once per render, from the settled row. A submission cannot carry
 * them: Flue parses the payload down to `message` and images, and this render
 * receives only `{ id }` - so the durable row, settled by the turn-settings
 * middleware before the submission was admitted, is the only channel that
 * exists. The reference is in the local runtime's own `<provider>/<model>`
 * vocabulary; prefixed with the studio provider it becomes the specifier
 * Flue resolves, which the local adapter routes at the named model.
 *
 * An unset model stays the stable alias, which routes to the harness's own
 * default. Values are submission-scoped: a run already in flight keeps the
 * model its submission started with; a change takes effect from the next
 * one.
 *
 * ---- The static prompt first, then what varies ----------------------------
 *
 * The order is the cache argument: the static prompt is byte-identical for
 * every conversation so that it and the tool array form one cached prefix,
 * and only the environment block re-bills when a conversation is new or the
 * day has turned. Carrying the block on the submission instead of the
 * instructions was tried and reverted: the webview renders a user message's
 * text verbatim into the person's own bubble, so a block delivered that way
 * is a block they read every time they speak. Paying the system block at
 * full rate on a conversation's first turn is the cheaper of the two
 * mistakes.
 */
export function Studio({ id }: AgentProps) {
  const runtime = getStudioRuntime();
  const settings = runtime.conversationTurnSettings(id);
  const supported = runtime.supportedReasoningLevels(settings.modelId);
  useModel(studioModelSpecifier(settings), {
    thinkingLevel: studioThinkingLevel(settings, supported),
  });
  // The project's folders, in the order the person arranged them. The first
  // is where a turn stands; the rest reach the model as roots beside it. An
  // empty list - no project, or a project that is only a label - leaves the
  // conversation standing in the tree of its own.
  const folders = runtime.conversationProjectFolders?.(id) ?? [];
  const workspace = folders[0] ?? conversationWorkspaceDirectory(id);
  useSandbox(
    runtime.createAgentSandbox({
      // `id` is the agent *instance* - one per conversation thread, measured
      // rather than assumed - so under Flue 2.0 it IS the conversation id,
      // and the agent is named separately. Feeding it to `agentId` was #69.
      agentId: STUDIO_AGENT_ID,
      conversationId: id,
      // Per conversation, always. Passing these explicitly is the whole
      // reason this conversation cannot read the host's build directory by
      // default; a project conversation's root comes from its project record
      // instead of this tree.
      projectRoot: workspace,
    }),
  );
  // Derived by comparing the two, not assumed from which branch built the
  // path. They are equal for a conversation with no project, and for a
  // project with no folders, and that reports "conversation", which is the
  // truth for both. A project with folders stands in its first folder, and
  // the comparison answers "project" on its own, with nothing here to
  // remember to change.
  const kind = workspace === conversationWorkspaceDirectory(id) ? "conversation" : "project";
  const extraRoots = runtime.conversationExtraRoots?.(id) ?? [];
  return `${STUDIO_SYSTEM_PROMPT}\n${environmentBlock(
    environmentFacts(
      workspace,
      new Date(),
      kind,
      extraRoots.length === 0 ? undefined : extraRoots,
      folders.length === 0 ? undefined : folders,
    ),
  )}`;
}

/**
 * The durable identity, pinned as a literal the build can read statically
 * (the scanner refuses anything computed). The unit suite asserts this
 * literal equals `STUDIO_AGENT_ID` so the two cannot drift apart.
 */
Studio.agentName = "studio";

/**
 * The wall-clock ceiling on one submission, which has to allow for the time
 * a person spends deciding.
 *
 * This was five minutes, chosen when the longest thing a turn could do was
 * think and read. A turn can now stop and ask, and a question in Manual
 * parks the run until somebody answers it - which is minutes if they are at
 * the keyboard and hours if they are not.
 *
 * Measured before settling on it, because the contract and the behaviour
 * disagreed: Flue documents this as the wall-clock limit on one submission
 * and says a submission over it "is aborted and settled as failed", but a
 * question left unanswered for eight minutes stayed parked and answering it
 * woke the run. It is still the right number to carry deliberately rather
 * than inherit silently: this bound is not what protects the machine from a
 * run that misbehaves. Every tool call is bounded separately and far more
 * tightly by `CallBounds` (two minutes by default, ten for `shell`), the
 * model's own requests carry their own timeouts, and a person watching has
 * a stop control. What is left for this number to cover is the one thing
 * that legitimately takes a long time: waiting for a human.
 */
Studio.durability = { maxAttempts: 3, timeoutMs: 3_600_000 };
