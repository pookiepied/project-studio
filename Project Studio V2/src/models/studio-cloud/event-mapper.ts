import type {
  Api,
  AssistantMessage,
  AssistantMessageEventStream,
  Model,
  StopReason,
  TextContent,
  ThinkingContent,
  ToolCall,
  Usage,
} from "@earendil-works/pi-ai";

import { StudioGatewayError, studioGatewayErrorForStreamCode } from "./errors.js";
import type { SseFrame } from "./sse-parser.js";

export interface GatewayToolCall {
  readonly id: string;
  readonly type?: string;
  readonly function: { readonly name: string; readonly arguments: string };
}

export interface GatewayUsage {
  readonly prompt_tokens?: number;
  readonly completion_tokens?: number;
  readonly total_tokens?: number;
  readonly cache_read_input_tokens?: number;
  readonly cache_creation_input_tokens?: number;
  readonly reasoning_tokens?: number;
}

/**
 * The Studio gateway's own SSE contract. It is not OpenAI streaming: there are
 * no `choices` deltas, tool calls arrive already complete, and every semantic
 * event is published twice (a compatibility name and a canonical
 * `model.*` name).
 */
export type StudioStreamEvent =
  | { type: "stream.started"; provider?: string; model?: string }
  | { type: "content"; chunk: string }
  | { type: "model.message.delta"; chunk: string }
  | { type: "reasoning"; chunk: string }
  | { type: "model.reasoning.delta"; chunk: string }
  | { type: "tool_call"; call: GatewayToolCall }
  | { type: "model.tool_call.completed"; call: GatewayToolCall }
  | { type: "tool_calls"; calls: GatewayToolCall[] }
  | { type: "usage"; data: GatewayUsage }
  | { type: "model.usage"; data: GatewayUsage }
  | { type: "model.completed"; finishReason?: string | null }
  | { type: "stream.error"; error?: { code?: string; message?: string } }
  | { type: "stream.completed" }
  | { type: "gateway.done" };

const KNOWN_EVENT_TYPES = new Set<StudioStreamEvent["type"]>([
  "stream.started",
  "content",
  "model.message.delta",
  "reasoning",
  "model.reasoning.delta",
  "tool_call",
  "model.tool_call.completed",
  "tool_calls",
  "usage",
  "model.usage",
  "model.completed",
  "stream.error",
  "stream.completed",
]);

/**
 * Decodes one SSE frame. Unrecognized event types are dropped rather than
 * failing the stream, so a gateway that adds an event stays compatible.
 */
export function parseStudioEvent(frame: SseFrame): StudioStreamEvent | undefined {
  if (frame.data.trim() === "[DONE]") {
    return { type: "gateway.done" };
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(frame.data);
  } catch {
    throw new StudioGatewayError("protocol");
  }

  if (!decoded || typeof decoded !== "object") {
    throw new StudioGatewayError("protocol");
  }

  const candidate = decoded as { type?: unknown };
  if (typeof candidate.type !== "string") {
    throw new StudioGatewayError("protocol");
  }
  if (!KNOWN_EVENT_TYPES.has(candidate.type as StudioStreamEvent["type"])) {
    return undefined;
  }

  return decoded as StudioStreamEvent;
}

/**
 * Compatibility event name paired with the canonical event carrying the same
 * payload. The gateway emits them back to back.
 */
const CANONICAL_TWIN: Partial<Record<StudioStreamEvent["type"], StudioStreamEvent["type"]>> = {
  content: "model.message.delta",
  reasoning: "model.reasoning.delta",
  tool_call: "model.tool_call.completed",
  usage: "model.usage",
};

function payloadOf(event: StudioStreamEvent): unknown {
  switch (event.type) {
    case "content":
    case "model.message.delta":
    case "reasoning":
    case "model.reasoning.delta":
      return event.chunk;
    case "tool_call":
    case "model.tool_call.completed":
      return event.call;
    case "usage":
    case "model.usage":
      return event.data;
    default:
      return undefined;
  }
}

function samePayload(left: StudioStreamEvent, right: StudioStreamEvent): boolean {
  return JSON.stringify(payloadOf(left)) === JSON.stringify(payloadOf(right));
}

/**
 * Collapses each compatibility/canonical pair to a single event.
 *
 * A compatibility event is held for exactly one event. If its canonical twin
 * follows with an identical payload, the compatibility copy is dropped;
 * otherwise it is released unchanged, so a gateway that emits only the
 * compatibility form still produces output.
 */
export async function* dedupeStudioEvents(
  source: AsyncIterable<StudioStreamEvent>,
): AsyncGenerator<StudioStreamEvent> {
  let pending: StudioStreamEvent | undefined;

  for await (const event of source) {
    if (pending) {
      const held = pending;
      pending = undefined;
      if (CANONICAL_TWIN[held.type] === event.type && samePayload(held, event)) {
        yield event;
        continue;
      }
      yield held;
    }

    if (CANONICAL_TWIN[event.type] !== undefined) {
      pending = event;
      continue;
    }
    yield event;
  }

  if (pending) yield pending;
}

function emptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function usageFromGateway(data: GatewayUsage, previous: Usage): Usage {
  const input = data.prompt_tokens ?? previous.input;
  const output = data.completion_tokens ?? previous.output;
  const usage: Usage = {
    input,
    output,
    cacheRead: data.cache_read_input_tokens ?? previous.cacheRead,
    cacheWrite: data.cache_creation_input_tokens ?? previous.cacheWrite,
    totalTokens: data.total_tokens ?? input + output,
    cost: previous.cost,
  };

  return data.reasoning_tokens === undefined
    ? usage
    : { ...usage, reasoning: data.reasoning_tokens };
}

/**
 * A finish reason of `tool-calls` and the presence of tool calls both mean the
 * turn is not final: Flue must run the tools and continue the conversation.
 */
export function stopReasonFor(
  finishReason: string | null | undefined,
  hasToolCalls: boolean,
): Extract<StopReason, "stop" | "length" | "toolUse"> {
  if (hasToolCalls) return "toolUse";
  const normalized = (finishReason ?? "").toLowerCase();
  if (normalized === "tool-calls" || normalized === "tool_calls" || normalized === "tooluse") {
    return "toolUse";
  }
  if (normalized === "length" || normalized === "max_tokens") return "length";
  return "stop";
}

export interface StudioPiEventMapperOptions {
  readonly events: AssistantMessageEventStream;
  readonly model: Model<Api>;
  readonly api: string;
  readonly provider: string;
}

/**
 * Translates the gateway's stream into Pi's assistant-message event protocol.
 *
 * It never executes a tool: completed tool calls become content on the
 * assistant message and the turn ends with `toolUse` so Flue's agent loop owns
 * execution and continuation.
 */
export class StudioPiEventMapper {
  readonly #events: AssistantMessageEventStream;
  readonly #api: string;
  readonly #provider: string;
  readonly #modelId: string;

  readonly #content: (TextContent | ThinkingContent | ToolCall)[] = [];
  readonly #toolCallIds = new Set<string>();
  #partial: AssistantMessage;
  #open: { kind: "text" | "thinking"; index: number } | undefined;
  #usage: Usage = emptyUsage();
  #finishReason: string | null | undefined;
  #settled = false;
  #started = false;

  constructor(options: StudioPiEventMapperOptions) {
    this.#events = options.events;
    this.#api = options.api;
    this.#provider = options.provider;
    this.#modelId = options.model.id;
    this.#partial = this.#createMessage("stop");
  }

  get settled(): boolean {
    return this.#settled;
  }

  handle(event: StudioStreamEvent): void {
    if (this.#settled) return;

    switch (event.type) {
      case "stream.started":
        this.#start();
        return;
      case "content":
      case "model.message.delta":
        this.#appendInline("text", event.chunk);
        return;
      case "reasoning":
      case "model.reasoning.delta":
        this.#appendInline("thinking", event.chunk);
        return;
      case "tool_call":
      case "model.tool_call.completed":
        this.#addToolCall(event.call);
        return;
      case "tool_calls":
        // Terminal aggregate. Every call it lists has already been emitted
        // individually; only a call the harness has not seen is added.
        for (const call of event.calls) this.#addToolCall(call);
        return;
      case "usage":
      case "model.usage":
        this.#usage = usageFromGateway(event.data, this.#usage);
        this.#partial.usage = this.#usage;
        return;
      case "model.completed":
        this.#finishReason = event.finishReason ?? null;
        return;
      case "stream.error":
        this.fail(studioGatewayErrorForStreamCode(event.error?.code));
        return;
      case "stream.completed":
      case "gateway.done":
        this.complete();
        return;
    }
  }

  /** Settles the turn successfully. Safe to call more than once. */
  complete(): void {
    if (this.#settled) return;
    this.#start();
    this.#closeOpenBlock();

    if ((this.#finishReason ?? "").toLowerCase() === "error") {
      this.fail(new StudioGatewayError("internal"));
      return;
    }

    const reason = stopReasonFor(this.#finishReason, this.#toolCallIds.size > 0);
    const message = this.#createMessage(reason);
    this.#settled = true;
    this.#events.push({ type: "done", reason, message });
  }

  /** Settles the turn as a failure. Safe to call more than once. */
  fail(error: unknown, reason: Extract<StopReason, "error" | "aborted"> = "error"): void {
    if (this.#settled) return;
    this.#settled = true;

    const message = this.#createMessage(reason);
    message.errorMessage =
      error instanceof StudioGatewayError
        ? error.message
        : reason === "aborted"
          ? "The Studio gateway request was cancelled."
          : "The Studio gateway request failed.";

    this.#events.push({ type: "error", reason, error: message });
  }

  #start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#events.push({ type: "start", partial: this.#partial });
  }

  #appendInline(kind: "text" | "thinking", chunk: string): void {
    if (!chunk) return;
    this.#start();

    if (this.#open?.kind !== kind) {
      this.#closeOpenBlock();
      const block: TextContent | ThinkingContent =
        kind === "text"
          ? { type: "text", text: "" }
          : { type: "thinking", thinking: "" };
      this.#content.push(block);
      this.#open = { kind, index: this.#content.length - 1 };
      this.#events.push({
        type: kind === "text" ? "text_start" : "thinking_start",
        contentIndex: this.#open.index,
        partial: this.#partial,
      });
    }

    const open = this.#open;
    const block = this.#content[open.index];
    if (kind === "text" && block?.type === "text") {
      block.text += chunk;
    } else if (kind === "thinking" && block?.type === "thinking") {
      block.thinking += chunk;
    }

    this.#events.push({
      type: kind === "text" ? "text_delta" : "thinking_delta",
      contentIndex: open.index,
      delta: chunk,
      partial: this.#partial,
    });
  }

  #closeOpenBlock(): void {
    const open = this.#open;
    if (!open) return;
    this.#open = undefined;

    const block = this.#content[open.index];
    if (open.kind === "text" && block?.type === "text") {
      this.#events.push({
        type: "text_end",
        contentIndex: open.index,
        content: block.text,
        partial: this.#partial,
      });
    } else if (open.kind === "thinking" && block?.type === "thinking") {
      this.#events.push({
        type: "thinking_end",
        contentIndex: open.index,
        content: block.thinking,
        partial: this.#partial,
      });
    }
  }

  #addToolCall(call: GatewayToolCall): void {
    if (!call?.id || this.#toolCallIds.has(call.id)) return;
    this.#start();
    this.#closeOpenBlock();
    this.#toolCallIds.add(call.id);

    const toolCall: ToolCall = {
      type: "toolCall",
      id: call.id,
      name: call.function?.name ?? "",
      arguments: parseArguments(call.function?.arguments),
    };
    this.#content.push(toolCall);
    const contentIndex = this.#content.length - 1;

    this.#events.push({ type: "toolcall_start", contentIndex, partial: this.#partial });
    this.#events.push({
      type: "toolcall_end",
      contentIndex,
      toolCall,
      partial: this.#partial,
    });
  }

  /**
   * Every message shares the live content array, so `partial` on each event
   * reflects the content accumulated so far without copying it per delta.
   */
  #createMessage(stopReason: StopReason): AssistantMessage {
    return {
      role: "assistant",
      content: this.#content,
      api: this.#api,
      provider: this.#provider,
      model: this.#modelId,
      usage: this.#usage,
      stopReason,
      timestamp: Date.now(),
    };
  }
}

function parseArguments(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
