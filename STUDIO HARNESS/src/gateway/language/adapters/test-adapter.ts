import {
  createAssistantMessageEventStream,
  createProvider,
  getCurrentSystemPrompt,
  getCurrentTools,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type ModelCost,
  type ProviderStreams,
  type SimpleStreamOptions,
  type TranscriptContext,
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
} from "../../../contracts/models.js";

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
  documentReading: "unsupported",
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

/**
 * Whether the framework's `task` tool has answered — the delegation scenario's
 * "the parent delegated" half. The child's own answers are read the same way
 * with the native helpers below, keyed by tool name, because a delegate's
 * transcript is its own: only the child's context carries them.
 */
function hasTaskResult(context: Context): boolean {
  return context.messages.some(
    (message) => message.role === "toolResult" && message.toolName === "task",
  );
}

/**
 * The plan read-back clause: the writer dimension the plan tool's result
 * carries, quoted verbatim so the live test can assert the rows the
 * planner wrote are recorded as the planner's. Empty string when no plan
 * result is in the transcript.
 */
function planWriterClause(context: Context): string {
  for (const message of context.messages.toReversed()) {
    if (message.role === "toolResult" && message.toolName === "plan") {
      // The result may arrive as a JSON string, a content-part array, or
      // the parsed object itself — normalize to the report shape first.
      const raw = message.content;
      const text =
        typeof raw === "string"
          ? raw
          : Array.isArray(raw)
            ? raw
                .filter((part) => part.type === "text")
                .map((part) => part.text)
                .join("")
            : JSON.stringify(raw);
      try {
        const parsed = JSON.parse(text) as { items?: { updatedBy?: string }[] };
        const writer = parsed.items?.[0]?.updatedBy;
        return writer === undefined ? ", plan unrecorded" : `, plan writer ${writer}`;
      } catch {
        return ", plan unrecorded";
      }
    }
  }
  return "";
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

  // The background-task scenario. A first message carrying `[hold-task]` is
  // also the titling agent's prompt (the titler dispatches the conversation's
  // first message), and the titling run is recognizable by its own system
  // prompt - the parent's turn carries the same user text under the studio
  // system prompt, so this hold is the CHILD's alone. Holding keeps the task
  // row `running` in the index for the seconds a test needs to read it there,
  // cancel it, or kill the harness underneath it; the abort signal rejects
  // the wait, which is how a cancel reaches the run.
  if (
    userText.includes("[hold-task]") &&
    (context.systemPrompt ?? "").includes("title-generation task")
  ) {
    await waitForDelay(12_000, options?.signal);
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

      // Read the whole transcript, including status signals, to prove that a
      // second user task survives a background job's start/stop boundaries.
      const contextText = context.messages.map((message) => JSON.stringify(message)).join("\n");
      if (contextText.includes("[job-continuity]") && (context.systemPrompt ?? "").includes("# Studio")) {
        const started = context.messages.find((message) => message.role === "toolResult" && message.toolCallId === "continuity-start");
        const stopped = context.messages.some((message) => message.role === "toolResult" && message.toolCallId === "continuity-stop");
        const jobId = started === undefined ? undefined : /job_[a-f0-9]+/.exec(JSON.stringify(started))?.[0];
        if (started === undefined || (jobId !== undefined && !stopped)) {
          const toolCall = started === undefined
            ? { type: "toolCall" as const, id: "continuity-start", name: "shell",
                arguments: { command: 'node -e "setTimeout(() => {}, 10000)"', background: true } }
            : { type: "toolCall" as const, id: "continuity-stop", name: "jobs",
                arguments: { ...(jobId === undefined ? {} : { id: jobId }), stop: true } };
          const message = createMessage(model, [toolCall]);
          message.stopReason = "toolUse";
          events.push({ type: "toolcall_start", contentIndex: 0, partial: initial });
          events.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: message });
          events.push({ type: "done", reason: "toolUse", message });
          return;
        }
        const text = JSON.stringify({
          earlierRequestPresent: contextText.includes("earlier-html-task"),
          currentRequestPresent: contextText.includes("build-next-project"),
          jobStarted: jobId !== undefined,
          stopRequested: stopped,
          instructionChurn: contextText.includes("System instructions updated.") || (context.systemPrompt ?? "").includes("Background work you started:"),
        });
        const completed = createMessage(model, [{ type: "text", text }]);
        events.push({ type: "text_start", contentIndex: 0, partial: initial });
        events.push({ type: "text_delta", contentIndex: 0, delta: text, partial: completed });
        events.push({ type: "text_end", contentIndex: 0, content: text, partial: completed });
        events.push({ type: "done", reason: "stop", message: completed });
        return;
      }

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

      // The skill scenario. A mounted skill is one catalog line in the
      // system prompt and one framework tool, `activate_skill`, whose result
      // is the skill's body; nothing of the skill is anywhere else. So the
      // script reads exactly those two surfaces and reports what it found,
      // which is what the integration test asserts: that switching a skill
      // on puts it in both places, and switching it off takes it out of
      // both. The fixture's name is known to the script the way the MCP
      // fixture's id is.
      if (userText.toLowerCase().includes("skill")) {
        const activate = context.tools?.find((tool) => tool.name === "activate_skill");
        if (activate !== undefined && !hasAnyToolResult(context)) {
          const toolCall = {
            type: "toolCall" as const,
            id: "skill-activate-1",
            name: "activate_skill",
            arguments: { name: "hello" },
          };
          const message = createMessage(model, [toolCall]);
          message.stopReason = "toolUse";
          events.push({ type: "toolcall_start", contentIndex: 0, partial: initial });
          events.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: message });
          events.push({ type: "done", reason: "toolUse", message });
          return;
        }
      }

      // The delegation scenario (Stage 3). Two roles in one script:
      //
      // The PARENT — a message naming `[delegate]` makes the model call the
      // framework's `task` tool with the registered delegate's name and a
      // self-contained prompt, the way a model that read the roster section
      // would. Once the task's result is back, the closing reports what the
      // child's final message said, so the test can assert the return path:
      // the tool result carries the child's answer, verbatim, and nothing of
      // the child's intermediate tool use.
      //
      // The CHILD — the delegate's own session runs this same scripted
      // stream with a context of its own: its latest user text is the task
      // prompt (`[task] ...` below), its system prompt is the delegate's
      // instructions, and its tool array is the gate's filtered answer for
      // the acting delegate. A message naming `[report]` closes by listing
      // EXACTLY what that array contained and which prompt section it read,
      // so the test can assert the two halves of the D4 policy from inside
      // the child: visibility (the allowlist is the whole array) and
      // briefing (the roster section exists and names the delegate).
      const toolNameOf = (name: string): string | undefined =>
        context.tools?.find((tool) => tool.name === name)?.name;
      const toolNames = (): string[] =>
        (context.tools ?? []).map((tool) => tool.name).sort();
      // The two-delegate batch (S5.5): ONE assistant message, two `task`
      // calls, the way a model hands independent work to two delegates at
      // once. The children are the explorer and the planner, so the batch
      // exercises the two read-shaped surfaces side by side — and the plan
      // child writes plan rows under `agent:plan` while the explorer reads,
      // which is the concurrency the live test asserts on.
      if (
        userText.includes("[delegate-two]") &&
        !hasTaskResult(context) &&
        (context.systemPrompt ?? "").includes("# Studio")
      ) {
        const calls = [
          {
            type: "toolCall" as const,
            id: "delegate-two-explore-1",
            name: "task",
            arguments: {
              agent: "explore",
              prompt: "[task] find the workspace files [report] what you can see",
            },
          },
          {
            type: "toolCall" as const,
            id: "delegate-two-plan-1",
            name: "task",
            arguments: {
              agent: "plan",
              prompt: "[planit] write the plan [report] the plan",
            },
          },
        ];
        const message = createMessage(model, calls);
        message.stopReason = "toolUse";
        for (const [at, call] of calls.entries()) {
          events.push({ type: "toolcall_start", contentIndex: at, partial: initial });
          events.push({
            type: "toolcall_end",
            contentIndex: at,
            toolCall: call,
            partial: message,
          });
        }
        events.push({ type: "done", reason: "toolUse", message });
        return;
      }
      if (userText.includes("[delegate-two]") && hasTaskResult(context)) {
        // The closing, after both children answered: quote each answer so
        // the test can assert both returned, and nothing of either child's
        // intermediate work crossed back.
        const answers = context.messages
          .filter((message) => message.role === "toolResult" && message.toolName === "task")
          .map((message) =>
            typeof message.content === "string"
              ? message.content
              : (message.content ?? [])
                  .filter((part) => part.type === "text")
                  .map((part) => part.text)
                  .join(""),
          );
        const text = `Delegated twice. ${answers.join(" || ")}`;
        const partial = createMessage(model, [{ type: "text", text: "" }]);
        events.push({ type: "text_start", contentIndex: 0, partial });
        partial.content = [{ type: "text", text }];
        events.push({ type: "text_delta", contentIndex: 0, delta: text, partial });
        events.push({
          type: "text_end",
          contentIndex: 0,
          content: text,
          partial: createMessage(model, [{ type: "text", text }]),
        });
        events.push({ type: "done", reason: "stop", message: createMessage(model, [{ type: "text", text }]) });
        return;
      }
      // The general-delegate scenario (S5.1): the parent hands real work to
      // the hands-on delegate. The child attempts a write — a tool its
      // array DOES hold — and the run parks on the approval the delegate's
      // own consent default raises, answered over the approvals API. The
      // child marker differs from the explorer's so the two delegations
      // stay separately scriptable.
      if (
        userText.includes("[delegate-general]") &&
        !hasTaskResult(context) &&
        (context.systemPrompt ?? "").includes("# Studio")
      ) {
        const toolCall = {
          type: "toolCall" as const,
          id: "delegate-general-1",
          name: "task",
          arguments: {
            agent: "general",
            prompt: "[gwrite] create general-made.txt [report] what happened",
          },
        };
        const message = createMessage(model, [toolCall]);
        message.stopReason = "toolUse";
        events.push({ type: "toolcall_start", contentIndex: 0, partial: initial });
        events.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: message });
        events.push({ type: "done", reason: "toolUse", message });
        return;
      }
      if (userText.includes("[delegate]") && !hasTaskResult(context)) {
        // The write-refusal variant: a parent message carrying [try-write]
        // delegates a task whose prompt carries the marker too, and the
        // CHILD then attempts a call to `write` — a tool the delegate's
        // array does not hold. What comes back is the hidden-tool
        // refusal, the allowlist layer of the three-layer read-only
        // agreement, and the child's report quotes it.
        const wantsWrite = userText.includes("[try-write]");
        const toolCall = {
          type: "toolCall" as const,
          id: "delegate-task-1",
          name: "task",
          arguments: {
            agent: "explore",
            prompt: wantsWrite
              ? "[try-write] attempt a write and [report] what happened"
              : "[task] find the workspace files [report] what you can see",
          },
        };
        const message = createMessage(model, [toolCall]);
        message.stopReason = "toolUse";
        events.push({ type: "toolcall_start", contentIndex: 0, partial: initial });
        events.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: message });
        events.push({ type: "done", reason: "toolUse", message });
        return;
      }
      if (
        (userText.includes("[delegate]") || userText.includes("[delegate-general]")) &&
        hasTaskResult(context)
      ) {
        // The parent's closing, after the task answered: quote the child's
        // final message from the tool result so the return path is asserted
        // end to end — what the parent's model receives is the child's
        // answer, and the child's intermediate steps never appear. The
        // general variant is spelled out beside the explorer marker because
        // "[delegate-general]" does not CONTAIN "[delegate]" — the bracket
        // closes the token — a subtlety the first run of this scenario
        // learned the hard way: the closing never matched and the run
        // answered with the fallthrough echo.
        const taskResult = context.messages.toReversed().find(
          (message) => message.role === "toolResult" && message.toolName === "task",
        );
        const childAnswer =
          typeof taskResult?.content === "string"
            ? taskResult.content
            : (taskResult?.content ?? [])
                .filter((part) => part.type === "text")
                .map((part) => part.text)
                .join("") || "(no task result)";
        const who = userText.includes("[delegate-general]") ? "general" : "explorer";
        const text = `Delegated. The ${who} answered: ${childAnswer}`;
        const partial = createMessage(model, [{ type: "text", text: "" }]);
        events.push({ type: "text_start", contentIndex: 0, partial });
        partial.content = [{ type: "text", text }];
        events.push({ type: "text_delta", contentIndex: 0, delta: text, partial });
        events.push({
          type: "text_end",
          contentIndex: 0,
          content: text,
          partial: createMessage(model, [{ type: "text", text }]),
        });
        events.push({ type: "done", reason: "stop", message: createMessage(model, [{ type: "text", text }]) });
        return;
      }
      if (userText.includes("[try-write]") && !userText.includes("[delegate]") && !hasAnyToolResult(context)) {
        // The child's forbidden step: attempt `write`, a tool outside the
        // delegate's allowlist. The framework answers with the
        // unknown-tool refusal — the model asked for something its array
        // never held — and the child's next call (guarded, like [task],
        // by the tool result now present) falls through to the [report]
        // close, which the closing branch composes with what the refusal
        // said. This is the three-layer agreement's first layer, live:
        // the writer is invisible, so the call is refused as unknown.
        //
        // The `[delegate]` guard keeps this the CHILD's scenario: the
        // parent's message carries both markers, and without the guard
        // the parent — which DOES hold `write` in its array — would run
        // the write and park on the permission kernel, hanging the run
        // on an approval nobody answers in a test.
        const toolCall = {
          type: "toolCall" as const,
          id: "delegate-write-1",
          name: "write",
          arguments: { path: "probe.txt", content: "no" },
        };
        const message = createMessage(model, [toolCall]);
        message.stopReason = "toolUse";
        events.push({ type: "toolcall_start", contentIndex: 0, partial: initial });
        events.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: message });
        events.push({ type: "done", reason: "toolUse", message });
        return;
      }
      // The general delegate's working step (S5.1): attempt the write its
      // allowlist holds. The kernel's verdict is the delegate's own consent
      // default (`mode: "ask"`), so the run parks on an approval that names
      // `general` — the live test answers it and asserts the attribution.
      if (userText.includes("[gwrite]") && !hasAnyToolResult(context)) {
        const toolCall = {
          type: "toolCall" as const,
          id: "general-write-1",
          name: "write",
          arguments: { path: "general-made.txt", content: "written by the general delegate" },
        };
        const message = createMessage(model, [toolCall]);
        message.stopReason = "toolUse";
        events.push({ type: "toolcall_start", contentIndex: 0, partial: initial });
        events.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: message });
        events.push({ type: "done", reason: "toolUse", message });
        return;
      }
      // The planner delegate's working step (S5.2): write the plan rows the
      // person watches. The plan tool declares read and nothing else, so no
      // approval is raised; the rows it leaves record `agent:plan`, and the
      // read-back in the report carries that to the test.
      if (userText.includes("[planit]") && !hasAnyToolResult(context)) {
        const toolCall = {
          type: "toolCall" as const,
          id: "plan-write-1",
          name: "plan",
          arguments: {
            items: [
              { id: "step-one", text: "Find the workspace files", status: "done" },
              { id: "step-two", text: "Report the plan", status: "pending" },
            ],
          },
        };
        const message = createMessage(model, [toolCall]);
        message.stopReason = "toolUse";
        events.push({ type: "toolcall_start", contentIndex: 0, partial: initial });
        events.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: message });
        events.push({ type: "done", reason: "toolUse", message });
        return;
      }
      if (userText.includes("[report]")) {
        // The child's own report. Reading `context.tools` here is reading
        // what the gate's per-acting-agent filter handed the delegate's
        // session — the exact array the child's model would see — so the
        // report is the visibility assertion, from the only context that
        // can see it. The system prompt read is the briefing's other half.
        const seesTask = toolNameOf("task");
        const seesWrite = toolNameOf("write");
        const seesShell = toolNameOf("shell");
        const seesDiscover = toolNameOf("discover");
        const seesPlan = toolNameOf("plan");
        const roster = (context.systemPrompt ?? "").includes("**explore**")
          ? "named"
          : "absent";
        // Which delegate this session IS, read from its own instructions —
        // the only place a child's identity is stated.
        const prompt = context.systemPrompt ?? "";
        const self = prompt.includes("# General")
          ? ", agent general"
          : prompt.includes("# Planner")
            ? ", agent planner"
            : "";
        // A write attempt that was refused names the refusal, read back
        // from the last tool result — the [try-write] scenario's whole
        // answer. A write that RAN is the general scenario's half: the
        // tool's own headline names the file it created.
        const writeRefused = lastToolResultIncludes(context, "not found")
          ? ", write refused as unknown"
          : "";
        const writeRan = lastToolResultIncludes(context, "Created general-made.txt")
          ? ", write ran"
          : "";
        // The plan read-back: the tool result carries the writer dimension
        // the store recorded, and the report quotes it verbatim.
        const planReport = seesPlan === undefined ? "" : planWriterClause(context);
        const text =
          `Delegate sees ${toolNames().length} tools` +
          (seesTask === undefined ? ", no task" : ", task present") +
          (seesWrite === undefined ? ", no write" : ", WRITE VISIBLE") +
          (seesShell === undefined ? ", no shell" : ", SHELL VISIBLE") +
          (seesDiscover === undefined ? ", no discover" : ", DISCOVER VISIBLE") +
          (seesPlan === undefined ? ", no plan" : ", plan present") +
          self +
          writeRefused +
          writeRan +
          planReport +
          `, roster ${roster}.`;
        const partial = createMessage(model, [{ type: "text", text: "" }]);
        events.push({ type: "text_start", contentIndex: 0, partial });
        partial.content = [{ type: "text", text }];
        events.push({ type: "text_delta", contentIndex: 0, delta: text, partial });
        events.push({
          type: "text_end",
          contentIndex: 0,
          content: text,
          partial: createMessage(model, [{ type: "text", text }]),
        });
        events.push({ type: "done", reason: "stop", message: createMessage(model, [{ type: "text", text }]) });
        return;
      }
      if (userText.includes("[task]") && !hasToolResult(context)) {
        // The child's working step: call the read-only tool the delegate
        // exists to use, the way a model that read its instructions would.
        // The gate runs it under the delegate's substituted scope; the
        // result lands in the child's transcript only. Guarded by
        // `!hasToolResult` so the child's SECOND model call (same user
        // text — the task prompt is the child's whole conversation) falls
        // through to the report below instead of calling the tool again:
        // an unguarded branch here is a model that loops forever, which
        // is exactly what the first run of this scenario did.
        const toolCall = {
          type: "toolCall" as const,
          id: "delegate-glob-1",
          name: "glob",
          arguments: { pattern: "**/*" },
        };
        const message = createMessage(model, [toolCall]);
        message.stopReason = "toolUse";
        events.push({ type: "toolcall_start", contentIndex: 0, partial: initial });
        events.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: message });
        events.push({ type: "done", reason: "toolUse", message });
        return;
      }
      const skillClosing = ((): string | undefined => {
        if (!userText.toLowerCase().includes("skill")) return undefined;
        const listed = (context.systemPrompt ?? "").includes("**hello**") ? "yes" : "no";
        if (context.tools?.some((tool) => tool.name === "activate_skill") !== true) {
          return `No skill can be activated in this conversation. Listed: ${listed}.`;
        }
        return lastToolResultIncludes(context, "Say hello, warmly.")
          ? `Skill activated: hello. Listed: ${listed}.`
          : `The skill did not activate. Listed: ${listed}.`;
      })();

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

      const text = skillClosing !== undefined
        ? skillClosing
        : hasToolResult(context)
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

/** Pi now carries prompt and tool changes in transcript system messages. */
function scriptedContext(context: TranscriptContext): Context {
  return {
    messages: context.messages,
    systemPrompt: getCurrentSystemPrompt(context.messages),
    tools: getCurrentTools(context.messages),
  };
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
      stream: (model, context, options) => stream(model, scriptedContext(context), options),
      streamSimple: (model, context, options) => stream(model, scriptedContext(context), options),
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
