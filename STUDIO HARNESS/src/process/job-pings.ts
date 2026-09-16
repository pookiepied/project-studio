/**
 * The one place a finished background job becomes a message.
 *
 * ---- Why this exists -------------------------------------------------------
 *
 * A background job had two ways to tell the model it had ended, and both were
 * pulls: stapled to the tail of the next tool result while a turn was running,
 * or written into the next turn's environment block. Both wait for the model
 * to act. A conversation that starts a video and then sits idle learns
 * nothing until the user writes something, which is the wrong way round - the
 * news exists, the model simply never gets it.
 *
 * So a finished job also announces itself: the registry that ended the job
 * calls `announce`, and this module collects what nobody has told yet and
 * delivers it as one message to the conversation's own agent. A delivery to
 * an idle conversation wakes a new response; one sent while the conversation
 * is busy joins the live response at its next turn boundary. Either way the
 * model reads the news when it happens, not the next time somebody speaks.
 *
 * ---- Why this is the one mechanism, and who may use it ---------------------
 *
 * Every background-job registry - today the commands in `process/background.ts`
 * and the generations in `gateway/media/jobs.ts`, tomorrow whatever else
 * outlives its call - plugs in with two small acts: it answers one question
 * (`drain`, below) and it calls `announce` when one of its jobs ends. Nothing
 * here knows what kind of thing a job is, what a source calls its outputs, or
 * how the message travels; the next kind of background work joins this
 * mechanism with two members and no second copy of the delivery rules.
 *
 * ---- Exactly once, and who enforces it -------------------------------------
 *
 * Three places can deliver a job's ending: the announcement, the tail of the
 * next tool result, and the next turn's block. All three drain, and a drain
 * marks the job told - so exactly one of them wins each job, whichever drains
 * first, and a delivery that arrives twice would read as two endings. The
 * arbiter is the registries' own ended-but-untold marker; this module owns
 * none of it. What it owns is the decision to deliver and the message's shape:
 * which jobs, what happened, and one sentence telling the model that this is
 * the harness speaking and that the outcome belongs to the user.
 *
 * ---- What a delivery failure costs -----------------------------------------
 *
 * At most once, never twice. A drained job whose delivery failed is news told
 * to nobody, reported through `onFailure` and lost; the alternative - marking
 * told only after the delivery lands - would need a second bookkeeping layer
 * here to stay exactly-once, and the failure it would rescue is a harness
 * that cannot admit a submission, which the caller's logs already say.
 */

/** Where one kind of background job keeps its endings. */
export interface JobPingSource {
  /**
   * The conversation's ended-but-untold jobs, as the lines the model reads.
   *
   * Draining marks them told - it is a delivery, not a read - which is what
   * keeps the announcement, the tool-result tail and the next turn's
   * environment block from saying the same ending twice: exactly one of the
   * three gets each job, whichever drains first. Lines may carry their own
   * continuation lines (a finished generation's Artifact lines ride inside
   * theirs); they are joined, not flattened.
   */
  readonly drain: (conversationId: string) => readonly string[];
}

export interface JobPingsOptions {
  /**
   * Delivers one finished-jobs message to one conversation. The harness's own
   * port: this module never learns what carries it, and the one thing it
   * promises is that the same conversation's answer appears without anyone
   * sending a message first.
   */
  readonly deliver: (conversationId: string, body: string) => Promise<void>;
  /**
   * Whether the conversation still exists. A job can outlive the row it
   * belongs to - the purge asks nothing of the job registries - and a
   * delivered message for a conversation nobody holds would either fail
   * downstream or, worse, resurrect the conversation's agent as an instance
   * nobody sees. Guarded here, where the news is still cheap to drop.
   */
  readonly exists?: (conversationId: string) => boolean;
  /** Where a collect or a delivery failure is reported. Never thrown past here. */
  readonly onFailure?: (reason: unknown) => void;
}

export class JobPings {
  readonly #sources: JobPingSource[] = [];
  readonly #deliver: (conversationId: string, body: string) => Promise<void>;
  readonly #exists: ((conversationId: string) => boolean) | undefined;
  readonly #onFailure: ((reason: unknown) => void) | undefined;

  constructor(options: JobPingsOptions) {
    this.#deliver = options.deliver;
    this.#exists = options.exists;
    this.#onFailure = options.onFailure;
  }

  /** Adds one source. Later sources' lines follow earlier ones' in the message. */
  addSource(source: JobPingSource): void {
    this.#sources.push(source);
  }

  /**
   * A source calls this when one of its jobs has ended, however it ended -
   * finished, failed, or taken longer than anyone waits. Collects from every
   * source, and delivers only when something was actually collected: an
   * ending that is already told, or belongs to a conversation that is gone,
   * announces itself into silence.
   *
   * Never throws and never awaits: the caller is a registry in the middle of
   * recording its own state, and the deliver's slow half - admitting a
   * submission - happens after this returns.
   */
  announce(conversationId: string): void {
    try {
      if (this.#exists?.(conversationId) === false) return;
      const lines: string[] = [];
      for (const source of this.#sources) lines.push(...source.drain(conversationId));
      if (lines.length === 0) return;
      const body = [
        "Background work has finished:",
        ...lines,
        "",
        "This message is the harness, not the user: reply with the outcome, briefly.",
      ].join("\n");
      void this.#deliver(conversationId, body).catch((error: unknown) => {
        this.#onFailure?.(error);
      });
    } catch (error) {
      // A collect threw - a source read its registry wrongly. The news it had
      // is lost either way; the failure is at least reported.
      this.#onFailure?.(error);
    }
  }
}
