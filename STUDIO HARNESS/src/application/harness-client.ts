import {
  createFlueClient,
  type AgentConversationObservation,
  type AgentReadResult,
  type FlueClient,
  type FlueConversationSnapshot,
} from "@flue/sdk";

/**
 * The receipt for one admitted submission.
 *
 * **The idempotency decision (Phase 6, 2026-09-02): declined.** Flue 2.0
 * admits a caller-chosen `idempotencyKey` upstream now - a retried send
 * carrying the same key converges on the original submission (measured:
 * same receipt with `deduplicated: true`), and reusing a key with a
 * different payload rejects 409 `submission_conflict`. The key is declined
 * for the current shape because nothing in the tree resends a submission
 * automatically: a lost acknowledgement surfaces as `unreachable` with the
 * honest instruction to check the transcript before sending again, and the
 * transcript (a durable read, ADR 0045) is the answer to the ambiguity.
 * Adopting the key would put its lifecycle in the composer - minted per
 * composed message, invalidated whenever the words or settings change (a
 * payload mismatch is a 409), and retired the moment a person deliberately
 * resends after checking - which is product work that deserves its own
 * decision, not a rider on the envelope reshape. The reopen condition:
 * **any path that resends automatically** (a scheduled send, an outbox, a
 * reconnecting admission queue) must carry the key; the mechanism is one
 * option away and ADR 0033's conservative rule is what holds until then.
 * See ADR 0033's status note for the same decision written there.
 */
export interface AcceptedRun {
  readonly threadId: string;
  readonly submissionId: string;
  readonly streamUrl: string;
  readonly offset: string;
}

export interface HarnessClient {
  send(threadId: string, message: string): Promise<AcceptedRun>;
  /**
   * Waits for one admitted submission to settle and reads back its reply.
   *
   * This is `read(submissionId)` - the re-attach form. Measured against a
   * live 2.0 harness (Phase 6), the semantics are:
   *
   * - **already settled**: resolves immediately with the reply read from
   *   history (measured at 26ms for a settled turn);
   * - **still running**: resolves when the submission's `submission-settled`
   *   chunk arrives; the updates stream is followed from its origin, so the
   *   caller needs nothing but the id;
   * - **settled failed or aborted**: THROWS (`FlueExecutionError`) - the
   *   failure is the value of the wait, not a result shape;
   * - **unknown conversation**: rejects at once with a 404
   *   (`stream_not_found`);
   * - **known conversation, unknown submission id**: NEVER RESOLVES. There
   *   is no "no such submission" answer; the read watches a stream that is
   *   up to date and quiet for a settlement that will not come (measured:
   *   still waiting past 8s, with no error). Every caller here passes an id
   *   this process was handed by an admission receipt, which is the only
   *   safe shape - never call this with a guessed or stored-elsewhere id.
   */
  wait(run: AcceptedRun, signal?: AbortSignal): Promise<AgentReadResult>;
  /**
   * Aborts the conversation's durable work: 2.0's abort reaches the
   * IN-FLIGHT submission AND any queued behind it (measured: a submission
   * sent while a response was live joins that host response rather than
   * queueing separately, so in practice the conversation holds at most one
   * running response - but the contract is conversation-wide, not
   * per-submission). Resolves with whether there was work to abort; the
   * settlement arrives asynchronously on the stream as `outcome: "aborted"`.
   * 1.0's abort stopped the current turn only; anything assuming that needs
   * re-reading - starting with the webview's stop control, which addresses
   * the whole conversation by design.
   */
  cancel(threadId: string): Promise<boolean>;
  history(threadId: string): Promise<FlueConversationSnapshot>;
  observe(threadId: string): AgentConversationObservation;
}

/**
 * Flue 2.0's SDK client is conversation-scoped: one client addresses exactly
 * one agent conversation (`<base>/agents/<agent>/<id>`), and `send`, `abort`,
 * `history` and `observe` all take no addressing arguments any more. This
 * wrapper keeps the per-conversation call shape the harness and the tests
 * use, building (and caching) one underlying client per conversation id.
 */
export class FlueHarnessClient implements HarnessClient {
  readonly #baseUrl: string;
  readonly #agentName: string;
  readonly #token: string | undefined;
  readonly #clients = new Map<string, FlueClient>();

  constructor(options: {
    baseUrl: string;
    agentName?: string;
    token?: string;
  }) {
    this.#baseUrl = options.baseUrl;
    this.#agentName = options.agentName ?? "studio";
    this.#token = options.token;
  }

  #clientFor(threadId: string): FlueClient {
    const existing = this.#clients.get(threadId);
    if (existing !== undefined) return existing;
    const client = createFlueClient({
      url: `${this.#baseUrl}/agents/${this.#agentName}/${encodeURIComponent(threadId)}`,
      ...(this.#token === undefined ? {} : { token: this.#token }),
    });
    this.#clients.set(threadId, client);
    return client;
  }

  async send(threadId: string, message: string): Promise<AcceptedRun> {
    // A bare string is shorthand for `{ kind: "user", body }` on the wire;
    // the 2.0 SDK takes the full delivered message, so the shorthand is
    // spelled out here.
    const admission = await this.#clientFor(threadId).send({
      message: { kind: "user", body: message },
    });
    return {
      threadId,
      submissionId: admission.submissionId,
      streamUrl: admission.streamUrl,
      offset: admission.offset,
    };
  }

  async wait(
    run: AcceptedRun,
    signal?: AbortSignal,
  ): Promise<AgentReadResult> {
    // The re-attach form: a bare submission id, which the SDK resolves from
    // the conversation's stream origin, so a submission that already settled
    // resolves immediately and one still running waits. The admission's
    // stream coordinates stay on the receipt for the stream readers above.
    return this.#clientFor(run.threadId).read(run.submissionId, {
      ...(signal === undefined ? {} : { signal }),
    });
  }

  async cancel(threadId: string): Promise<boolean> {
    const result = await this.#clientFor(threadId).abort();
    return result.aborted;
  }

  history(threadId: string): Promise<FlueConversationSnapshot> {
    return this.#clientFor(threadId).history();
  }

  observe(threadId: string): AgentConversationObservation {
    return this.#clientFor(threadId).observe({ live: "sse" });
  }
}
