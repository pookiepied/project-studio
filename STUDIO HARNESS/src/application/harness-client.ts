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
 * There is no client-supplied request key here, and that is a decision rather
 * than an omission (meta-task #12). Sending one meant patching `@flue/sdk` and
 * `@flue/runtime` by hand-diffing their build output, which is how a call to a
 * function that existed in no release of beta.9 shipped and made every
 * submission return 500. Flue 2.0 now carries `idempotencyKey` upstream, and
 * adopting it is Phase 6's decision - until then the contract stays the
 * conservative one ADR 0033 states: **a lost acknowledgement is `unknown` and
 * is never blindly retried.** `submissionId` is server-assigned, so it
 * identifies a submission we know was admitted - it cannot answer for one we
 * never heard back about.
 */
export interface AcceptedRun {
  readonly threadId: string;
  readonly submissionId: string;
  readonly streamUrl: string;
  readonly offset: string;
}

export interface HarnessClient {
  send(threadId: string, message: string): Promise<AcceptedRun>;
  wait(run: AcceptedRun, signal?: AbortSignal): Promise<AgentReadResult>;
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
