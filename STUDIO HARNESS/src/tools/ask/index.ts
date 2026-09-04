import type { QuestionPayload, QuestionReport } from "../../questions/question.js";
import type { ClosingTurns } from "../../execution/closing-turns.js";
import type { CallGate } from "../gate.js";
import { createAskUserQuestionTool } from "./questions.js";

export { ASK_USER_QUESTION_DESCRIPTOR, clampTimeout } from "./questions.js";
export { ClosingTurns } from "../../execution/closing-turns.js";
export type { AskToolDependencies, AskUserQuestionReport } from "./questions.js";
export type { QuestionReport } from "../../questions/question.js";

/**
 * The ask family: the question the model puts to the person.
 *
 * A family of one, on purpose. The tool has no siblings today, and the family
 * is where a second ask-shaped capability would land - but the reason it is
 * separate from every other family is the dependency it carries: it is the
 * only native tool whose work is waiting for a person, which is why it needs
 * a channel and a closing-turn state handed in rather than built here.
 */
export interface AskToolRegistration {
  /** Parks the call until the questions settle, and returns them in order. */
  readonly ask: (
    conversationId: string,
    questions: readonly QuestionPayload[],
    timeoutMs: number | undefined,
    signal: AbortSignal | undefined,
  ) => Promise<readonly QuestionReport[] | undefined>;
  /** The per-run state the stop outcome arms. */
  readonly closing: ClosingTurns;
}

export function registerAskTools(gate: CallGate, dependencies: AskToolRegistration): void {
  gate.register(createAskUserQuestionTool({ ask: dependencies.ask, closing: dependencies.closing }));
}
