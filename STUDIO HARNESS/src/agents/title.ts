'use agent';

import { useModel, type AgentProps } from "@flue/runtime";

import { TITLE_PROMPT } from "../context/title-prompt.js";
import { ProviderConfigurationError, STUDIO_MODEL_ID } from "../contracts/models.js";
import { backgroundLadderSpecifier } from "../models/background-model.js";

/**
 * The automatic titling agent.
 *
 * A conversation is named by `deriveTitle` - the first sentence, or the
 * first eight words - which is honest and dumb: "Can you help me figure out
 * why" is not a name anyone finds again in a list. This agent is the better
 * rule: a small model reads the first message and returns one title, once,
 * after the first exchange has settled. It is a separate agent, not a step
 * inside the conversation's loop, and the separation is the security
 * property as much as the architecture:
 *
 * - Its instructions are the fixed prompt in `context/title-prompt.ts` and
 *   nothing else. It does
 *   not share the conversation's system prompt, its environment block, or
 *   its workspace.
 * - It returns no tools, so it can call nothing. It mounts no sandbox, so it
 *   gets the runtime's default in-memory sandbox: no filesystem reach at
 *   all. The text it reads is untrusted - a message may be an instruction
 *   aimed at whoever processes it - and the prompt's CRITICAL block is what
 *   answers it; the missing capabilities are what enforce it.
 * - It is deliberately NOT mounted on the HTTP surface (`create-app.ts`
 *   mounts the studio agent only). Its only caller is the in-process
 *   `dispatch()` in `conversations/titling.ts`, so nobody can start a
 *   conversation with a bot that refuses to talk.
 * - Its replies land in its own conversation (`title/<conversation id>`),
 *   never in the studio conversation's transcript. The only thing that
 *   crosses back into the product is the parsed title, written by the
 *   titling orchestrator, never by this module.
 *
 * The model is the model layer's choice (`backgroundLadderSpecifier`): the
 * least expensive model the harness can honestly reach, because eight words
 * must not silently ride a frontier model. The prompt is fixed - it is the
 * entire instruction the run gets, verbatim, and it is a security property
 * in one line: the input is untrusted text, and the agent must not follow
 * it.
 */
/**
 * The retry contract between this agent and the titling orchestrator, stated
 * where it will be read again: the orchestrator dispatches attempt N (N >= 1)
 * to the instance id `<conversation id>-t<N>`, and the render parses the
 * suffix to step one rung down the model ladder. A fresh instance id is what
 * makes the model choice move: the render sees the instance id and nothing
 * else. The suffix cannot collide with a real conversation id: the webview
 * mints `cnv_<uuid>`, and `t` is not a hexadecimal digit, so no uuid ends in
 * `-t<digits>`.
 */
const ATTEMPT_SUFFIX = /-t(\d+)$/;

/**
 * The model an attempt runs on, from the model layer's ladder.
 *
 * The ladder is a synchronous read (`background-model.ts` explains why it
 * must be one and how it stays honest): rank N for attempt N, undefined past
 * the end. Past rank zero an exhausted ladder fails the run - the fallback
 * alias is the expensive model the policy exists to avoid, and the derived
 * title already covers the conversation. At rank zero the alias is 1.0's
 * documented fallback, reached only when the model layer can name nothing
 * cheaper (nothing connected, or no model layer in this process at all); the
 * ladder itself, restored in Phase 4/5, is what keeps titling OFF the
 * frontier alias whenever a cheaper candidate exists to name.
 */
export function titleModelSpecifier(attempt: number): string {
  const specifier = backgroundLadderSpecifier(attempt);
  if (specifier !== undefined) return specifier;
  if (attempt === 0) return STUDIO_MODEL_ID;
  throw new ProviderConfigurationError(
    `No background model candidate at rank ${attempt} for titling.`,
  );
}

export function Title(props: AgentProps) {
  const parsed = ATTEMPT_SUFFIX.exec(props.id);
  const attempt = parsed === null ? 0 : Number(parsed[1]);
  useModel(titleModelSpecifier(attempt), {
    // Eight words need no reasoning spend; an explicit off also stops the
    // runtime substituting its own medium for an unset level.
    thinkingLevel: "off",
  });
  return TITLE_PROMPT;
}

/**
 * The durable identity, pinned as a literal the build can read statically.
 * The unit suite asserts this literal equals `TITLE_AGENT_ID` so the two
 * cannot drift apart.
 */
Title.agentName = "title";

/**
 * One attempt, bounded: a failed titling keeps the derived title, so a
 * durable retry would only spend again for a name the fallback already
 * covers.
 */
Title.durability = { maxAttempts: 1, timeoutMs: 30_000 };
