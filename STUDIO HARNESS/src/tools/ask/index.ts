import type { QuestionPayload, QuestionReport } from "../../questions/question.js";
import type { ClosingTurns } from "../../execution/closing-turns.js";
import type { CallGate } from "../gate.js";
import type { ScopeDeclines } from "../../sandbox/scope-questions.js";
import type { SandboxScopeStore } from "../../sandbox/scope-store.js";
import { createRequestFolderTool } from "./folder.js";
import { createAskUserQuestionTool } from "./questions.js";

/**
 * The ask family: the questions the model puts to the person.
 *
 * Two tools, one shape: the open question, and the folder question (ADR
 * 0057). The reason the family is separate from every other is the
 * dependency it carries: these are the native tools whose work is waiting
 * for a person, which is why they need a channel and a closing-turn state
 * handed in rather than built here. The folder question also needs the
 * scope store a yes is written to, and it is registered only when that is
 * supplied - a composition without one offers no way to ask for a folder
 * rather than a question whose yes goes nowhere.
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
  /** What the folder question needs beyond the channel. Absent, it is not offered. */
  readonly folders?: {
    readonly scopes: SandboxScopeStore;
    readonly declines: ScopeDeclines;
    readonly projectOf: (conversationId: string) => string | undefined;
  };
}

export function registerAskTools(gate: CallGate, dependencies: AskToolRegistration): void {
  gate.register(createAskUserQuestionTool({ ask: dependencies.ask, closing: dependencies.closing }));
  if (dependencies.folders !== undefined) {
    const folders = dependencies.folders;
    gate.register(createRequestFolderTool({ ask: dependencies.ask, closing: dependencies.closing, ...folders }));
  }
}
