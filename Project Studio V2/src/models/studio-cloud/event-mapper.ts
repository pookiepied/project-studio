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
import type {
  GatewayToolCall,
  GatewayUsage,
  StudioStreamEvent,
} from "./stream-events.js";

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
 * It consumes the wire vocabulary defined in `stream-events.ts` and owns only
 * the projection onto Pi. It never executes a tool: completed tool calls become
 * content on the assistant message and the turn ends with `toolUse` so Flue's
 * agent loop owns execution and continuation.
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
