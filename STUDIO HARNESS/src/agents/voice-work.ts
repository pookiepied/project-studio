'use agent';

import type { AgentProps } from "@flue/runtime";
import { getStudioRuntime } from "../application/studio-runtime.js";
import { ProviderConfigurationError } from "../contracts/models.js";
import { renderStudio } from "./studio.js";
import { voiceWorkDefinition } from "./definitions/voice-work.js";

export function VoiceWork({ id }: AgentProps) {
  const parent = getStudioRuntime().voiceWorkParent?.(id);
  if (parent === undefined) throw new ProviderConfigurationError("This voice task has no admitted conversation.");
  return renderStudio(parent, "voice-work");
}

VoiceWork.agentName = "voice-work";
VoiceWork.durability = voiceWorkDefinition.durability;
