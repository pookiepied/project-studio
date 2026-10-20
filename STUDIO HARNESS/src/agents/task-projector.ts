import { observe, type FlueObservation } from "@flue/runtime";

import {
  isSettledTaskStatus,
  type AgentTaskStatus,
} from "../contracts/agents.js";
import type { Logger } from "../observability/logger.js";
import type { JobPings } from "../process/job-pings.js";
import {
  TaskStore,
  type AgentTaskRecord,
} from "./definitions/task-store.js";

/**
 * The settlement projector for background agent tasks (ADR 0058 D5, S4.1).
 *
 * ---- What it is ------------------------------------------------------------
 *
 * The TaskStore's row is a projection, never a second opinion: Flue's stream
 * is the truth about what a task did, and this module is the subscriber that
 * keeps the projection honest. It watches the same process-global
 * observation bus the titler watches, routes what it sees by one question —
 * *does an indexed task live at this instance id?* — and writes what the
 * stream settled into. A settlement for an instance with no row is not this
 * module's business: rows exist only for dispatched background tasks, and
 * everything else on the bus (conversations, delegate children riding their
 * parent's instance id) has no row to settle.
 *
 * ---- The two events, and the order between them ----------------------------
 *
 * - `agent_end` carries the run's final messages. The last assistant text is
 *   captured here as the row's `result_summary` candidate — a pointer-shape
 *   sentence for the rail row and the finished-task ping, never the answer
 *   itself, which lives in the task's own stream.
 * - `submission_settled` carries the outcome. `completed` takes the captured
 *   summary; `failed` prefers the settlement's own error; `aborted` means
 *   somebody stopped it on purpose — the person's cancel route, or a
 *   durability timeout — and reads as `cancelled`.
 *
 * `agent_end` fires before the settlement (measured live in Phase 7 for the
 * titler, same envelope), so the capture is in hand when the settlement
 * spends it. A settlement without a capture settles anyway — the status is
 * the load-bearing half, and the summary is allowed to be absent.
 *
 * ---- Exactly once, twice over ----------------------------------------------
 *
 * Two deliveries ride on one settlement and neither may double:
 *
 * 1. **The row write is idempotent by the store's own rule** — a settled
 *    status re-written is the same answer (`COALESCE` keeps the first
 *    `settled_at` and summary). Recovery replaying a settlement after a
 *    restart lands on a row already settled and changes nothing.
 * 2. **The announce fires on the transition, not the event**: the row is
 *    read before it is settled, and only a row that was still live settles
 *    into a ping. A replayed settlement finds the row terminal and announces
 *    nothing — which is also the projector's half of the S4.5 rule that a
 *    replayed settlement never re-dispatches (nothing here dispatches at
 *    all; the dispatcher's own record is the other half).
 *
 * ---- Where the news goes ---------------------------------------------------
 *
 * To the parent conversation, through the JobPings hub — the third source,
 * with the drain that arbitrates the announcement against the other delivery
 * points owned by the hub's composition. A task with no parent conversation
 * (the background three: their results reach their callers directly) settles
 * silently into its row, which is the honest outcome: its news was never for
 * a conversation.
 */

/** How much of a task's final message the summary keeps. */
const MAX_SUMMARY_CHARS = 200;
/**
 * How much of a voice worker's final message reaches the voice agent. A voice
 * task's result is the answer the voice agent speaks, not news about it: a
 * first-line summary handed it a heading where a weather report should be.
 */
const MAX_VOICE_RESULT_CHARS = 6_000;
const LIFECYCLE_EVENTS = new Set(["agent_start", "agent_end", "task_start", "task", "tool_start", "tool", "turn_start", "submission_settled"]);

/**
 * One running agent task, as a line for the turn's environment block.
 *
 * Beside the running commands and generations, for the same reason they are
 * named: current state, so a turn that knows a task is under way neither
 * starts a duplicate nor promises a result nobody is producing. A read, not
 * a drain — the running task is named every turn while it runs, and its
 * ending arrives through the ping, not here.
 */
export function taskRunningLine(record: AgentTaskRecord): string {
  return `Task "${record.title}" is running in the background.${record.agentName === "voice-work" ? ` Task id: ${record.id}.` : ""}`;
}

/**
 * One ended agent task, as a line for the finished-task announcement.
 *
 * The same wording the environment block would have carried, for the same
 * reason the shell line is shared between its two delivery points: whichever
 * of them tells the model, the sentence reads the same. The summary is the
 * pointer-shape sentence the projector captured, never the full answer — the
 * task's own stream is where the answer lives.
 */
export function taskEndedLine(record: AgentTaskRecord): string {
  // A voice result is multi-line by nature; it rides as a block after the
  // sentence rather than inside it.
  if (record.agentName === "voice-work" && record.status === "completed" && record.resultSummary !== undefined) {
    return `Task "${record.title}" completed. Task id: ${record.id}. Result:\n${record.resultSummary}`;
  }
  const how =
    record.status === "completed"
      ? record.resultSummary === undefined
        ? "completed"
        : `completed: ${record.resultSummary}`
      : record.status === "failed"
        ? record.resultSummary === undefined
          ? "failed"
          : `failed: ${record.resultSummary}`
        : record.status === "cancelled"
          ? "was stopped"
          : "settled";
  return `Task "${record.title}" ${how}.${record.agentName === "voice-work" ? ` Task id: ${record.id}.` : ""}`;
}

/**
 * One line, one sentence: newlines are the rail row's and the ping's enemies
 * alike, and a model reply that happens to be five lines should not become
 * five sentences of news.
 */
function summaryFromReply(reply: string): string | undefined {
  return truncateSummary(reply.trim().split(/\r?\n/, 1)[0]?.trim() ?? "");
}

/** A voice worker's whole reply, bounded, with any shortening said out loud. */
function voiceResultFromReply(reply: string): string | undefined {
  const text = reply.trim();
  if (text === "") return undefined;
  return text.length > MAX_VOICE_RESULT_CHARS
    ? `${text.slice(0, MAX_VOICE_RESULT_CHARS)}\n[Result shortened; the full text is in the task's details.]`
    : text;
}

/** The cap, shared with the error path: a settlement's reason is bounded the
 * same way its reply is, or a provider's error blob rides the ping whole. */
function truncateSummary(sentence: string): string | undefined {
  if (sentence === "") return undefined;
  return sentence.length > MAX_SUMMARY_CHARS
    ? `${sentence.slice(0, MAX_SUMMARY_CHARS)}…`
    : sentence;
}

/** The last assistant text of a run, read the way the titler reads its reply. */
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
    if (text.trim() === "") return undefined;
    return text;
  }
  return undefined;
}

export interface TaskProjectorOptions {
  readonly tasks: TaskStore;
  /**
   * The finished-job hub, for announcing a settled task to the conversation
   * its dispatch named. Undefined when the harness was composed without a
   * delivery port — rows still settle; nobody is woken.
   */
  readonly pings?: JobPings | undefined;
  readonly logger?: Logger | undefined;
  /**
   * Defaults to the runtime's own live subscription. Tests inject a queue so
   * settlements can be driven without a running Flue, exactly as the
   * titler's tests do.
   */
  readonly subscribe?: (handler: (observation: FlueObservation) => void) => () => void;
}

export interface TaskActivity {
  readonly id: string;
  readonly agentName: string;
  readonly parentConversationId: string;
  readonly stage: "working" | "using_tool" | "waiting_for_model" | "completed" | "failed" | "cancelled";
  readonly updatedAt: number;
  readonly createdAt: number;
  /** A voice task's short name, the one its voice agent uses. */
  readonly name?: string;
}

export class TaskProjector {
  readonly #tasks: TaskStore;
  readonly #pings: JobPings | undefined;
  readonly #logger: Logger | undefined;
  readonly #subscribe: NonNullable<TaskProjectorOptions["subscribe"]>;
  /**
   * Replies captured off each task run's `agent_end`, keyed by the run's
   * instance id and consumed by that run's settlement. Bounded like the
   * titler's stash: an entry lives only until its submission settles, and a
   * task that settles without a capture (a crash, a lost end event) simply
   * settles without a summary.
   */
  readonly #replies = new Map<string, string>();
  readonly #activity = new Map<string, TaskActivity>();
  #unsubscribe: (() => void) | undefined;

  constructor(options: TaskProjectorOptions) {
    this.#tasks = options.tasks;
    this.#pings = options.pings;
    this.#logger = options.logger;
    this.#subscribe =
      options.subscribe ??
      ((handler) =>
        observe((observation) => {
          handler(observation);
        }));
  }

  /** Begins watching for task settlements. Idempotent. */
  start(): void {
    if (this.#unsubscribe !== undefined) return;
    this.#unsubscribe = this.#subscribe((observation) => {
      try {
        this.#onObservation(observation);
      } catch (error) {
        // A projection fault must never break the emission path it is called
        // from; the row keeps its previous status and the log line is ours
        // to write.
        this.#logger?.warn("The task projector observed a fault.", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  /** Stops watching. In-flight tasks settle on their own stream. */
  stop(): void {
    const unsubscribe = this.#unsubscribe;
    this.#unsubscribe = undefined;
    unsubscribe?.();
    this.#activity.clear();
  }

  /** Product lifecycle facts only; prompts, arguments and private reasoning never enter this view. */
  activity(conversationId: string): readonly TaskActivity[] {
    return [...this.#activity.values()].filter((task) => task.parentConversationId === conversationId).slice(-64);
  }

  #onObservation(observation: FlueObservation): void {
    if (!LIFECYCLE_EVENTS.has(observation.type)) return;
    const instanceId = observation.instanceId;
    if (typeof instanceId !== "string" || instanceId === "") return;

    const indexed = this.#tasks.get(instanceId);
    // A steered delivery has its own receipt, but only the host submission
    // settling proves that the worker's execution has ended.
    if (observation.type === "submission_settled" && indexed?.originSubmissionId !== undefined && indexed.originSubmissionId !== observation.submissionId) return;
    const id = observation.taskId ?? (indexed === undefined ? undefined : instanceId);
    const activityParent = indexed?.parentConversationId ?? (observation.taskId === undefined ? undefined : instanceId);
    if (id !== undefined && activityParent !== undefined) {
      const stage = observation.type === "task_start" || observation.type === "agent_start" ? "working"
        : observation.type === "tool_start" ? "using_tool"
        : observation.type === "tool" || observation.type === "turn_start" ? "waiting_for_model"
        : observation.type === "task" ? (observation.isError ? "failed" : "completed")
        : observation.type === "submission_settled" ? (observation.outcome === "aborted" ? "cancelled" : observation.outcome)
        : undefined;
      if (stage !== undefined) {
        const previous = this.#activity.get(id);
        if (previous !== undefined && ["completed", "failed", "cancelled"].includes(previous.stage)) return;
        const now = Date.now();
        this.#activity.set(id, { id, parentConversationId: activityParent,
          agentName: indexed?.agentName ?? (observation.type === "task_start" ? observation.agent : undefined) ?? previous?.agentName ?? "delegate",
          stage, updatedAt: now, createdAt: previous?.createdAt ?? now,
          ...(indexed?.agentName === "voice-work" ? { name: indexed.title } : {}) });
        if (this.#activity.size > 512) this.#activity.delete(this.#activity.keys().next().value ?? "");
      }
    }

    if (observation.type === "agent_end") {
      // Only indexed tasks are stashed for: every conversation turn also
      // ends, and a stash that grew with those would churn its bound and
      // could evict a real task's capture before its settlement spends it.
      if (this.#tasks.get(instanceId) === undefined) return;
      const reply = lastAssistantText(observation.messages);
      if (reply === undefined) return;
      // Bounded: the entry is consumed by the settlement below, and the
      // oldest is dropped when a task settles without this projector seeing
      // it — the same trade the titler's stash makes.
      if (this.#replies.size >= 50) {
        const oldest = this.#replies.keys().next();
        if (!oldest.done) this.#replies.delete(oldest.value);
      }
      this.#replies.set(instanceId, reply);
      return;
    }

    if (observation.type !== "submission_settled") return;
    const row = this.#tasks.get(instanceId);
    if (row === undefined) return;

    // The transition check is the announce's exactly-once and the replay's
    // no-op, both: a row already terminal has been settled before, by this
    // process or by a recovery replay, and neither a second write nor a
    // second ping can improve on the first.
    const settled = isSettledTaskStatus(row.status);
    if (settled) return;

    const reply = this.#replies.get(instanceId);
    this.#replies.delete(instanceId);

    let status: AgentTaskStatus;
    let summary: string | undefined;
    switch (observation.outcome) {
      case "completed":
        status = "completed";
        summary = reply === undefined ? undefined : row.agentName === "voice-work" ? voiceResultFromReply(reply) : summaryFromReply(reply);
        break;
      case "failed":
        status = "failed";
        summary =
          observation.error?.message !== undefined
            ? truncateSummary(observation.error.message)
            : reply === undefined
              ? undefined
              : summaryFromReply(reply);
        break;
      case "aborted":
        status = "cancelled";
        summary = undefined;
        break;
    }

    this.#tasks.setStatus(instanceId, status, summary);
    this.#logger?.info("Agent task settled.", {
      task_id: instanceId,
      agent_name: row.agentName,
      status,
    });

    const parent = row.parentConversationId;
    if (parent !== undefined && this.#pings !== undefined) {
      // Fire-and-forget by the hub's own contract: the drain collects from
      // every source, whichever delivery point wins carries the ending, and
      // a delivery failure is the hub's to report.
      this.#pings.announce(parent);
    }
  }
}
