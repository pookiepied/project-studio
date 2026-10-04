import { createStudioUuid } from "../contracts/uuid.js";

import { observe, type FlueObservation } from "@flue/runtime";

import { dispatchBackgroundAgent } from "../agents/definitions/dispatch.js";
import { AgentRegistryError } from "../agents/definitions/registry.js";
import type { TaskStore } from "../agents/definitions/task-store.js";
import { DESCRIBE_AGENT_ID } from "../contracts/agents.js";
import { StudioError } from "../contracts/errors.js";
import { normalizeTags } from "./store.js";

/**
 * One picture in, a proposed label out, while the caller waits.
 *
 * The text improver's mechanism, applied to the library: dispatch the
 * describe agent under a fresh take id with the picture attached, watch the
 * process-global observation bus for that id's `agent_end` and settlement,
 * and resolve the caller's promise with the parsed proposal - or reject it
 * once, when the run failed, produced nothing readable, or took longer than
 * the agent's own timeout.
 *
 * Nothing is persisted here and nothing is decided: the proposal is an
 * offer the dialog shows, and only what the person confirms reaches the
 * store. In particular a `subject` is never read off the reply: the prompt
 * forbids identifying anyone, and the parser has no field for it even when
 * the model disobeys.
 */

export interface ImageDescription {
  readonly title: string;
  readonly description: string;
  readonly tags: readonly string[];
}

export interface ImageDescriberPort {
  /** A proposal for one picture. Rejects with a `DescribeError` the route can speak. */
  describe(image: { readonly data: string; readonly mimeType: string; readonly hint?: string }): Promise<ImageDescription>;
}

export class DescribeError extends StudioError {
  readonly domain = "media" as const;

  constructor(kind: "bad-input" | "model-failed", message: string) {
    super(kind, message, { retryable: kind === "model-failed" });
    this.name = "DescribeError";
  }
}

/** The agent's own durability timeout, plus a little for the bus. */
const REPLY_TIMEOUT_MS = 47_000;

const FENCED_REPLY = /^```[A-Za-z0-9_-]*[ \t]*\r?\n([\s\S]*?)\r?\n?```$/;

function unfenceReply(reply: string): string {
  const fenced = FENCED_REPLY.exec(reply.trim());
  return fenced?.[1] ?? reply;
}

/** The proposal, read off the agent's reply; undefined for anything else. */
export function descriptionFromReply(reply: string): ImageDescription | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenceReply(reply));
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title.trim() : "";
  const description = typeof record.description === "string" ? record.description.trim() : "";
  const tags = Array.isArray(record.tags)
    ? normalizeTags(record.tags.filter((tag): tag is string => typeof tag === "string"))
    : [];
  if (title === "" && description === "" && tags.length === 0) return undefined;
  return { title, description, tags };
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

export interface DescribeRequest {
  readonly data: string;
  readonly mimeType: string;
  /** Words beside the picture - the file's name, or what the person typed. */
  readonly hint?: string;
}

export interface ImageDescriberOptions {
  readonly subscribe?: (handler: (observation: FlueObservation) => void) => () => void;
  readonly dispatchJob?: (takeId: string, request: DescribeRequest) => Promise<void>;
  readonly timeoutMs?: number;
  /**
   * The task index the default dispatch records its row into (S4.3: the
   * dispatcher indexes every dispatched task). Injected `dispatchJob` tests
   * need none — the injection replaces the dispatch whole.
   */
  readonly tasks?: TaskStore;
}

interface Waiting {
  readonly resolve: (description: ImageDescription) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
  reply: string | undefined;
}

/** What the model is told beside the picture; the file name is a hint, not an instruction. */
function messageFor(request: DescribeRequest): string {
  const hint = request.hint?.trim() ?? "";
  return hint === "" ? "Describe this image." : `Describe this image. Its file name is: ${hint.slice(0, 160)}`;
}

export class ImageDescriber implements ImageDescriberPort {
  readonly #subscribe: NonNullable<ImageDescriberOptions["subscribe"]>;
  readonly #dispatchJob: NonNullable<ImageDescriberOptions["dispatchJob"]>;
  readonly #timeoutMs: number;
  readonly #waiting = new Map<string, Waiting>();
  #unsubscribe: (() => void) | undefined;

  constructor(options: ImageDescriberOptions = {}) {
    this.#subscribe =
      options.subscribe ??
      ((handler) =>
        observe((observation) => {
          handler(observation);
        }));
    this.#dispatchJob =
      options.dispatchJob ??
      (async (takeId, request) => {
        const tasks = options.tasks;
        if (tasks === undefined) {
          throw new AgentRegistryError(
          "invalid",
          "The describer composition gave no task index; the dispatcher cannot record the run.",
        );
        }
        await dispatchBackgroundAgent(DESCRIBE_AGENT_ID, takeId, {
          kind: "user",
          body: messageFor(request),
          attachments: [{ type: "image", data: request.data, mimeType: request.mimeType }],
        }, { tasks });
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
      waiting.reject(new DescribeError("model-failed", "Studio is shutting down."));
      this.#waiting.delete(takeId);
    }
  }

  async describe(request: DescribeRequest): Promise<ImageDescription> {
    if (request.data.trim() === "" || !request.mimeType.toLowerCase().startsWith("image/")) {
      throw new DescribeError("bad-input", "Only an image can be described.");
    }
    if (this.#unsubscribe === undefined) this.start();

    // A take id that cannot collide with a conversation's or an improve take's.
    const takeId = `dsc_${createStudioUuid()}`;
    const answer = new Promise<ImageDescription>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiting.delete(takeId);
        reject(new DescribeError("model-failed", "The model did not answer in time."));
      }, this.#timeoutMs);
      this.#waiting.set(takeId, { resolve, reject, timer, reply: undefined });
    });

    try {
      await this.#dispatchJob(takeId, request);
    } catch (error) {
      this.#settle(takeId, (waiting) =>
        waiting.reject(
          new DescribeError(
            "model-failed",
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
    if (observation.agentName !== DESCRIBE_AGENT_ID) return;
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
        waiting.reject(new DescribeError("model-failed", "The model did not finish."));
        return;
      }
      const description = waiting.reply === undefined ? undefined : descriptionFromReply(waiting.reply);
      if (description === undefined) {
        waiting.reject(new DescribeError("model-failed", "The model answered outside the shape asked for."));
        return;
      }
      waiting.resolve(description);
    });
  }
}
