import {
  NATIVE_PROVENANCE,
  type CapabilityDescriptor,
} from "../../contracts/capabilities.js";
import type { ClosingTurns } from "../../execution/closing-turns.js";
import type { QuestionOption, QuestionPayload, QuestionReport } from "../../questions/question.js";
import { ToolError } from "../errors.js";
import { defineStudioTool, type ToolDefinition } from "../types.js";

/**
 * The question the model needs to ask.
 *
 * Studio can already stop and ask for consent - that is the kernel's approver,
 * and it lives outside this tool on purpose. This is the other direction: the
 * run has a decision to make, the person is the one who can make it, and
 * guessing would build real work on a coin flip. The tool parks the call
 * until the person answers, defers, or stops the run.
 *
 * It declares `read` and nothing else, and that is the honest answer rather
 * than a workaround: asking observes a person's intent and changes no state.
 * `read` is permitted in an untrusted folder and auto-allowed by default, and
 * both are correct here - a tool that asks a question must not itself raise
 * an approval, or answering the question requires approving the asking of it.
 */

/** Below this a question would expire before a person could read it. */
const MIN_TIMEOUT_MS = 10_000;

/**
 * Above this the deadline is unreachable anyway: one submission is bounded by
 * the agent's own wall-clock ceiling, so a longer question deadline would
 * promise time the run cannot be alive for. The gate deadline on the tool
 * sits at the same ceiling for the same reason.
 */
const MAX_TIMEOUT_MS = 3_600_000;

const MAX_QUESTIONS = 4;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 4;
const MAX_HEADER_LENGTH = 12;

export const ASK_USER_QUESTION_DESCRIPTOR: CapabilityDescriptor = {
  id: { namespace: "native", name: "ask_user_question" },
  title: "Ask a question",
  description:
    "Stops the run and puts a real question to the person, with options, and waits for the " +
    "answer. Use it when the choice between approaches is genuinely theirs and a wrong guess " +
    "would build work they did not ask for. One to four questions are asked one at a time, in " +
    "order. Each question carries a sentence, a short header, and two to four options whose " +
    "descriptions say what happens if that option is chosen. A recommended option goes first " +
    "and says so in its label. The person can always answer in their own words, so do not ask " +
    "what a single read can settle, and do not ask what you are about to be told anyway.",
  inputSchema: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        minItems: 1,
        maxItems: MAX_QUESTIONS,
        items: {
          type: "object",
          properties: {
            question: { type: "string", minLength: 1 },
            header: { type: "string", minLength: 1 },
            options: {
              type: "array",
              minItems: MIN_OPTIONS,
              maxItems: MAX_OPTIONS,
              items: {
                type: "object",
                properties: {
                  id: { type: "string", minLength: 1 },
                  label: { type: "string", minLength: 1 },
                  description: { type: "string", minLength: 1 },
                },
                required: ["id", "label", "description"],
                additionalProperties: false,
              },
            },
            multiSelect: { type: "boolean" },
            recommendedOptionId: { type: "string", minLength: 1 },
          },
          required: ["question", "header", "options"],
          additionalProperties: false,
        },
      },
      timeoutMs: { type: "integer", minimum: 1 },
    },
    required: ["questions"],
    additionalProperties: false,
  },
  effects: ["read"],
  provenance: NATIVE_PROVENANCE,
  idempotent: false,
};

export interface AskUserQuestionInput {
  readonly questions: readonly {
    readonly question: string;
    readonly header: string;
    readonly options: readonly QuestionOption[];
    readonly multiSelect: boolean;
    readonly recommendedOptionId?: string;
  }[];
  readonly timeoutMs?: number;
}

/** What the tool returns once every question in the call has settled. */
export interface AskUserQuestionReport {
  readonly questions: readonly QuestionReport[];
  /** Present only when the person stopped the run. */
  readonly closing?: string;
}

/**
 * The tool depends on a channel to ask through and on the closing-turn state
 * its stop outcome arms. Both are supplied by the runtime that registers it;
 * a registration without them would offer a question nobody can answer.
 */
export interface AskToolDependencies {
  readonly ask: (
    conversationId: string,
    questions: readonly QuestionPayload[],
    timeoutMs: number | undefined,
    signal: AbortSignal | undefined,
  ) => Promise<readonly QuestionReport[] | undefined>;
  readonly closing: ClosingTurns;
}

/**
 * Clamps the model's timeout to what a person can honestly be held to.
 *
 * The floor exists so a question cannot expire before it has been read. The
 * ceiling exists because a run does not outlive its submission; promising a
 * two-hour deadline inside a one-hour run would be the T-15 mistake again -
 * two bounds disagreeing, with the smaller one winning silently.
 */
export function clampTimeout(timeoutMs: number): number {
  return Math.min(Math.max(timeoutMs, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
}

export function createAskUserQuestionTool(
  dependencies: AskToolDependencies,
): ToolDefinition<AskUserQuestionInput, AskUserQuestionReport> {
  return defineStudioTool({
    descriptor: ASK_USER_QUESTION_DESCRIPTOR,
    resourceKind: "command",
    resource: () => undefined,
    // One wall-clock hour, not the shared two-minute default. This call parks
    // on a person, and a human deciding is not a call running slowly - the
    // two-minute deadline would abandon every question as its first act. The
    // ceiling is the submission's own wall clock, which is the longest park a
    // run can be alive for; past it the gate abandons the call while the
    // durable row stays standing for the person to answer.
    deadlineMs: MAX_TIMEOUT_MS,

    parse: (input): AskUserQuestionInput => {
      const value = (input ?? {}) as Record<string, unknown>;
      const rawQuestions = value["questions"];
      if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
        throw new ToolError("invalid_input", {
          message: "questions is required: between one and four questions to ask.",
        });
      }
      if (rawQuestions.length > MAX_QUESTIONS) {
        throw new ToolError("invalid_input", {
          message: `At most ${MAX_QUESTIONS} questions can be asked in one call.`,
        });
      }

      const timeout = value["timeoutMs"];
      if (timeout !== undefined && (typeof timeout !== "number" || !Number.isInteger(timeout))) {
        throw new ToolError("invalid_input", {
          message: "timeoutMs must be a whole number of milliseconds.",
        });
      }

      return {
        questions: rawQuestions.map((raw) => parseQuestion(raw)),
        ...(timeout === undefined ? {} : { timeoutMs: clampTimeout(timeout) }),
      };
    },

    execute: async (input, context) => {
      const payloads: QuestionPayload[] = input.questions.map((entry) => ({
        question: entry.question,
        header: entry.header,
        options: entry.options,
        multiSelect: entry.multiSelect,
        ...(entry.recommendedOptionId === undefined
          ? {}
          : { recommendedOptionId: entry.recommendedOptionId }),
      }));

      // The park. Everything durable about the question is written before
      // this waits, so a crash answers "the question still exists" rather
      // than "nothing happened".
      const results = await dependencies.ask(
        context.scope.conversationId,
        payloads,
        input.timeoutMs,
        context.signal,
      );

      // The park resolved to nothing only when the run is being torn down:
      // the person pressed stop, or the submission died under the question.
      // Nothing said here is read in that state.
      if (results === undefined) {
        return { questions: [] };
      }

      const stopped = results.some((result) => result.outcome === "stopped");
      if (stopped) {
        // The person ended the run. The runtime holds the loop to one closing
        // turn - the next tool batch is refused and terminates - so this note
        // tells the model what the one turn is for rather than trusting it to
        // keep talking forever.
        dependencies.closing.arm(context.scope.conversationId);
        return {
          questions: results,
          closing:
            "The person stopped this run. You have one turn to write a closing message: say " +
            "what you stopped for and what you need to continue. No further tool calls will run.",
        };
      }

      return { questions: results };
    },
  });
}

function parseQuestion(raw: unknown): {
  readonly question: string;
  readonly header: string;
  readonly options: readonly QuestionOption[];
  readonly multiSelect: boolean;
  readonly recommendedOptionId?: string;
} {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ToolError("invalid_input", {
      message: "Each question must be an object with a question, a header, and options.",
    });
  }
  const value = raw as Record<string, unknown>;

  const question = value["question"];
  if (typeof question !== "string" || question.trim() === "") {
    throw new ToolError("invalid_input", {
      message: "Each question needs a sentence: question is required.",
    });
  }

  const header = value["header"];
  if (typeof header !== "string" || header.trim() === "") {
    throw new ToolError("invalid_input", {
      message: "Each question needs a short header, at most twelve characters.",
    });
  }
  if (header.length > MAX_HEADER_LENGTH) {
    throw new ToolError("invalid_input", {
      message: `The header "${header}" is longer than ${MAX_HEADER_LENGTH} characters.`,
    });
  }

  const rawOptions = value["options"];
  if (!Array.isArray(rawOptions) || rawOptions.length < MIN_OPTIONS) {
    throw new ToolError("invalid_input", {
      message: `Each question needs between ${MIN_OPTIONS} and ${MAX_OPTIONS} options.`,
    });
  }
  if (rawOptions.length > MAX_OPTIONS) {
    throw new ToolError("invalid_input", {
      message: `At most ${MAX_OPTIONS} options can be offered per question.`,
    });
  }

  const options: QuestionOption[] = [];
  const optionIds = new Set<string>();
  for (const rawOption of rawOptions) {
    if (typeof rawOption !== "object" || rawOption === null || Array.isArray(rawOption)) {
      throw new ToolError("invalid_input", {
        message: "Each option must be an object with an id, a label, and a description.",
      });
    }
    const entry = rawOption as Record<string, unknown>;
    const id = entry["id"];
    const label = entry["label"];
    const description = entry["description"];
    if (typeof id !== "string" || id.trim() === "") {
      throw new ToolError("invalid_input", {
        message: "Each option needs an id.",
      });
    }
    if (optionIds.has(id)) {
      throw new ToolError("invalid_input", {
        message: `Two options share the id "${id}".`,
      });
    }
    optionIds.add(id);
    if (typeof label !== "string" || label.trim() === "") {
      throw new ToolError("invalid_input", {
        message: "Each option needs a label.",
      });
    }
    if (typeof description !== "string" || description.trim() === "") {
      throw new ToolError("invalid_input", {
        message:
          "Each option needs a description saying what happens if it is chosen, so the " +
          "person can decide without guessing.",
      });
    }
    options.push({ id, label, description });
  }

  const recommended = value["recommendedOptionId"];
  if (recommended !== undefined) {
    if (typeof recommended !== "string") {
      throw new ToolError("invalid_input", {
        message: "recommendedOptionId must name one of the options.",
      });
    }
    if (!optionIds.has(recommended)) {
      throw new ToolError("invalid_input", {
        message: `recommendedOptionId "${recommended}" is not one of the options offered.`,
      });
    }
  }

  const multiSelect = value["multiSelect"];
  if (multiSelect !== undefined && typeof multiSelect !== "boolean") {
    throw new ToolError("invalid_input", {
      message: "multiSelect must be true or false.",
    });
  }

  return {
    question,
    header,
    options,
    multiSelect: multiSelect === true,
    ...(recommended === undefined ? {} : { recommendedOptionId: recommended }),
  };
}
