import {
  createFlueClient,
  type AgentConversationObservation,
  type AgentPromptResponse,
  type AgentSendResult,
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
 * submission return 500. Until Flue carries an admission key upstream, the
 * contract is the conservative one ADR 0033 already states: **a lost
 * acknowledgement is `unknown` and is never blindly retried.** `submissionId`
 * is server-assigned, so it identifies a submission we know was admitted — it
 * cannot answer for one we never heard back about.
 */
export interface AcceptedRun {
  readonly threadId: string;
  readonly submissionId: string;
  readonly streamUrl: string;
  readonly offset: string;
}

export interface HarnessClient {
  send(threadId: string, message: string): Promise<AcceptedRun>;
  wait(run: AcceptedRun, signal?: AbortSignal): Promise<AgentPromptResponse>;
  cancel(threadId: string): Promise<boolean>;
  history(threadId: string): Promise<FlueConversationSnapshot>;
  observe(threadId: string): AgentConversationObservation;
}

export class FlueHarnessClient implements HarnessClient {
  readonly #agentName: string;
  readonly #client: FlueClient;

  constructor(options: {
    baseUrl: string;
    agentName?: string;
    token?: string;
  }) {
    this.#agentName = options.agentName ?? "studio";
    this.#client = createFlueClient({
      baseUrl: options.baseUrl,
      ...(options.token === undefined ? {} : { token: options.token }),
    });
  }

  async send(threadId: string, message: string): Promise<AcceptedRun> {
    const admission = await this.#client.agents.send(
      this.#agentName,
      threadId,
      { message },
    );
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
  ): Promise<AgentPromptResponse> {
    const admission: AgentSendResult = {
      submissionId: run.submissionId,
      streamUrl: run.streamUrl,
      offset: run.offset,
    };

    return this.#client.agents.wait(
      admission,
      signal ? { signal } : undefined,
    );
  }

  async cancel(threadId: string): Promise<boolean> {
    const result = await this.#client.agents.abort(
      this.#agentName,
      threadId,
    );
    return result.aborted;
  }

  history(threadId: string): Promise<FlueConversationSnapshot> {
    return this.#client.agents.history(this.#agentName, threadId);
  }

  observe(threadId: string): AgentConversationObservation {
    return this.#client.agents.observe(this.#agentName, threadId, {
      live: "sse",
    });
  }
}
