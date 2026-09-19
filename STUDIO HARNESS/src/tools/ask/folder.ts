import { existsSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";

import {
  NATIVE_PROVENANCE,
  type CapabilityDescriptor,
} from "../../contracts/capabilities.js";
import type { ClosingTurns } from "../../execution/closing-turns.js";
import type { QuestionPayload, QuestionReport } from "../../questions/question.js";
import { SandboxError } from "../../sandbox/errors.js";
import { normalizeScopePath, systemScopeRefusal, type SandboxScopeMode } from "../../sandbox/scope.js";
import {
  applyScopeAnswer,
  buildScopeQuestion,
  SCOPE_QUESTION_OPTIONS,
  type ScopeDeclines,
} from "../../sandbox/scope-questions.js";
import type { SandboxScopeStore } from "../../sandbox/scope-store.js";
import { ToolError } from "../errors.js";
import { defineStudioTool, type ToolDefinition } from "../types.js";

/**
 * The folder the model asks for.
 *
 * The gate is the boundary (ADR 0057), and what a conversation's file tools
 * may reach is the project plus what the person granted. Before this tool,
 * a path outside that was a refusal with a sentence pointing at Settings:
 * the model reported it, the person went and found the page, and the work
 * waited. That is the right shape for a reach the model stumbled into. It
 * is the wrong shape for the one it knew it needed - "download this model"
 * wants the Downloads folder, and the honest move is to ask for it in so
 * many words before touching it.
 *
 * So this is a question, not a grant. The model names the folder, what it
 * wants to do there, and why; the person sees exactly that and answers; a
 * yes is the same stored rule Settings would write, applied to this run as
 * well, and a no is remembered for the rest of the conversation so the
 * same folder is not asked about twice. Nothing here can widen reach
 * without a person choosing to.
 *
 * Like `ask_user_question` it declares `read` and nothing else: asking
 * observes a person's intent and changes no state until they answer, and a
 * tool that asks a question must not itself raise an approval, or the
 * question needs permission to be put. In Auto mode too - Auto answers the
 * gate's default asks; a question to the person is not one of those.
 */

/** A folder question is a question, so the same park as `ask_user_question`. */
const DEADLINE_MS = 3_600_000;

const MAX_REASON_LENGTH = 300;

export const REQUEST_FOLDER_DESCRIPTOR: CapabilityDescriptor = {
  id: { namespace: "native", name: "request_folder" },
  title: "Ask for a folder",
  description:
    "Asks the person for access to a folder outside what you can reach, and waits for their " +
    "answer. Use it before touching a folder you know is outside your working directory and " +
    "the roots you were given - their Downloads folder, another project, a data directory. " +
    "Name the folder as an absolute path, say whether you need to read or write in it, and " +
    "give one plain sentence saying what for; the person sees exactly that. If they say " +
    "yes the folder is reachable at once and stays reachable in later conversations. If " +
    "they say no, do the work another way or say what you cannot do; do not ask for the " +
    "same folder again. A volume root or the system directory cannot be asked for.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", minLength: 1 },
      mode: { type: "string", enum: ["read", "write"] },
      reason: { type: "string", minLength: 1, maxLength: MAX_REASON_LENGTH },
    },
    required: ["path", "mode", "reason"],
    additionalProperties: false,
  },
  effects: ["read"],
  provenance: NATIVE_PROVENANCE,
  idempotent: false,
};

export interface RequestFolderInput {
  readonly path: string;
  readonly mode: SandboxScopeMode;
  readonly reason: string;
}

/** What the tool says back: one sentence the model can act on. */
export interface RequestFolderReport {
  readonly path: string;
  readonly outcome: "granted" | "already-reachable" | "declined" | "unanswered" | "stopped";
  readonly message: string;
  /** What the person wrote, when they answered in their own words. */
  readonly text?: string;
  /** Present only when the person stopped the run. */
  readonly closing?: string;
}

export interface RequestFolderDependencies {
  readonly ask: (
    conversationId: string,
    questions: readonly QuestionPayload[],
    timeoutMs: number | undefined,
    signal: AbortSignal | undefined,
  ) => Promise<readonly QuestionReport[] | undefined>;
  readonly closing: ClosingTurns;
  /** Where a yes is written, so the next run reads it too. */
  readonly scopes: SandboxScopeStore;
  /** Where a no is remembered for the rest of the conversation. */
  readonly declines: ScopeDeclines;
  /**
   * The project one conversation is filed under, or undefined for none.
   *
   * Asked here rather than read from the execution scope, whose project id
   * is always filled in - a conversation with no project carries a key
   * derived from its own folder there, which is the right identity for a
   * permission rule and the wrong answer to "is there a project to grant
   * this folder to".
   */
  readonly projectOf: (conversationId: string) => string | undefined;
}

export function createRequestFolderTool(
  dependencies: RequestFolderDependencies,
): ToolDefinition<RequestFolderInput, RequestFolderReport> {
  return defineStudioTool({
    descriptor: REQUEST_FOLDER_DESCRIPTOR,
    resourceKind: "path",
    // The path is outside the sandbox by definition, so it cannot be resolved
    // through it here the way a file tool's would be. Matched as the absolute
    // path the model wrote, normalized, which is what a rule about this tool
    // would name.
    resource: (input) => input.path,
    deadlineMs: DEADLINE_MS,

    parse: (input): RequestFolderInput => {
      const value = (input ?? {}) as Record<string, unknown>;

      const path = value["path"];
      if (typeof path !== "string" || path.trim() === "") {
        throw new ToolError("invalid_input", {
          message: "path is required: the absolute path of the folder you need.",
        });
      }
      if (!isAbsolute(path.trim())) {
        throw new ToolError("invalid_input", {
          message: `path must be absolute (${path.trim()}). Name the folder as the machine knows it.`,
        });
      }

      const mode = value["mode"];
      if (mode !== "read" && mode !== "write") {
        throw new ToolError("invalid_input", {
          message: 'mode is required: "read" or "write".',
        });
      }

      const reason = value["reason"];
      if (typeof reason !== "string" || reason.trim() === "") {
        throw new ToolError("invalid_input", {
          message: "reason is required: one sentence saying what you need the folder for.",
        });
      }
      if (reason.length > MAX_REASON_LENGTH) {
        throw new ToolError("invalid_input", {
          message: `reason is too long: at most ${MAX_REASON_LENGTH} characters.`,
        });
      }

      return { path: normalizeScopePath(path.trim()), mode, reason: reason.trim() };
    },

    execute: async (input, context) => {
      const conversationId = context.scope.conversationId;
      const path = input.path;

      // Already in reach, in the mode asked for: nothing to ask. Answered
      // before the person is bothered, and answered from the sandbox rather
      // than the store, because the sandbox knows about the workspace and
      // the other folders too.
      if (reachable(context.sandbox, path, input.mode)) {
        return {
          path,
          outcome: "already-reachable",
          message: `${path} is already within reach for ${input.mode}. Use it.`,
        };
      }

      // The end of containment is not a folder, and the person who wants
      // that has a control for it. Same rule the Settings page applies, so
      // the two never disagree about what a grant may name.
      const refusal = systemScopeRefusal(path);
      if (refusal !== undefined) {
        throw new ToolError("invalid_input", { message: refusal });
      }

      if (!existsSync(path)) {
        throw new ToolError("invalid_input", {
          message: `${path} does not exist. A folder request names a folder that is there.`,
        });
      }
      if (!isDirectory(path)) {
        throw new ToolError("invalid_input", {
          message: `${path} is a file. Ask for the folder that holds it.`,
        });
      }

      if (dependencies.declines.isDeclined(conversationId, path)) {
        return {
          path,
          outcome: "declined",
          message:
            `The person already declined ${path} in this conversation. Do the work ` +
            "another way, or say what you cannot do without it.",
        };
      }

      const projectId = dependencies.projectOf(conversationId);
      const question = buildScopeQuestion({
        resolvedPath: path,
        mode: input.mode,
        reason: input.reason,
        hasProject: projectId !== undefined,
      });

      const results = await dependencies.ask(
        conversationId,
        [question.payload],
        undefined,
        context.signal,
      );

      // The park resolved to nothing only when the run is being torn down.
      if (results === undefined) {
        return { path, outcome: "unanswered", message: "The question was not answered." };
      }
      const result = results[0];
      if (result === undefined) {
        return { path, outcome: "unanswered", message: "The question was not answered." };
      }

      if (result.outcome === "stopped") {
        dependencies.closing.arm(conversationId);
        return {
          path,
          outcome: "stopped",
          message: "The person stopped the run.",
          closing:
            "The person stopped this run. You have one turn to write a closing message: say " +
            "what you stopped for and what you need to continue. No further tool calls will run.",
        };
      }

      const applied = applyScopeAnswer(dependencies.scopes, {
        projectId,
        resolvedPath: question.resolvedPath,
        mode: question.mode,
        answer: {
          ...(result.optionIds === undefined ? {} : { optionIds: result.optionIds }),
          ...(result.text === undefined ? {} : { text: result.text }),
        },
        outcome: result.outcome,
        declines: dependencies.declines,
        conversationId,
      });

      if (applied.granted) {
        // The row is written; this run reads it too.
        context.sandbox.widen(path, input.mode);
        const where =
          applied.choice === SCOPE_QUESTION_OPTIONS.everywhere || projectId === undefined
            ? "machine-wide"
            : "for this project";
        return {
          path,
          outcome: "granted",
          message: `${path} is now within reach for ${input.mode}, ${where}. Carry on.`,
        };
      }

      if (applied.choice === SCOPE_QUESTION_OPTIONS.deny) {
        return {
          path,
          outcome: "declined",
          message:
            `The person did not allow ${path}. Do the work another way, or say what you ` +
            "cannot do without it. Do not ask for this folder again.",
        };
      }

      // Deferred, timed out, or answered in their own words without choosing.
      // Free text is passed along whole: it may be a different folder, a
      // condition, or a no with a reason, and the model is the one reading it.
      return {
        path,
        outcome: "unanswered",
        message:
          result.text === undefined
            ? `The question about ${path} was not answered, so nothing was granted.`
            : `The person answered in their own words instead of granting ${path}.`,
        ...(result.text === undefined ? {} : { text: result.text }),
      };
    },
  });
}

/**
 * Whether the sandbox already resolves this path in this mode.
 *
 * The resolver refuses with a `SandboxError` when the path sits outside every
 * root, which is the one answer this cares about; anything else it throws is
 * let through, because a broken sandbox is not "the folder is in reach".
 */
function reachable(
  sandbox: { resolveRead(path: string): string; resolveWrite(path: string): string },
  path: string,
  mode: SandboxScopeMode,
): boolean {
  try {
    if (mode === "write") sandbox.resolveWrite(path);
    else sandbox.resolveRead(path);
    return true;
  } catch (error) {
    if (error instanceof SandboxError && error.kind === "path_escape") return false;
    throw error;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
