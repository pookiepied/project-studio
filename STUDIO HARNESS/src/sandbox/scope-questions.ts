import type { QuestionAnswer, QuestionPayload } from "../questions/question.js";
import type { SandboxScopeMode } from "./scope.js";
import { normalizeScopePath } from "./scope.js";
import type { SandboxScopeStore } from "./scope-store.js";

/**
 * The refusal that becomes a question.
 *
 * When a command is refused because it needed a path outside its roots, the
 * run can put the real question to the person through `native/ask_user_question`
 * - the tool Task 55 shipped. This module builds that question and applies its
 * answer. It builds no second asking mechanism; the broker stays the channel.
 *
 * The path in the question is the resolved, normalized absolute path the
 * sandbox computed - never the raw string the model wrote. If those two
 * differ, the resolved one is the truth and the only one shown. The message
 * names the boundary rather than the attempt; the question is a different
 * surface, because the person cannot grant a path they are not shown.
 */

export const SCOPE_QUESTION_OPTIONS = {
  project: "allow-project",
  everywhere: "allow-everywhere",
  deny: "dont-allow",
} as const;

export type ScopeQuestionChoice =
  | typeof SCOPE_QUESTION_OPTIONS.project
  | typeof SCOPE_QUESTION_OPTIONS.everywhere
  | typeof SCOPE_QUESTION_OPTIONS.deny;

export interface ScopeQuestion {
  readonly payload: QuestionPayload;
  /** The resolved path the question shows, and the grant it would write. */
  readonly resolvedPath: string;
  /** The mode the grant would carry. Inferred from the refusal. */
  readonly mode: SandboxScopeMode;
}

/**
 * Builds the question for a refused path.
 *
 * `resolvedPath` is what the sandbox computed; `rawPath` is what the model
 * wrote and is never shown. `program` names the command that needed the path,
 * when it is known - `cargo` in the brief's example - so the sentence reads
 * as something that happened rather than as a path on its own.
 */
export function buildScopeQuestion(options: {
  readonly resolvedPath: string;
  readonly rawPath?: string | undefined;
  readonly program?: string | undefined;
  readonly mode?: SandboxScopeMode | undefined;
}): ScopeQuestion {
  const resolvedPath = normalizeScopePath(options.resolvedPath);
  const mode = options.mode ?? "write";
  const actor = options.program === undefined ? "A command" : options.program;
  return {
    resolvedPath,
    mode,
    payload: {
      question:
        `${actor} needs to ${mode === "write" ? "write" : "read"} ${resolvedPath}, ` +
        `which is outside this project.`,
      header: "Sandbox",
      multiSelect: false,
      options: [
        {
          id: SCOPE_QUESTION_OPTIONS.project,
          label: "Allow it for this project",
          description: `Grants ${mode} on ${resolvedPath} for this project, and the command can be retried.`,
        },
        {
          id: SCOPE_QUESTION_OPTIONS.everywhere,
          label: "Allow it for every project",
          description: `Grants ${mode} on ${resolvedPath} everywhere, and the command can be retried.`,
        },
        {
          id: SCOPE_QUESTION_OPTIONS.deny,
          label: "Don't allow it",
          description: "Refuses the path, and this conversation will not ask about it again.",
        },
      ],
    },
  };
}

/**
 * Applies the person's answer to a scope question.
 *
 * Answering writes the scope entry and the command can be retried. Declining
 * is a real answer and is recorded, so the same question is not asked again
 * in this conversation. A deferred or stopped answer writes nothing.
 *
 * Returns the choice taken, and whether a grant was written. The retry is
 * never automatic and invisible - the caller says the command was retried,
 * because the person granted a path and the next thing they see should say so.
 */
export function applyScopeAnswer(
  store: SandboxScopeStore,
  options: {
    readonly projectId: string | undefined;
    readonly resolvedPath: string;
    readonly mode: SandboxScopeMode;
    readonly answer: QuestionAnswer | undefined;
    readonly outcome: string;
    readonly declines: ScopeDeclines;
    readonly conversationId: string;
  },
): { readonly choice: ScopeQuestionChoice | "deferred" | "stopped"; readonly granted: boolean } {
  if (options.outcome === "deferred") return { choice: "deferred", granted: false };
  if (options.outcome === "stopped" || options.outcome === "timed_out") {
    return { choice: "stopped", granted: false };
  }
  const chosen = options.answer?.optionIds?.[0];
  if (chosen === SCOPE_QUESTION_OPTIONS.project) {
    if (options.projectId === undefined || options.projectId === "") {
      store.grant({
        projectId: "",
        path: options.resolvedPath,
        mode: options.mode,
        source: "question",
      });
    } else {
      store.grant({
        projectId: options.projectId,
        path: options.resolvedPath,
        mode: options.mode,
        source: "question",
      });
    }
    return { choice: chosen, granted: true };
  }
  if (chosen === SCOPE_QUESTION_OPTIONS.everywhere) {
    store.grant({
      projectId: "",
      path: options.resolvedPath,
      mode: options.mode,
      source: "question",
    });
    return { choice: chosen, granted: true };
  }
  if (chosen === SCOPE_QUESTION_OPTIONS.deny) {
    options.declines.markDeclined(options.conversationId, options.resolvedPath);
    return { choice: chosen, granted: false };
  }
  return { choice: "deferred", granted: false };
}

/**
 * The paths one conversation has declined, so the same question is not asked
 * again in it.
 *
 * In memory, per conversation, for the life of the process. A decline is a
 * real answer but not a durable one: the next conversation asks again, which
 * is the difference between "do not nag me" and "never ask anyone again".
 */
export class ScopeDeclines {
  readonly #declined = new Map<string, Set<string>>();

  isDeclined(conversationId: string, resolvedPath: string): boolean {
    return this.#declined.get(conversationId)?.has(normalizeScopePath(resolvedPath)) === true;
  }

  markDeclined(conversationId: string, resolvedPath: string): void {
    const absolute = normalizeScopePath(resolvedPath);
    let entries = this.#declined.get(conversationId);
    if (entries === undefined) {
      entries = new Set<string>();
      this.#declined.set(conversationId, entries);
    }
    entries.add(absolute);
  }

  /** Drops one conversation's declines. What a purge calls. */
  clearConversation(conversationId: string): void {
    this.#declined.delete(conversationId);
  }
}


