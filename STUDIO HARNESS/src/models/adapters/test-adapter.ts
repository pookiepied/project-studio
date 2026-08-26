import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { registerApiProvider, registerProvider } from "@flue/runtime";

import {
  defaultModelReference,
  ModelResolutionError,
  type ModelCapability,
  type ModelDescriptor,
  type ModelProviderAdapter,
  type ModelReference,
} from "../../contracts/models.js";

const api = "project-studio-test";
const piProvider = "project-studio-test";

const TEST_PROVIDER = "project-studio";
const TEST_MODEL = "default";
const CONTEXT_WINDOW = 32_000;
const MAX_OUTPUT_TOKENS = 4_096;

const TEST_CAPABILITY: ModelCapability = {
  textGeneration: "supported",
  streaming: "supported",
  reasoning: "unsupported",
  toolCalling: "supported",
  vision: "unsupported",
  embeddings: "unsupported",
  reranking: "unsupported",
  imageGeneration: "unsupported",
  videoGeneration: "unsupported",
  speechGeneration: "unsupported",
  transcription: "unsupported",
  contextWindow: CONTEXT_WINDOW,
  maxOutputTokens: MAX_OUTPUT_TOKENS,
};

const emptyUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};

function createMessage(
  model: Model<Api>,
  content: AssistantMessage["content"] = [],
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api,
    provider: piProvider,
    model: model.id,
    usage: emptyUsage,
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function latestUserText(context: Context): string {
  for (const message of context.messages.toReversed()) {
    if (message.role === "user") {
      return typeof message.content === "string"
        ? message.content
        : message.content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("");
    }
  }
  return "";
}

function hasToolResult(context: Context): boolean {
  return context.messages.some(
    (message) =>
      message.role === "toolResult" &&
      message.toolName === "workspace_summary",
  );
}

function hasAnyToolResult(context: Context): boolean {
  return context.messages.some((message) => message.role === "toolResult");
}

function mcpToolName(context: Context): string | undefined {
  return context.tools?.find((tool) => tool.name.startsWith("mcp__"))?.name;
}

/** The provider sentence `[fail]` asks for, or undefined when it is absent. */
function failureRequest(userText: string): FailureRequest | undefined {
  const match = /\[fail(-once)?(?::\s*([^\]]*))?\]/i.exec(userText);
  if (match === null) return undefined;
  const named = match[2]?.trim();
  return {
    once: match[1] !== undefined,
    sentence:
      named === undefined || named === ""
        ? "429 rate limit exceeded: temporarily rate-limited upstream"
        : named,
  };
}

interface FailureRequest {
  /** False refuses every attempt; true refuses only the first one. */
  readonly once: boolean;
  /** The provider sentence the failure carries. */
  readonly sentence: string;
}

/**
 * `[fail-once]` cannot read prior attempts out of `context`: Flue's
 * model-context projection drops assistant records whose stopReason is
 * "error", so attempt two arrives byte-identical to attempt one and nothing
 * in Context carries an attempt number. The count therefore lives here, keyed
 * by the exact refusal sentence — exact for the retry loop this seam exists
 * to exercise, since every attempt re-enters stream() with the same latest
 * user text. Each scenario should use its own sentence; the map lives for the
 * process lifetime.
 */
const onceFailureCounts = new Map<string, number>();

function shouldRefuse(failure: FailureRequest): boolean {
  if (!failure.once) return true;
  const refused = onceFailureCounts.get(failure.sentence) ?? 0;
  onceFailureCounts.set(failure.sentence, refused + 1);
  return refused === 0;
}

/** A `[fail-seq: ...]` directive: its identity and the refusals it owes. */
interface FailureSequence {
  /** The whole bracket token, lowercased — the state key, warts and all. */
  readonly key: string;
  readonly refusals: readonly string[];
}

/**
 * Parses the first `[fail-seq: first | second | ...]` in the user text.
 * Empty entries are dropped; a directive with none of them is no directive.
 */
function failureSequence(userText: string): FailureSequence | undefined {
  const match = /\[fail-seq:\s*([^\]]*)\]/i.exec(userText);
  if (match === null) return undefined;
  const refusals = (match[1] ?? "")
    .split("|")
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "");
  if (refusals.length === 0) return undefined;
  return { key: match[0].toLowerCase(), refusals };
}

/**
 * Consumes and returns this attempt's refusal from the sequence, or undefined
 * once every listed sentence has been spent, after which attempts answer
 * normally. Keyed like `onceFailureCounts`, with the same lifetime wart: the
 * count lives for the process lifetime, so a restart starts a sequence over,
 * and two scenarios sharing one bracket token share one state. Give each
 * scenario its own entries.
 */
const sequenceCounts = new Map<string, number>();

function nextSequenceRefusal(sequence: FailureSequence): string | undefined {
  const refused = sequenceCounts.get(sequence.key) ?? 0;
  const sentence = sequence.refusals[refused];
  if (sentence === undefined) return undefined;
  sequenceCounts.set(sequence.key, refused + 1);
  return sentence;
}

async function waitForDelay(
  milliseconds: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/**
 * `[pace]`: how far apart the answer's deltas are emitted, so a client can be
 * observed receiving them WHILE the turn runs rather than afterwards. Without
 * spacing the whole event stream finishes inside one tick and no reader, ours
 * or a test's, can tell a live delivery from a replayed one.
 */
const PACE_DELTA_MS = 300;
/** Delta size under `[pace]`, small enough that an ordinary sentence makes several. */
const PACE_SLICE_CHARS = 4;

function pacedSlices(text: string): string[] {
  const slices: string[] = [];
  for (let index = 0; index < text.length; index += PACE_SLICE_CHARS) {
    slices.push(text.slice(index, index + PACE_SLICE_CHARS));
  }
  return slices.length > 0 ? slices : [text];
}

function stream(
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const events = createAssistantMessageEventStream();

  void (async () => {
    try {
      const userText = latestUserText(context);
      if (userText.includes("[slow]")) {
        await waitForDelay(10_000, options?.signal);
      }

      // A provider failure, on demand. `[fail]` alone reads as a transient
      // 429 — the case Flue retries and then gives up on —
      // `[fail-once]` refuses exactly once and answers normally afterwards,
      // so a retry that recovers can be told apart from one that merely fails
      // faster, and `[fail: <text>]` names any other provider sentence, so a
      // non-retryable failure can be exercised through the same door.
      // `[fail-seq: first | second | ...]` refuses once with each listed
      // sentence in order and answers after the list is spent — the only way
      // to drive a turn whose error class changes between attempts, which a
      // per-class budget makes a case worth testing rather than assuming.
      // Without a seam like this the only way to reach the failure paths is
      // to wait for a real provider to have a bad day.
      const sequence = failureSequence(userText);
      if (sequence !== undefined) {
        const refusal = nextSequenceRefusal(sequence);
        if (refusal !== undefined) {
          const message = createMessage(model);
          message.stopReason = "error";
          message.errorMessage = refusal;
          events.push({ type: "error", reason: "error", error: message });
          return;
        }
      }
      const failure = failureRequest(userText);
      if (failure !== undefined && shouldRefuse(failure)) {
        const message = createMessage(model);
        message.stopReason = "error";
        message.errorMessage = failure.sentence;
        events.push({ type: "error", reason: "error", error: message });
        return;
      }

      const initial = createMessage(model);
      events.push({ type: "start", partial: initial });

      const mcpName = mcpToolName(context);
      if (userText.toLowerCase().includes("mcp") && mcpName !== undefined && !hasAnyToolResult(context)) {
        const toolCall = {
          type: "toolCall" as const,
          id: "mcp-echo-1",
          name: mcpName,
          arguments: { text: "hello from the model" },
        };
        const message = createMessage(model, [toolCall]);
        message.stopReason = "toolUse";
        events.push({ type: "toolcall_start", contentIndex: 0, partial: initial });
        events.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: message });
        events.push({ type: "done", reason: "toolUse", message });
        return;
      }

      if (
        userText.toLowerCase().includes("workspace") &&
        !hasToolResult(context)
      ) {
        const toolCall = {
          type: "toolCall" as const,
          id: "workspace-summary-1",
          name: "workspace_summary",
          arguments: { workspace: "Project Studio V2" },
        };
        const message = createMessage(model, [toolCall]);
        message.stopReason = "toolUse";

        events.push({
          type: "toolcall_start",
          contentIndex: 0,
          partial: initial,
        });
        events.push({
          type: "toolcall_end",
          contentIndex: 0,
          toolCall,
          partial: message,
        });
        events.push({ type: "done", reason: "toolUse", message });
        return;
      }

      const text = hasToolResult(context)
        ? "Project Studio V2 workspace is ready."
        : hasAnyToolResult(context)
          ? "MCP tool completed."
        : `Echo: ${userText.replace("[slow]", "").replace("[pace]", "").trim()}`;
      const partial = createMessage(model, [{ type: "text", text: "" }]);
      let streamedText = "";
      events.push({ type: "text_start", contentIndex: 0, partial });

      // `[pace]` spreads the deltas over wall-clock time; the default keeps
      // the historical two-delta shape so existing scenarios are untouched.
      const paced = /\[pace\]/i.test(userText);
      const slices = paced ? pacedSlices(text) : [text.slice(0, 8), text.slice(8)];
      for (const [index, chunk] of slices.entries()) {
        if (paced && index > 0) await waitForDelay(PACE_DELTA_MS, options?.signal);
        streamedText += chunk;
        partial.content = [{ type: "text", text: streamedText }];
        events.push({
          type: "text_delta",
          contentIndex: 0,
          delta: chunk,
          partial,
        });
      }

      const message = createMessage(model, [{ type: "text", text }]);
      events.push({
        type: "text_end",
        contentIndex: 0,
        content: text,
        partial: message,
      });
      events.push({ type: "done", reason: "stop", message });
    } catch (error) {
      const message = createMessage(model);
      message.stopReason = "aborted";
      message.errorMessage =
        error instanceof Error ? error.message : "The request was aborted.";
      events.push({ type: "error", reason: "aborted", error: message });
    }
  })();

  return events;
}

export class TestModelProviderAdapter implements ModelProviderAdapter {
  readonly source = "test" as const;
  readonly operational = true;
  #registered = false;

  register(): void {
    if (this.#registered) {
      return;
    }

    registerApiProvider({
      api,
      stream,
      streamSimple: stream,
    });

    registerProvider(TEST_PROVIDER, {
      api,
      baseUrl: "in-process://project-studio-test",
      contextWindow: CONTEXT_WINDOW,
      maxTokens: MAX_OUTPUT_TOKENS,
    });

    this.#registered = true;
  }

  resolve(reference: ModelReference): ModelDescriptor {
    if (reference.source !== this.source) {
      throw new ModelResolutionError(
        `Model source "${reference.source}" does not match the "${this.source}" adapter.`,
      );
    }
    if (reference.provider !== TEST_PROVIDER || reference.model !== TEST_MODEL) {
      throw new ModelResolutionError(
        `Unknown model "${reference.provider}/${reference.model}" for source "${this.source}".`,
      );
    }

    return {
      source: this.source,
      provider: TEST_PROVIDER,
      model: TEST_MODEL,
      resolvedModelId: `${TEST_PROVIDER}/${TEST_MODEL}`,
      capability: TEST_CAPABILITY,
      operational: true,
    };
  }

  listModels(): readonly ModelDescriptor[] {
    return [this.resolve(defaultModelReference(this.source))];
  }
}
