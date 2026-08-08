/**
 * GatewayAdapter — routes all LLM calls through the studio-gateway service binding.
 *
 * Implements ProviderAdapter so every existing caller (llm.ts, pipeline, specialists)
 * keeps its current interface with zero changes. When env.GATEWAY is present the chat
 * barrel returns one of these instead of a direct provider adapter.
 *
 * Protocol:
 *   Non-streaming → POST /v1/chat/completions (body.stream omitted / false)
 *                   Response: OpenAI-compatible JSON  { choices[0].message, usage? }
 *
 *   Streaming     → POST /v1/chat/completions (body.stream = true)
 *                   Response: text/event-stream of JSON-encoded StreamEvent lines
 *                   Terminated by "data: [DONE]"
 */

import type { AgentMessage, CapturedUsage, CompletionParams, StreamEvent, ProviderAdapter } from "@gateway/providers/types";

// Minimal structural type — avoids importing @cloudflare/workers-types here.
type ServiceFetcher = { fetch(input: RequestInfo | string, init?: RequestInit): Promise<Response> };

export class GatewayAdapter implements ProviderAdapter {
  private _onProviderError?: (httpStatus: number, message: string, model: string) => void;

  constructor(
    private readonly gateway:  ServiceFetcher,
    private readonly provider: string,
    private readonly userId?:  string,
    private readonly userKey?: string,   // user-supplied API key; omit to use gateway env key
  ) {}

  withErrorReporter(fn: (httpStatus: number, message: string, model: string) => void): this {
    this._onProviderError = fn;
    return this;
  }

  // ── complete ──────────────────────────────────────────────────────────────

  async complete(params: CompletionParams): Promise<AgentMessage> {
    const resp = await this._post(params, false);

    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      this._onProviderError?.(resp.status, detail, params.model);
      throw new Error(`Gateway ${resp.status}: ${detail.slice(0, 300)}`);
    }

    const data: any   = await resp.json();
    const choice: any = data.choices?.[0];
    if (!choice) throw new Error("Gateway returned no choices");

    if (params.captureUsage && data.usage) {
      params.captureUsage(data.usage as CapturedUsage);
    }

    return {
      role:       "assistant",
      content:    choice.message?.content ?? null,
      tool_calls: choice.message?.tool_calls,
    };
  }

  // ── streamFull ───────────────────────────────────────────────────────────

  async *streamFull(params: CompletionParams): AsyncGenerator<StreamEvent, void, unknown> {
    const resp = await this._post(params, true);

    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      this._onProviderError?.(resp.status, detail, params.model);
      throw new Error(`Gateway ${resp.status}: ${detail.slice(0, 300)}`);
    }

    const reader  = resp.body!.getReader();
    const decoder = new TextDecoder();
    let   buffer  = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          for (const line of part.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6);
            if (raw === "[DONE]") return;
            let event: StreamEvent & { error?: string; message?: string };
            try { event = JSON.parse(raw); } catch { continue; }

            if ((event as any).type === "error") {
              const msg = (event as any).error ?? (event as any).message ?? "Gateway stream error";
              throw new Error(msg);
            }

            if (event.type === "usage" && params.captureUsage) {
              params.captureUsage(event.data);
            }
            yield event;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // ── stream ───────────────────────────────────────────────────────────────

  async *stream(params: CompletionParams): AsyncGenerator<string, void, unknown> {
    for await (const event of this.streamFull(params)) {
      if (event.type === "content") yield event.chunk;
    }
  }

  // ── internal ─────────────────────────────────────────────────────────────

  private _post(params: CompletionParams, streaming: boolean): Promise<Response> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.userId) headers["x-user-id"] = this.userId;
    if (this.userKey) headers["x-provider-api-key"] = this.userKey;

    const body: Record<string, unknown> = {
      model:       `${this.provider}:${params.model}`,
      messages:    params.messages,
      temperature: params.temperature,
    };
    if (params.maxTokens       != null) body.max_tokens       = params.maxTokens;
    if (params.topP            != null) body.top_p            = params.topP;
    if (params.tools?.length)           body.tools            = params.tools;
    if (params.toolChoice      != null) body.tool_choice      = params.toolChoice;
    if (params.reasoningBudget != null) body.reasoning_budget = params.reasoningBudget;
    if (streaming)                      body.stream           = true;

    return this.gateway.fetch("http://studio-gateway/v1/chat/completions", {
      method:  "POST",
      headers,
      body:    JSON.stringify(body),
      ...(params.abortSignal ? { signal: params.abortSignal } : {}),
    });
  }
}
