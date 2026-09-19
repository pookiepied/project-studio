/**
 * The shape of a question a run puts to the person.
 *
 * This is the payload the durable row carries and the UI renders, shared by
 * the tool that asks, the store that keeps, and the broker that parks. It
 * describes a question and its options; it never carries a credential, which
 * is what lets it live in a database column the migration guard can see.
 *
 * The outcomes are deliberately a flat vocabulary of four and not one outcome
 * with flags: a deferred question and a stopped one are different states of
 * the person, not different reasons for the same answer.
 */

/** One choice offered. The model writes what happens if it is chosen. */
export interface QuestionOption {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

/** One question, as asked and as rendered. */
export interface QuestionPayload {
  /** The sentence. Required, and shown as the card's main line. */
  readonly question: string;
  /** A short label - a word or two, at most twenty-four characters - for the compact display. */
  readonly header: string;
  /** Two to four choices. A recommended one goes first and says so in its label. */
  readonly options: readonly QuestionOption[];
  /** Whether several options may be chosen at once. */
  readonly multiSelect: boolean;
  /**
   * The option a timeout may take, and the only thing it may take. A question
   * without one parks forever instead of timing out.
   */
  readonly recommendedOptionId?: string;
}

/** How a question left the queue. Each is a different path, not a flag. */
export type QuestionOutcome =
  /** An option, or free text: the run continues with the answer. */
  | "answered"
  /** "You decide": the person is present and declining to choose. */
  | "deferred"
  /** "Stop": the person is present and ending the run. */
  | "stopped"
  /** Nobody was there; the stored deadline passed. */
  | "timed_out";

/** What was chosen. Free text and option choices are mutually exclusive. */
export interface QuestionAnswer {
  /** The chosen option ids, when the answer is a choice. */
  readonly optionIds?: readonly string[];
  /** What the person wrote, when the answer is free text. */
  readonly text?: string;
}

/**
 * How one question came out, as the model reads it.
 *
 * A deferred question says so explicitly rather than arriving as a missing
 * answer, so the model can say "you did not choose, so I am using X" instead
 * of pretending it was told.
 */
export interface QuestionReport {
  readonly header: string;
  readonly question: string;
  readonly outcome: QuestionOutcome;
  /** The chosen option ids, for an answered question. */
  readonly optionIds?: readonly string[];
  /** The chosen option labels, beside the ids, so the answer reads without the schema. */
  readonly labels?: readonly string[];
  /** What the person wrote, when they answered in their own words. */
  readonly text?: string;
}
