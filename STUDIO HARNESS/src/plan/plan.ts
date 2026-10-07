/**
 * The shape of a conversation's plan.
 *
 * A plan is the run's stated intention, written as items the person can see
 * and tick. It is durable state, not a message: the store is the truth, the
 * model writes into it, the person writes into it, and every reader - the
 * panel, the tool's own result, a process that starts next week - reads the
 * same rows. Nothing renders from a transcript, so nothing is lost when the
 * message scrolls away or the process dies.
 *
 * The plan belongs to the conversation, not to the run that happened to write
 * it. A second run in the same conversation continues the same list, which is
 * why nothing here names a run or a turn.
 */

/**
 * Where an item stands, in the artifact vocabulary: `pending | running | done
 * | failed | cancelled`. The five were chosen once, over eleven synonyms, and
 * a second vocabulary for the same question would drift back toward eleven.
 */
export type PlanStatus =
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "cancelled";

/** Every status the vocabulary holds, for validation at the boundaries. */
export const PLAN_STATUSES: readonly PlanStatus[] = [
  "pending",
  "running",
  "done",
  "failed",
  "cancelled",
];

/**
 * Who last touched an item.
 *
 * The model's own result carries this, so it can tell "they did that one
 * already" from "I must have done that and forgotten" - the one channel by
 * which a person's tick reaches the model is the next plan write's answer.
 *
 * Since Stage 5 (S5.2) the dimension has a third value: a delegate that
 * writes the plan is recorded as `agent:<agentName>` — `agent:plan` for the
 * planning delegate — so a row says which writer kind touched it AND which
 * agent, and the parent's own writes stay distinguishable from its
 * delegates'. The stored column is this string verbatim; the store's
 * read-side parser is the one place the vocabulary is enforced, and a row
 * carrying anything else makes the whole plan `damaged`.
 */
export type PlanWriter = "model" | "person" | `agent:${string}`;

/** One item as the model writes it: an id it chose, the words, and a status. */
export interface PlanItemWrite {
  /**
   * The model's own stable slug for the item. An id it has used before
   * addresses the same item, which is what makes a write a merge rather than
   * a replacement.
   */
  readonly id: string;
  readonly text: string;
  readonly status: PlanStatus;
}

/** One item as stored, with the facts only the store can vouch for. */
export interface StoredPlanItem {
  readonly id: string;
  readonly text: string;
  readonly status: PlanStatus;
  /** First-seen order, assigned once and never recomputed. */
  readonly position: number;
  readonly updatedBy: PlanWriter;
  readonly updatedAt: number;
}

/**
 * One conversation's plan as every reader sees it: whole, in position order.
 *
 * `damaged` says the rows exist and could not be read. It is a state the panel
 * renders with a remedy, not a crash and not an empty plan - a person acting
 * on "empty" when the truth is "unreadable" loses work.
 */
export interface PlanView {
  readonly conversationId: string;
  readonly items: readonly StoredPlanItem[];
  readonly damaged: boolean;
}

/** The item as the model reads it in a tool result: no positions, no clocks. */
export interface PlanItemReport {
  readonly id: string;
  readonly text: string;
  readonly status: PlanStatus;
  readonly updatedBy: PlanWriter;
}
