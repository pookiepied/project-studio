import { validateAgentDefinition } from "./registry.js";
import { STUDIO_SYSTEM_PROMPT } from "../../context/system-prompt.js";

export const voiceWorkDefinition = validateAgentDefinition({
  identity: {
    agentName: "voice-work",
    title: "Voice task",
    description: "Work requested in voice, on the conversation's selected model.",
  },
  kind: "worker",
  instructions: STUDIO_SYSTEM_PROMPT,
  model: { inherit: true },
  // A lost dispatch or interrupted effect is never automatically repeated.
  durability: { maxAttempts: 1, timeoutMs: 3_600_000 },
});
