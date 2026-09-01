'use agent';

import { useModel, type AgentProps } from "@flue/runtime";

import { getStudioRuntime } from "../application/studio-runtime.js";
import { STUDIO_SYSTEM_PROMPT } from "../context/system-prompt.js";
import {
  DEFAULT_MODEL_PROVIDER,
  reasoningChoiceOr,
  runThinkingLevelForChoice,
  STUDIO_MODEL_ID,
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
 * The thinking level a conversation runs with, from its settled turn settings.
 *
 * Exported beside the specifier for the same reason: the mapping is the
 * contract, and it is the one place that keeps "default" meaning "no explicit
 * effort requested" rather than letting the runtime substitute its own medium
 * for an unset level.
 */
export function studioThinkingLevel(
  settings: { readonly reasoningLevel: string | null },
): ReturnType<typeof runThinkingLevelForChoice> {
  return runThinkingLevelForChoice(reasoningChoiceOr(settings.reasoningLevel));
}

/**
 * Project Studio's local-first general agent.
 *
 * Phase 2/3 minimum (Flue 2.0 pins): this is the shape that compiles and
 * mounts so the server starts under the Rust supervisor. What the full port
 * re-lands in Phase 4, measured rather than forgotten:
 *
 * - `useSandbox(...)` with the gated factory (`createAgentSandbox` - the
 *   permission kernel, `CallGate`, native tools, the conversation workspace).
 *   Omitted here on purpose: without it the runtime's default in-memory
 *   sandbox gives the model no filesystem reach, which is the safe posture
 *   for a phase where no turn can run anyway (no provider is registered -
 *   Phase 5).
 * - `runtime.start()`, `runtime.reconcile()` and the three `ensureDirectory`
 *   calls move into the factory's `createSandbox(options)`, which runs once
 *   per submission (Phase 0's measurement) and must stay idempotent per call.
 * - The environment block appended after the static prompt.
 *
 * The static prompt first, then what varies - that order is the cache
 * argument and Phase 4 keeps it. The identity is pinned with a string
 * literal because the build derives the durable identifier statically: a
 * rename here would orphan every stored conversation, and the contract
 * constant is asserted against the literal by the unit suite.
 */
export function Studio({ id }: AgentProps) {
  const settings = getStudioRuntime().conversationTurnSettings(id);
  useModel(studioModelSpecifier(settings), {
    thinkingLevel: studioThinkingLevel(settings),
  });
  return STUDIO_SYSTEM_PROMPT;
}

/**
 * The durable identity, pinned as a literal the build can read statically
 * (the scanner refuses anything computed). The unit suite asserts this
 * literal equals `STUDIO_AGENT_ID` so the two cannot drift apart.
 */
Studio.agentName = "studio";
