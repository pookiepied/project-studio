import { STUDIO_AGENT_ID } from "../../contracts/agents.js";
import { STUDIO_SYSTEM_PROMPT } from "../../context/system-prompt.js";
import { validateAgentDefinition } from "./registry.js";

/**
 * The conversation agent's definition.
 *
 * The richest definition in the registry, and the one that says the least:
 * `studio`'s tools, skills and permissions are all per-conversation live
 * state — the adopted MCP keys, the selection chain, the settled mode — so
 * the record carries only identity, kind, prompt and durability. The render
 * in `agents/studio.ts` remains the single composition of what a
 * conversation can do (Stage 2's gate: zero behavior change; the definition
 * names what the render is, it does not move any of it).
 *
 * `model` is `inherit` in the record's vocabulary and "the settled turn
 * settings" in the render's: the conversation *is* the thing being inherited
 * from, and no pinned specifier exists to name.
 */
export const studioDefinition = validateAgentDefinition({
  identity: {
    agentName: STUDIO_AGENT_ID,
    title: "Studio",
    description: "The continuing product agent: the conversation the person is having.",
  },
  kind: "conversation",
  // The prompt is composed per render — static body plus environment block
  // plus capability inventory — so the record carries the static part only,
  // and the render (agents/studio.ts) stays the single composition.
  instructions: STUDIO_SYSTEM_PROMPT,
  model: { inherit: true },
  durability: { maxAttempts: 3, timeoutMs: 3_600_000 },
});
