import { createStudioUuid } from "../contracts/uuid.js";

import { observe, type FlueObservation } from "@flue/runtime";

import { dispatchBackgroundAgent } from "../agents/definitions/dispatch.js";
import { IMPROVE_AGENT_ID } from "../contracts/agents.js";
import { StudioError } from "../contracts/errors.js";

/**
 * One dictated passage in, the tidied passage out, while the caller waits.
 *
 * The title agent is fire-and-observe: the orchestrator learns the answer
 * later and writes it somewhere. Improve is a request: the composer asked,
 * and is holding the field until the answer comes. So this dispatches the
 * agent under a fresh take id, watches the process-global observation bus
 * for that id's `agent_end` and settlement, and resolves the caller's promise
 * with the reply - or rejects it, once, when the run failed, produced nothing
 * readable, or took longer than the agent's own timeout.
 *
 * Nothing is persisted here: no message, no turn, no title. The run's own
 * stream is the agent's (`agents/improve/<take id>`), and what crosses back
 * is the parsed text and only that. The bus is subscribed once for the
 * improver's lifetime, not per request, because `observe` is a global hook
 * and a subscription per request would leak one on every timeout.
 */

export interface TextImproverPort {
  /** The passage, tidied. Rejects with an `ImproveError` the route can speak. */
  improve(text: string): Promise<string>;
}

/**
 * Why a passage was not improved: `bad-input` is the caller's to fix (empty,
 * or not a passage), `model-failed` is the model's - it did not answer, did
 * not finish, or answered outside the shape asked for.
 */
export class ImproveError extends StudioError {
  readonly domain = "media" as const;

  constructor(kind: "bad-input" | "model-failed", message: string) {
    super(kind, message, { retryable: kind === "model-failed" });
    this.name = "ImproveError";
  }
}

/** Longer than this is not a dictated passage; the agent is not a document editor. */
export const MAX_IMPROVE_CHARS = 4_000;

/** The agent's own durability timeout, plus a little for the bus. */
const REPLY_TIMEOUT_MS = 32_000;

const FENCED_REPLY = /^```[A-Za-z0-9_-]*[ \t]*\r?\n([\s\S]*?)\r?\n?```$/;

function unfenceReply(reply: string): string {
  const fenced = FENCED_REPLY.exec(reply.trim());
  return fenced?.[1] ?? reply;
}

/** The tidied text, read off the agent's reply; undefined for anything else. */
export function improvedTextFromReply(reply: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenceReply(reply));
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  const entries: [string, unknown][] = Object.entries(parsed);
  if (entries.length !== 1) return undefined;
  const [name, value] = entries[0] ?? [];
  if (name !== "text" || typeof value !== "string") return undefined;
  const text = value.trim();
  return text === "" ? undefined : text;
}

function lastAssistantText(
  messages: Extract<FlueObservation, { type: "agent_end" }>["messages"],
): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message === undefined || message.role !== "assistant") continue;
    const text = message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("");
    return text.trim() === "" ? undefined : text;
  }
  return undefined;
}

export interface TextImproverOptions {
  readonly subscribe?: (handler: (observation: FlueObservation) => void) => () => void;
  readonly dispatchJob?: (takeId: string, text: string) => Promise<void>;
  readonly timeoutMs?: number;
}

interface Waiting {
  readonly resolve: (text: string) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
  reply: string | undefined;
}

export class TextImprover implements TextImproverPort {
  readonly #subscribe: NonNullable<TextImproverOptions["subscribe"]>;
  readonly #dispatchJob: NonNullable<TextImproverOptions["dispatchJob"]>;
  readonly #timeoutMs: number;
  readonly #waiting = new Map<string, Waiting>();
  #unsubscribe: (() => void) | undefined;

  constructor(options: TextImproverOptions = {}) {
    this.#subscribe =
      options.subscribe ??
      ((handler) =>
        observe((observation) => {
          handler(observation);
        }));
    this.#dispatchJob =
      options.dispatchJob ??
      (async (takeId, text) => {
        await dispatchBackgroundAgent(IMPROVE_AGENT_ID, takeId, text);
      });
    this.#timeoutMs = options.timeoutMs ?? REPLY_TIMEOUT_MS;
  }

  start(): void {
    if (this.#unsubscribe !== undefined) return;
    this.#unsubscribe = this.#subscribe((observation) => this.#onObservation(observation));
  }

  stop(): void {
    const unsubscribe = this.#unsubscribe;
    this.#unsubscribe = undefined;
    unsubscribe?.();
    for (const [takeId, waiting] of this.#waiting) {
      clearTimeout(waiting.timer);
      waiting.reject(new ImproveError("model-failed", "Studio is shutting down."));
      this.#waiting.delete(takeId);
    }
  }

  async improve(text: string): Promise<string> {
    const passage = text.trim();
    if (passage === "") throw new ImproveError("bad-input", "There is nothing to improve.");
    if (passage.length > MAX_IMPROVE_CHARS) {
      throw new ImproveError("bad-input",
        `That is longer than a dictated passage (${String(MAX_IMPROVE_CHARS)} characters at most).`,
      );
    }
    if (this.#unsubscribe === undefined) this.start();

    // A take id that cannot collide with a conversation's: the webview mints
    // `cnv_<uuid>`, and this prefix is not that.
    const takeId = `imp_${createStudioUuid()}`;
    const answer = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiting.delete(takeId);
        reject(new ImproveError("model-failed", "The model did not answer in time."));
      }, this.#timeoutMs);
      this.#waiting.set(takeId, { resolve, reject, timer, reply: undefined });
    });

    try {
      await this.#dispatchJob(takeId, passage);
    } catch (error) {
      this.#settle(takeId, (waiting) =>
        waiting.reject(
          new ImproveError("model-failed",
            `The model could not be asked: ${error instanceof Error ? error.message : String(error)}`,
          ),
        ),
      );
    }
    return answer;
  }

  #settle(takeId: string, finish: (waiting: Waiting) => void): void {
    const waiting = this.#waiting.get(takeId);
    if (waiting === undefined) return;
    this.#waiting.delete(takeId);
    clearTimeout(waiting.timer);
    finish(waiting);
  }

  #onObservation(observation: FlueObservation): void {
    if (observation.agentName !== IMPROVE_AGENT_ID) return;
    const takeId = observation.instanceId;
    if (typeof takeId !== "string" || !this.#waiting.has(takeId)) return;

    if (observation.type === "agent_end") {
      const waiting = this.#waiting.get(takeId);
      if (waiting !== undefined) waiting.reply = lastAssistantText(observation.messages);
      return;
    }
    if (observation.type !== "submission_settled") return;

    this.#settle(takeId, (waiting) => {
      if (observation.outcome !== "completed") {
        waiting.reject(new ImproveError("model-failed", "The model did not finish."));
        return;
      }
      const text = waiting.reply === undefined ? undefined : improvedTextFromReply(waiting.reply);
      if (text === undefined) {
        waiting.reject(new ImproveError("model-failed", "The model answered outside the shape asked for."));
        return;
      }
      waiting.resolve(text);
    });
  }
}
