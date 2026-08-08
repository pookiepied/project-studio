import type { AccessTokenProvider } from "./access-token.js";
import type { StudioGatewayConfig } from "./config.js";
import {
  isAbortError,
  StudioGatewayError,
  studioGatewayErrorForResponse,
} from "./errors.js";

export type FetchLike = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export interface StudioChatToolDefinition {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description?: string;
    readonly parameters?: Record<string, unknown>;
  };
}

export interface StudioChatMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: unknown;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly toolCalls?: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly arguments: string;
  }>;
}

export interface StudioChatRequest {
  readonly model: string;
  readonly messages: readonly StudioChatMessage[];
  readonly stream: true;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly tools?: readonly StudioChatToolDefinition[];
  readonly reasoningEffort?: string;
}

/** One record from the gateway's `/v1/models` catalog. */
export interface StudioModelRecord {
  readonly id: string;
  readonly provider?: string;
  readonly providerModelId?: string;
  readonly displayName?: string;
  readonly contextWindow?: number;
  readonly maxTokens?: number;
  readonly capabilities?: {
    readonly modalities?: readonly string[];
    readonly chat?: {
      readonly streaming?: boolean;
      readonly vision?: boolean;
      readonly tools?: boolean;
      readonly jsonSchema?: boolean;
      readonly reasoning?: { readonly supported?: boolean };
    };
  };
}

export interface StudioGatewayClientOptions {
  readonly config: StudioGatewayConfig;
  readonly tokenProvider: AccessTokenProvider;
  readonly fetchImpl?: FetchLike;
}

/**
 * HTTP boundary for the Studio Gateway.
 *
 * The access token is attached only to requests whose resolved URL is on the
 * configured gateway origin, so a misconfigured or redirected path can never
 * carry the credential somewhere else. Redirects are not followed for the same
 * reason.
 */
export class StudioGatewayClient {
  readonly #config: StudioGatewayConfig;
  readonly #tokenProvider: AccessTokenProvider;
  readonly #fetch: FetchLike;

  constructor(options: StudioGatewayClientOptions) {
    this.#config = options.config;
    this.#tokenProvider = options.tokenProvider;
    this.#fetch = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  get config(): StudioGatewayConfig {
    return this.#config;
  }

  async listModels(signal?: AbortSignal): Promise<StudioModelRecord[]> {
    const response = await this.#send("/v1/models", { method: "GET" }, signal);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new StudioGatewayError("protocol");
    }

    const records = (body as { data?: unknown })?.data;
    if (!Array.isArray(records)) {
      throw new StudioGatewayError("protocol");
    }
    return records.filter(
      (record): record is StudioModelRecord =>
        !!record && typeof record === "object" && typeof (record as StudioModelRecord).id === "string",
    );
  }

  /** Opens a streaming chat completion and returns the raw SSE body. */
  async streamChat(
    request: StudioChatRequest,
    signal?: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>> {
    const response = await this.#send(
      "/v1/chat/completions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      },
      signal,
    );

    if (!response.body) {
      throw new StudioGatewayError("protocol");
    }
    return response.body;
  }

  async #send(
    path: string,
    init: RequestInit,
    signal?: AbortSignal,
  ): Promise<Response> {
    const url = new URL(`${this.#config.baseUrl}${path}`);
    if (url.origin !== this.#config.origin) {
      throw new StudioGatewayError("configuration", {
        message:
          "Refusing to send Studio gateway credentials to an origin other than the configured gateway.",
      });
    }

    const token = await this.#tokenProvider.getAccessToken(signal);

    // The caller's signal governs the whole exchange, including the response
    // body, so cancelling a run tears down the upstream connection.
    const controller = new AbortController();
    if (signal) {
      if (signal.aborted) {
        controller.abort(signal.reason);
      } else {
        signal.addEventListener("abort", () => controller.abort(signal.reason), {
          once: true,
        });
      }
    }

    // The timeout only guards establishing the response (connect + headers).
    // It is cleared once headers arrive: an agent turn can legitimately stream
    // for far longer than the connect budget, and leaving the timer armed
    // would truncate a healthy long generation mid-stream.
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.#config.requestTimeoutMs);

    let response: Response;
    try {
      response = await this.#fetch(url.toString(), {
        ...init,
        redirect: "error",
        signal: controller.signal,
        headers: {
          accept: init.method === "POST" ? "text/event-stream" : "application/json",
          ...(init.headers as Record<string, string> | undefined),
          authorization: `Bearer ${token}`,
        },
      });
    } catch (error) {
      if (timedOut) {
        throw new StudioGatewayError("timeout");
      }
      if (isAbortError(error) || signal?.aborted) {
        throw new StudioGatewayError("aborted");
      }
      throw new StudioGatewayError("unavailable");
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw studioGatewayErrorForResponse(
        response.status,
        await readGatewayErrorCode(response),
      );
    }
    return response;
  }
}

/**
 * Reads the gateway's own normalized error code. Only the code is taken; the
 * body is never surfaced to callers, logs, or telemetry.
 */
async function readGatewayErrorCode(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { error?: { code?: unknown } };
    const code = body?.error?.code;
    return typeof code === "string" ? code : undefined;
  } catch {
    return undefined;
  }
}
