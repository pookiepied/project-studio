'use agent';

import { useModel, type AgentProps } from "@flue/runtime";

import { DESCRIBE_PROMPT } from "../context/describe-prompt.js";
import { STUDIO_MODEL_ID } from "../contracts/models.js";
import { describeDefinition } from "./definitions/describe.js";

/**
 * The image-describing agent, for the library.
 *
 * When the person keeps a picture, the library dialog offers a title, a
 * description and tags so the picture can be found again. This agent
 * writes that offer, in the shape of the improve agent and for the same
 * reasons:
 *
 * - Its instructions are the fixed prompt in `context/describe-prompt.ts`
 *   and nothing else: no system prompt, no environment block, no
 *   workspace. The picture and any words beside it are untrusted.
 * - It returns no tools and mounts no sandbox, so it can call nothing and
 *   reach no file.
 * - It is not mounted on the HTTP surface. Its only caller is the
 *   in-process `dispatch()` in `library/describer.ts`, which waits for the
 *   one reply and hands the parsed proposal back to the route that asked.
 * - Its replies land in its own stream (`agents/describe/<take id>`), never
 *   in any conversation's transcript.
 *
 * The model is the person's default model, so the picture goes nowhere it
 * would not go in an ordinary message. A default model that cannot see
 * pictures fails the run, and the dialog says the proposal could not be
 * made; the person fills the fields themselves. Reasoning is off - this is
 * a caption, not a problem.
 */
export function Describe(_props: AgentProps) {
  useModel(STUDIO_MODEL_ID, { thinkingLevel: "off" });
  return DESCRIBE_PROMPT;
}

/** The durable identity, asserted equal to `DESCRIBE_AGENT_ID` by the unit suite. */
Describe.agentName = "describe";

/**
 * One attempt: a picture that could not be described is labelled by hand.
 * The numbers live in `agents/definitions/describe.ts` and are read from
 * there, so the registry and the runtime cannot disagree.
 */
Describe.durability = describeDefinition.durability;
