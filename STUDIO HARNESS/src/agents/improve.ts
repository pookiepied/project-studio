'use agent';

import { useModel, type AgentProps } from "@flue/runtime";

import { IMPROVE_PROMPT } from "../context/improve-prompt.js";
import { STUDIO_MODEL_ID } from "../contracts/models.js";

/**
 * The dictation-improving agent.
 *
 * After a dictated take, the composer offers to tidy what was said: fix the
 * punctuation, drop the fillers, keep the words. This is that pass, in the
 * shape of the title agent and for the same reasons:
 *
 * - Its instructions are the fixed prompt in `context/improve-prompt.ts`
 *   and nothing else - no system prompt, no environment block, no
 *   workspace. The text it reads is untrusted; the prompt's CRITICAL block
 *   answers an instruction hidden in it, and the missing capabilities are
 *   what enforce that.
 * - It returns no tools and mounts no sandbox, so it can call nothing and
 *   reach no file.
 * - It is not mounted on the HTTP surface. Its only caller is the in-process
 *   `dispatch()` in `application/text-improver.ts`, which waits for the one
 *   reply and hands the tidied text back to the route that asked.
 * - Its replies land in its own stream (`agents/improve/<take id>`), never in
 *   any conversation's transcript.
 *
 * The model is the person's default text model, by the plan's decision:
 * the same words come back in the voice of the model they would be sent
 * to. Reasoning is off - this is punctuation, not a problem.
 */
export function Improve(_props: AgentProps) {
  useModel(STUDIO_MODEL_ID, { thinkingLevel: "off" });
  return IMPROVE_PROMPT;
}

/** The durable identity, asserted equal to `IMPROVE_AGENT_ID` by the unit suite. */
Improve.agentName = "improve";

/** One attempt: a take that could not be tidied stays as it was said. */
Improve.durability = { maxAttempts: 1, timeoutMs: 30_000 };
