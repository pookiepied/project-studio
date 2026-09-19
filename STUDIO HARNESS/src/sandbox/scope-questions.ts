import type { QuestionAnswer, QuestionPayload } from "../questions/question.js";
import type { SandboxScopeMode } from "./scope.js";
import { normalizeScopePath } from "./scope.js";
import type { SandboxScopeStore } from "./scope-store.js";

/**
 * The refusal that becomes a question.
 *
 * When the work needs a path outside the roots a conversation may reach, the
 * run puts the real question to the person through the question broker - the
 * channel `native/ask_user_question` uses. This module builds that question
 * and applies its answer. It builds no second asking mechanism.
 *
 * Since ADR 0057 the asking is the model's to do, through
 * `native/request_folder`: the gate is the boundary, a grant is a cheap
 * stored rule, and a model that needs the person's Downloads folder asks for
 * it in so many words rather than reaching, being refused, and reporting the
 * refusal. The question is the same one either way.
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
 * Builds the question for a path outside the roots.
 *
 * `resolvedPath` is what the sandbox computed; `rawPath` is what the model
 * wrote and is never shown. `program` names the command that needed the path,
 * when it is known - `cargo` in the brief's example - so the sentence reads
 * as something that happened rather than as a path on its own. `reason` is
 * the model's own sentence about why, when it asked up front through
 * `request_folder`; it is shown after the question so the person decides on
 * the stated purpose and not on a bare path.
 *
 * `hasProject` decides the options. With a project there are two ways to say
 * yes - this project, or everywhere - and they write different rows. With no
 * project both would write the machine-wide row, so a conversation with no
 * project is offered one yes and told what it means.
 */
export function buildScopeQuestion(options: {
  readonly resolvedPath: string;
  readonly rawPath?: string | undefined;
  readonly program?: string | undefined;
  readonly reason?: string | undefined;
  readonly mode?: SandboxScopeMode | undefined;
  readonly hasProject?: boolean | undefined;
}): ScopeQuestion {
  const resolvedPath = normalizeScopePath(options.resolvedPath);
  const mode = options.mode ?? "write";
  const hasProject = options.hasProject ?? true;
  const actor = options.program === undefined ? "The model" : options.program;
  const verb = mode === "write" ? "write" : "read";
  const boundary = hasProject ? "outside this project" : "outside this conversation's folders";
  const reason =
    options.reason === undefined || options.reason.trim() === "" ? "" : ` ${options.reason.trim()}`;
  const retry = "and the work can carry on";
  return {
    resolvedPath,
    mode,
    payload: {
      question: `${actor} needs to ${verb} ${resolvedPath}, which is ${boundary}.${reason}`,
      header: "Folder",
      multiSelect: false,
      options: [
        ...(hasProject
          ? [
              {
                id: SCOPE_QUESTION_OPTIONS.project,
                label: "Allow it for this project",
                description: `Grants ${mode} on ${resolvedPath} for this project, ${retry}.`,
              },
              {
                id: SCOPE_QUESTION_OPTIONS.everywhere,
                label: "Allow it for every project",
                description: `Grants ${mode} on ${resolvedPath} everywhere, ${retry}.`,
              },
            ]
          : [
              {
                id: SCOPE_QUESTION_OPTIONS.everywhere,
                label: "Allow it",
                description:
                  `Grants ${mode} on ${resolvedPath} machine-wide - every project and every ` +
                  `conversation with no project - ${retry}.`,
              },
            ]),
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


