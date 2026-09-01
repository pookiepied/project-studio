'use agent';

import { useModel, type AgentProps } from "@flue/runtime";

import { TITLE_PROMPT } from "../context/title-prompt.js";
import { STUDIO_MODEL_ID } from "../contracts/models.js";

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
 * The model is supposed to be the model layer's choice - the least expensive
 * model the harness can honestly reach, because eight words must not
 * silently ride a frontier model. Phase 2/3 state (Flue 2.0 pins): the
 * ladder is DOWN. The old initializer resolved `backgroundModelSpecifier`
 * asynchronously, and a 2.0 agent function must be synchronous, so for now
 * every run uses the stable alias and the retry ladder below is out of
 * reach. The orchestrator's retry contract (attempt N dispatched to a
 * `<conversation id>-t<N>` instance id) survives unchanged; restoring the
 * ladder - a synchronous read of the model layer's cheapest reachable model
 * - is Phase 4/5 work and must land before titling goes back into service.
 */
/**
 * The retry contract between this agent and the titling orchestrator, stated
 * where it will be read again: the orchestrator dispatches attempt N (N >= 1)
 * to the instance id `<conversation id>-t<N>`, and the agent-side half - the
 * render parsing the suffix to step down the ladder - returns together with
 * the ladder itself (Phase 4/5). With the ladder down both attempts run the
 * same model; the orchestrator's one-bounded-second-chance behaviour is
 * unchanged.
 */
export function Title(_props: AgentProps) {
  useModel(STUDIO_MODEL_ID, {
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
