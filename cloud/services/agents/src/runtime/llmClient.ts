/// <reference types="@cloudflare/workers-types" />

import type { LLMMessage, LLMToolDefinition, LLMResponse } from "./types";

type GatewayFetcher = { fetch(input: RequestInfo | string, init?: RequestInit): Promise<Response> };

/** Full (primary→fallback) sequences to try before giving up. */
const MAX_ROUNDS      = 2;
/** Base delay between rounds; doubles each round. */
const BASE_BACKOFF_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * GatewayLLMClient — thin wrapper around the studio-gateway service binding.
 *
 * Speaks the gateway's OpenAI-compatible POST /v1/chat/completions interface
 * in non-streaming mode. The agent loop calls complete() once per iteration
 * and inspects the returned message for tool_calls to decide whether to
 * keep looping or return the final answer.
 *
 * Streaming is intentionally not used in the loop — individual tool-call
 * rounds are fast, and the loop result is written to the blackboard when done.
 */
export class GatewayLLMClient {
  constructor(
    private readonly gateway: GatewayFetcher,
    private readonly userId:  string,
  ) {}

  async complete(params: {
    model:     string;
    messages:  LLMMessage[];
    tools?:    LLMToolDefinition[];
    /** Optional fallback model, tried when the primary errors. */
    fallback?: string;
  }): Promise<LLMResponse> {
    // Models to try, in order, within each round.
    const models = params.fallback && params.fallback !== params.model
      ? [params.model, params.fallback]
      : [params.model];

    let lastErr: unknown;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      for (const model of models) {
        try {
          return await this.callOnce(model, params.messages, params.tools);
        } catch (err) {
          lastErr = err;
        }
      }
      // All models failed this round — back off before retrying (transient errors,
      // rate limits, bad upstream responses). Skip the wait after the final round.
      if (round < MAX_ROUNDS - 1) {
        await sleep(BASE_BACKOFF_MS * 2 ** round);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  private async callOnce(
    model:    string,
    messages: LLMMessage[],
    tools?:   LLMToolDefinition[],
  ): Promise<LLMResponse> {
    const body: Record<string, unknown> = { model, messages };

    if (tools?.length) {
      body.tools       = tools;
      body.tool_choice = "auto";
    }

    const resp = await this.gateway.fetch("http://studio-gateway/v1/chat/completions", {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id":    this.userId,
        "x-agent":      "true",
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      throw new Error(`Gateway ${resp.status}: ${detail.slice(0, 300)}`);
    }

    const data: any   = await resp.json();
    const choice: any = data.choices?.[0];
    if (!choice) throw new Error("Gateway returned no choices");

    return {
      message: {
        role:       "assistant",
        content:    choice.message?.content ?? null,
        tool_calls: choice.message?.tool_calls,
      },
      usage: data.usage,
    };
  }
}
