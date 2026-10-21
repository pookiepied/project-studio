import { observe, type FlueObservation } from "@flue/runtime";

import {
  isSettledTaskStatus,
  type AgentTaskStatus,
} from "../contracts/agents.js";
import type { Logger } from "../observability/logger.js";
import { redactGenAiContent, redactSensitiveString } from "../observability/redaction.js";
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
const LIFECYCLE_EVENTS = new Set(["agent_start", "agent_end", "task_start", "task", "tool_start", "tool", "turn_start", "message_end", "submission_settled"]);
/**
 * The trail's bounds. A parent reads where a task is, not its whole history:
 * the task's own stream holds that. Per entry, per task, and how many tasks
 * keep one, so the worst case stays a few megabytes of process memory.
 */
const TRAIL_ENTRY_CHARS = 600;
const TRAIL_ENTRIES_PER_TASK = 48;
const TRAIL_TASKS = 64;
const TRAIL_READ_DEFAULT = 12;
const TRAIL_READ_MAX = 32;
/** The model-facing names of Studio's computer tools end in the action. */
const COMPUTER_TOOL = /studio_computer_[a-z_]+$/;
/**
 * Tools whose arguments are text or keys typed for the person: a password
 * the task was given travels this way, and an argument field has no name a
 * key-based redaction could catch.
 */
const TYPED_ARGUMENTS = /(?:_type|_key|_hold_key|_clipboard|_fill|_set_value)$/;

/**
 * One running agent task, as a line for the turn's environment block.
 *
 * Beside the running commands and generations, for the same reason they are
 * named: current state, so a turn that knows a task is under way neither
 * starts a duplicate nor promises a result nobody is producing. A read, not
 * a drain — the running task is named every turn while it runs, and its
 * ending arrives through the ping, not here.
 */
export function taskRunningLine(record: AgentTaskRecord, latest?: TaskTrailEntry, now = Date.now()): string {
  if (record.agentName !== "voice-work") return `Task "${record.title}" is running in the background.`;
  // The voice agent's answer to "how is it going" without a tool call: the
  // step it would have inspected for, named but never quoted.
  const step = latest === undefined ? "" : ` Latest step, ${String(Math.max(0, Math.round((now - latest.at) / 1000)))}s ago: ${stepPhrase(latest)}.`;
  return `Task "${record.title}" is running in the background. Task id: ${record.id}.${step}`;
}

/** A trail entry as a few words, with the model-facing tool name shortened. */
function stepPhrase(entry: TaskTrailEntry): string {
  const tool = entry.tool?.replace(/^mcp__.+?__\d+_/, "") ?? "a tool";
  switch (entry.kind) {
    case "started": return "started";
    case "said": return "wrote a progress message";
    case "tool_call": return `using ${tool}`;
    case "tool_result": return `${tool} ${entry.isError === true ? "failed" : "finished"}`;
    case "ended": return "finishing";
  }
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
  /**
   * The task has driven the desktop during this run. Sticky until it
   * settles, for the main turn's reason: between two computer calls the
   * agent is still deciding what to do to the same desktop.
   */
  readonly computer?: true;
  /**
   * The worker an inline delegate runs inside, when it is one: a voice
   * task's own delegate is the conversation's to see, but stopping it means
   * cancelling the worker, which has the submission to cancel.
   */
  readonly owner?: string;
}

/** One step of a task's recent work, as a parent may read it. */
export interface TaskTrailEntry {
  /** Process-local order, and the cursor a later read resumes after. */
  readonly sequence: number;
  readonly at: number;
  readonly kind: "started" | "said" | "tool_call" | "tool_result" | "ended";
  readonly tool?: string;
  readonly isError?: boolean;
  readonly durationMs?: number;
  /** Bounded and redacted; reasoning never enters it. */
  readonly text?: string;
}

export interface TaskInspection {
  readonly available: boolean;
  readonly task?: TaskActivity;
  readonly entries: readonly TaskTrailEntry[];
  /** Pass as `after` to read only what happened since this read. */
  readonly cursor: number;
  /** Steps after the requested cursor that the bounded trail already dropped. */
  readonly earlierDropped: boolean;
  /** More retained steps follow the last one returned. */
  readonly more: boolean;
}

/** Shortens one trail text, saying so, after redaction has run on the whole. */
function bounded(text: string): string | undefined {
  const redacted = redactSensitiveString(text.trim());
  if (redacted === "") return undefined;
  return redacted.length > TRAIL_ENTRY_CHARS ? `${redacted.slice(0, TRAIL_ENTRY_CHARS)}... [shortened]` : redacted;
}

/** A tool call's arguments, without typed text and without secret-named fields. */
function argumentText(toolName: string, args: unknown): string | undefined {
  if (args === undefined) return undefined;
  if (TYPED_ARGUMENTS.test(toolName)) return "[arguments omitted: typed text or keys]";
  try {
    // The JSON is cut before redaction so an enormous argument is never
    // serialized whole twice; key-named secrets are dropped before either.
    return bounded(JSON.stringify(redactGenAiContent(args)).slice(0, TRAIL_ENTRY_CHARS * 2));
  } catch {
    return "[arguments unavailable]";
  }
}

/** A tool result's text parts; images are named, never copied. */
function resultText(result: unknown): string | undefined {
  if (typeof result === "string") return bounded(result);
  const content: unknown = typeof result === "object" && result !== null && "content" in result ? result.content : undefined;
  if (!Array.isArray(content)) return undefined;
  const parts: readonly unknown[] = content;
  const texts: string[] = [];
  let images = 0;
  for (const part of parts) {
    if (typeof part !== "object" || part === null || !("type" in part)) continue;
    if (part.type === "image") images += 1;
    else if (part.type === "text" && "text" in part && typeof part.text === "string") texts.push(part.text);
    if (texts.join("\n").length > TRAIL_ENTRY_CHARS * 2) break;
  }
  const note = images === 0 ? "" : `\n[${images} image${images === 1 ? "" : "s"} omitted]`;
  return bounded(`${texts.join("\n").slice(0, TRAIL_ENTRY_CHARS * 2)}${note}`);
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
  /**
   * Each task's recent steps, keyed like `#activity`. Process memory only:
   * a restart, an eviction or an unobserved event leaves a gap, and a read
   * says so rather than inventing the missing steps.
   */
  readonly #trails = new Map<string, { entries: TaskTrailEntry[]; dropped: number }>();
  #sequence = 0;
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
    this.#trails.clear();
  }

  /** Product lifecycle facts only; prompts, arguments and private reasoning never enter this view. */
  activity(conversationId: string): readonly TaskActivity[] {
    return [...this.#activity.values()].filter((task) => task.parentConversationId === conversationId).slice(-64);
  }

  /** A task's newest observed step, for its running line; process memory, like the trail. */
  latestStep(taskId: string): TaskTrailEntry | undefined {
    return this.#trails.get(taskId)?.entries.at(-1);
  }

  /**
   * One task's recent steps, for the conversation that owns it and nobody
   * else. A read of what was observed, never a replay: nothing here runs,
   * resends or reaches the task. Bounded per entry and per read, redacted,
   * and without reasoning, because the reader is a model's context.
   */
  inspect(conversationId: string, taskId: string, options: { readonly after?: number | undefined; readonly limit?: number | undefined } = {}): TaskInspection {
    const task = this.#activity.get(taskId);
    if (task === undefined || task.parentConversationId !== conversationId) {
      return { available: false, entries: [], cursor: options.after ?? 0, earlierDropped: false, more: false };
    }
    const trail = this.#trails.get(taskId);
    const after = options.after ?? 0;
    const limit = Math.max(1, Math.min(TRAIL_READ_MAX, Math.floor(options.limit ?? TRAIL_READ_DEFAULT)));
    const newer = (trail?.entries ?? []).filter((entry) => entry.sequence > after);
    // Without a cursor a parent wants where the task is now, so the newest
    // steps win; with one, it wants what follows the cursor, oldest first.
    const entries = options.after === undefined ? newer.slice(-limit) : newer.slice(0, limit);
    const last = entries.at(-1)?.sequence ?? after;
    return {
      available: true,
      task,
      entries,
      cursor: last,
      earlierDropped: trail === undefined || trail.dropped > after,
      more: newer.some((entry) => entry.sequence > last),
    };
  }

  #trail(id: string, entry: Omit<TaskTrailEntry, "sequence" | "at">): void {
    let trail = this.#trails.get(id);
    if (trail === undefined) {
      trail = { entries: [], dropped: 0 };
      this.#trails.set(id, trail);
      if (this.#trails.size > TRAIL_TASKS) this.#trails.delete(this.#trails.keys().next().value ?? "");
    }
    trail.entries.push({ sequence: ++this.#sequence, at: Date.now(), ...entry });
    if (trail.entries.length > TRAIL_ENTRIES_PER_TASK) trail.dropped = trail.entries.shift()?.sequence ?? trail.dropped;
  }

  #recordStep(id: string, observation: FlueObservation): void {
    switch (observation.type) {
      case "task_start":
        this.#trail(id, { kind: "started", ...(observation.agent === undefined ? {} : { tool: observation.agent }) });
        return;
      case "agent_start":
        if (!this.#trails.has(id)) this.#trail(id, { kind: "started" });
        return;
      case "message_end": {
        const message = observation.message;
        if (message.role !== "assistant") return;
        // Text parts only: thinking is the provider's private reasoning, and
        // tool calls arrive on their own `tool_start` with their arguments.
        const text = message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
        const said = bounded(text);
        if (said !== undefined) this.#trail(id, { kind: "said", text: said });
        return;
      }
      case "tool_start": {
        const args = argumentText(observation.toolName, observation.args);
        this.#trail(id, { kind: "tool_call", tool: observation.toolName, ...(args === undefined ? {} : { text: args }) });
        return;
      }
      case "tool": {
        const text = resultText(observation.result);
        this.#trail(id, { kind: "tool_result", tool: observation.toolName, isError: observation.isError,
          durationMs: observation.durationMs, ...(text === undefined ? {} : { text }) });
        return;
      }
      case "task":
        this.#trail(id, { kind: "ended", isError: observation.isError, text: observation.isError ? "failed" : "completed" });
        return;
      case "submission_settled":
        this.#trail(id, { kind: "ended", isError: observation.outcome === "failed", text: observation.outcome === "aborted" ? "cancelled" : observation.outcome });
        return;
      default:
        return;
    }
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
      const previous = this.#activity.get(id);
      const ended = previous !== undefined && ["completed", "failed", "cancelled"].includes(previous.stage);
      if (stage !== undefined) {
        if (ended) return;
        const now = Date.now();
        const computer = previous?.computer === true || (observation.type === "tool_start" && COMPUTER_TOOL.test(observation.toolName));
        this.#activity.set(id, { id, parentConversationId: activityParent,
          agentName: indexed?.agentName ?? (observation.type === "task_start" ? observation.agent : undefined) ?? previous?.agentName ?? "delegate",
          stage, updatedAt: now, createdAt: previous?.createdAt ?? now,
          ...(indexed?.agentName === "voice-work" ? { name: indexed.title } : {}),
          ...(computer ? { computer: true as const } : {}),
          ...(indexed !== undefined && observation.taskId !== undefined && observation.taskId !== instanceId ? { owner: instanceId } : {}) });
        if (this.#activity.size > 512) this.#activity.delete(this.#activity.keys().next().value ?? "");
      }
      if (!ended && this.#activity.has(id)) this.#recordStep(id, observation);
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
