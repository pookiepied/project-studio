import { StudioGatewayError } from "./errors.js";
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
 *
 * This module owns the gateway's wire vocabulary only. Projecting it onto Pi's
 * assistant-message protocol belongs to `event-mapper.ts`, so the wire contract
 * can change with the gateway without touching the Pi mapping, and neither
 * concern imports the other's types.
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
