import {
  createAssistantMessageEventStream,
  createProvider,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type ModelCost,
  type ProviderStreams,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { setProvider } from "@flue/runtime";

import {
  defaultModelReference,
  ModelResolutionError,
  STUDIO_MODEL_ID,
  type ModelCapability,
  type ModelDescriptor,
  type ModelProviderAdapter,
  type ModelReference,
  type ReasoningLevel,
} from "../../contracts/models.js";

const api = "project-studio-test";
const piProvider = "project-studio-test";

const TEST_PROVIDER = "project-studio";
const TEST_MODEL = "default";
const CONTEXT_WINDOW = 32_000;
const MAX_OUTPUT_TOKENS = 4_096;

/**
 * Flue's dynamic-model opt-in, keyed the way its runtime declares it - a
 * `Symbol.for` registry key, so the symbol this module builds is the one its
 * bundle resolves, whatever copies of either package are loaded.
 *
 * A provider carrying this template answers `resolveModel` for ANY model id
 * under it: the runtime synthesizes a zero-metadata model when the id is not
 * in the declared list. That is the 2.0 spelling of what 1.0's
 * `registerProvider` did for the test source by omitting a model list - a
 * scripted model that answers whatever reference a conversation's index
 * carries, because the source's job is to exercise the pipeline, not to
 * second-guess the stored choice.
 */
const DYNAMIC_MODEL_TEMPLATE = Symbol.for("flue.dynamicModelTemplate");

/** The scripted source prices nothing and carries no rates. */
const UNPRICED: ModelCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

const TEST_MODEL_ENTRY: Model<Api> = {
  id: TEST_MODEL,
  name: "Scripted test model",
  api,
  provider: TEST_PROVIDER,
  baseUrl: "in-process://project-studio-test",
  reasoning: false,
  input: ["text"],
  cost: UNPRICED,
  contextWindow: CONTEXT_WINDOW,
  maxTokens: MAX_OUTPUT_TOKENS,
};

/**
 * Auth that answers configured while promising nothing - the same shape
 * pi-ai's faux provider uses. The runtime refuses to stream through a
 * provider whose auth resolves to nothing; the scripted stream reads no
 * credential, so the honest answer is an empty auth, which injects no key
 * and no header into any request.
 */
const TEST_AUTH = {
  apiKey: {
    name: "Project Studio test source",
    async resolve() {
      return { auth: {} };
    },
  },
};

const TEST_CAPABILITY: ModelCapability = {
  textGeneration: "supported",
  streaming: "supported",
  reasoning: "unsupported",
  toolCalling: "supported",
  vision: "unsupported",
  embeddings: "unsupported",
  reranking: "unsupported",
  imageGeneration: "unsupported",
  imageEditing: "unsupported",
  videoGeneration: "unsupported",
  speechGeneration: "unsupported",
  transcription: "unsupported",
  webSearch: "unsupported",
  webFetch: "unsupported",
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

/**
 * Whether the scripted native tool has already answered.
 *
 * `glob` rather than the old `workspace_summary` stub: that tool existed only
 * so this fake model had something to call, returned a constant, and cost its
 * schema on every real request. `glob` is a real read-only tool that answers
 * in any directory, including an empty one, so the pipeline this exercises -
 * model asks, gate authorizes, tool runs, result returns - is now exercised
 * with a tool the product actually ships.
 */
function hasToolResult(context: Context): boolean {
  return context.messages.some(
    (message) => message.role === "toolResult" && message.toolName === "glob",
  );
}

function hasAnyToolResult(context: Context): boolean {
  return context.messages.some((message) => message.role === "toolResult");
}

/** Whether an extension's tool has answered at least once, transcript-wide. */
function hasMcpToolResult(context: Context): boolean {
  return context.messages.some(
    (message) =>
      message.role === "toolResult" && (message.toolName ?? "").startsWith("mcp__"),
  );
}

/** Whether the discovery has answered at least once, transcript-wide. */
function hasDiscoverResult(context: Context): boolean {
  return context.messages.some(
    (message) => message.role === "toolResult" && message.toolName === "discover",
  );
}

/**
 * Whether the last tool result carried a given fragment.
 *
 * The discovery's answers say more than "done": a switched-off extension
 * answers with the switched-off remedy, and the difference between the two is
 * the one thing the closing sentence can read instead of pretending. Only the
 * LAST result is read - the discovery of the moment, not the earlier ones -
 * because the question the closing answers is what just happened.
 */
function lastToolResultIncludes(context: Context, fragment: string): boolean {
  for (const message of context.messages.toReversed()) {
    if (message.role === "toolResult") {
      return JSON.stringify(message.content).includes(fragment);
    }
  }
  return false;
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
        // An abort's reason is whatever the aborter passed, and propagating
        // it verbatim is the point: replacing it with an Error of our own
        // would lose the identity the caller aborted with.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
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

/**
 * The scripted stream. Phase 2/3 state: `register()` is a no-op, so nothing
 * consumes this yet - Phase 5 mounts it as the test source's Pi provider
 * (`createProvider` + `setProvider`) exactly as scripted here. Exported so
 * the script stays one module's business when that port lands.
 */
export function stream(
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

      // The extension scenario, two steps. Under the withhold an extension's
      // tools are not in the array until discovered, so the first pass calls
      // discover - by the fixture's full id, which this scenario knows, the
      // way a model that read the inventory would - and the tool joins the
      // array only for the NEXT submission. A third call in the same
      // submission still cannot see it; the trap 0048 §2 warns about, kept
      // rather than fixed, so the call happens on the next message.
      const mcpName = mcpToolName(context);
      if (userText.toLowerCase().includes("mcp")) {
        if (mcpName !== undefined && !hasMcpToolResult(context)) {
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
        if (!hasAnyToolResult(context)) {
          const discoverCall = {
            type: "toolCall" as const,
            id: "mcp-discover-1",
            name: "discover",
            arguments: { scope: "mcp:echo-server/echo" },
          };
          const message = createMessage(model, [discoverCall]);
          message.stopReason = "toolUse";
          events.push({ type: "toolcall_start", contentIndex: 0, partial: initial });
          events.push({ type: "toolcall_end", contentIndex: 0, toolCall: discoverCall, partial: message });
          events.push({ type: "done", reason: "toolUse", message });
          return;
        }
      }

      // Two tool calls in one assistant message, which is what a model does
      // when the work is independent - and what the whole stack under it has
      // to survive. Both are `native/glob`, so both travel the real path: the
      // gate authorizes each, the tools run together, and two outcomes come
      // back against one assistant message. `harness.test.ts` drives this.
      if (
        userText.toLowerCase().includes("parallel") &&
        !hasToolResult(context)
      ) {
        const calls = [
          {
            type: "toolCall" as const,
            id: "parallel-glob-1",
            name: "glob",
            arguments: { pattern: "**/*" },
          },
          {
            type: "toolCall" as const,
            id: "parallel-glob-2",
            name: "glob",
            arguments: { pattern: "*" },
          },
        ];
        const message = createMessage(model, calls);
        message.stopReason = "toolUse";
        for (const [index, toolCall] of calls.entries()) {
          events.push({
            type: "toolcall_start",
            contentIndex: index,
            partial: index === 0 ? initial : message,
          });
          events.push({ type: "toolcall_end", contentIndex: index, toolCall, partial: message });
        }
        events.push({ type: "done", reason: "toolUse", message });
        return;
      }

      // A call that has to ask before it runs. `glob` and `read` are allowed
      // without a question, so neither can drive the approval path; `write`
      // parks on the permission kernel, which is what a test needs to see the
      // pending question on the wire and to check the shape the webview
      // filters it by.
      if (
        userText.toLowerCase().includes("askme") &&
        !hasToolResult(context)
      ) {
        const toolCall = {
          type: "toolCall" as const,
          id: "askme-write-1",
          name: "write",
          arguments: { path: "probe.txt", content: "hello" },
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
          id: "workspace-glob-1",
          name: "glob",
          arguments: { pattern: "**/*" },
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
        : hasMcpToolResult(context)
          ? "MCP tool completed."
          : hasDiscoverResult(context)
            ? // The discovery's own answer decides the closing, because the two
              // endings it covers mean different things: a switched-off
              // extension answered with its remedy, a found one answered with
              // its definition - and the second is the only one callable from
              // the next message, which is what the sentence then promises.
              (lastToolResultIncludes(context, "switched off")
                ? "The extension is switched off for this conversation. There is nothing of it to reach until that changes."
                : "Found the MCP tool. It is yours to call from your next message.")
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

  /**
   * Mounts the scripted provider with the Flue runtime.
   *
   * The declared model list names the alias (`project-studio/default`, what
   * this source's own `resolve` describes); the dynamic template lets any
   * other reference a conversation carries resolve to a synthesized
   * zero-metadata model, so a turn stored against a real catalog id still
   * runs the scripted stream. Idempotent by replacement: the runtime keys
   * providers by id, and a second registration with the same id replaces
   * the first.
   */
  register(): void {
    const scripted: ProviderStreams = {
      stream: (model, context, options) => stream(model, context, options),
      streamSimple: (model, context, options) => stream(model, context, options),
    };
    const provider = createProvider({
      id: TEST_PROVIDER,
      name: "Project Studio test source",
      auth: TEST_AUTH,
      models: [TEST_MODEL_ENTRY],
      api: scripted,
    });
    setProvider(
      Object.assign(provider, {
        // Outside the declared Provider shape by design - the runtime reads
        // it off the stored object - so it is attached, not constructed.
        [DYNAMIC_MODEL_TEMPLATE]: { api, baseUrl: TEST_MODEL_ENTRY.baseUrl },
      }),
    );
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

  supportedReasoningLevels(_modelId: string | null): readonly ReasoningLevel[] {
    return [];
  }

  async backgroundModel(skip = 0): Promise<string | undefined> {
    // The test source serves one model and costs nothing, so the cheapest
    // reachable model is the alias itself, and the ladder has one rung.
    if (skip > 0) return undefined;
    return STUDIO_MODEL_ID;
  }

  /**
   * The ladder snapshot: one rung, the alias, whatever rank zero would
   * answer - the scripted source's availability is a constant, so the
   * snapshot is too and the refresh is synchronous work in name only.
   */
  #ladder: readonly string[] = [];

  backgroundLadder(): readonly string[] {
    return this.#ladder;
  }

  async refreshBackgroundLadder(): Promise<void> {
    this.#ladder = [STUDIO_MODEL_ID];
  }
}
