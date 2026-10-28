'use agent';

import type { AgentProps } from "@flue/runtime";
import { getStudioRuntime } from "../application/studio-runtime.js";
import { ProviderConfigurationError } from "../contracts/models.js";
import { renderStudio, useTaskCoordination } from "./studio.js";
import { voiceWorkDefinition } from "./definitions/voice-work.js";

export function VoiceWork({ id }: AgentProps) {
  const runtime = getStudioRuntime();
  const parent = runtime.voiceWorkParent?.(id);
  if (parent === undefined) throw new ProviderConfigurationError("This voice task has no admitted conversation.");
  // A worker is a parent too: it reads its own delegates' steps the way the
  // conversation reads its tasks, and steers nobody.
  useTaskCoordination(parent, "worker");
  // The person's voice-task model, when they chose one; otherwise the chat's
  // own, as before (D9). Read per render, so a change applies to the next
  // step rather than waiting for the next task.
  return renderStudio(parent, "voice-work", runtime.voiceTaskModel?.() ?? undefined);
}

VoiceWork.agentName = "voice-work";
VoiceWork.durability = voiceWorkDefinition.durability;
