import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { registerApiProvider, registerProvider } from "@flue/runtime";

import {
  DEFAULT_MODEL_NAME,
  DEFAULT_MODEL_PROVIDER,
  ModelResolutionError,
  ProviderConfigurationError,
  type ModelDescriptor,
  type ModelProviderAdapter,
  type ModelReference,
} from "../../contracts/models.js";
import type { AccessTokenProvider } from "../studio-cloud/access-token.js";
import {
  defaultAliasDescriptor,
  descriptorFromStudioModel,
} from "../studio-cloud/catalog.js";
import {
  StudioGatewayClient,
  type FetchLike,
  type StudioModelRecord,
} from "../studio-cloud/client.js";
import type { StudioGatewayConfig } from "../studio-cloud/config.js";
import { isAbortError, StudioGatewayError } from "../studio-cloud/errors.js";
import { StudioPiEventMapper } from "../studio-cloud/event-mapper.js";
import {
  dedupeStudioEvents,
  parseStudioEvent,
  type StudioStreamEvent,
} from "../studio-cloud/stream-events.js";
import { parseSseFrames } from "../studio-cloud/sse-parser.js";
import { toStudioChatRequest } from "../studio-cloud/request-mapper.js";

/** Pi wire-protocol slug for the Studio gateway's own SSE contract. */
export const STUDIO_GATEWAY_API = "project-studio-gateway";

export interface StudioCloudAdapterOptions {
  readonly config: StudioGatewayConfig;
  readonly tokenProvider: AccessTokenProvider;
  readonly fetchImpl?: FetchLike;
}

/**
 * Studio Gateway model source.
 *
 * The gateway speaks its own SSE contract rather than OpenAI streaming, so
 * this adapter registers a dedicated Pi wire protocol instead of reusing
 * `openai-completions`. It maps the gateway's events into Pi events and does
 * not execute tools: completed tool calls end the turn with `toolUse` and Flue
 * owns execution and continuation.
 */
export class StudioCloudModelProviderAdapter implements ModelProviderAdapter {
  readonly source = "studio-cloud" as const;
  readonly operational = true;

  readonly #config: StudioGatewayConfig;
  readonly #client: StudioGatewayClient;
  readonly #catalog = new Map<string, StudioModelRecord>();
  #catalogLoaded = false;

  constructor(options: StudioCloudAdapterOptions) {
    this.#config = options.config;
    this.#client = new StudioGatewayClient({
      config: options.config,
      tokenProvider: options.tokenProvider,
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    });
  }

  get catalogLoaded(): boolean {
    return this.#catalogLoaded;
  }

  register(): void {
    registerApiProvider({
      api: STUDIO_GATEWAY_API,
      stream: this.stream,
      streamSimple: this.stream,
    });
    this.#registerProvider();
  }

  /**
   * Loads and normalizes the gateway catalog.
   *
   * This is an explicit, callable service, not part of bootstrap: production
   * Phase 7 behavior is scoped to the stable default alias, which resolves
   * without a catalog. Product integration calls this to discover the full
   * model list. Once loaded, the configured default model is validated to
   * exist so a typo in `PROJECT_STUDIO_GATEWAY_DEFAULT_MODEL` surfaces here
   * rather than as a gateway 404 on the first run.
   */
  async loadCatalog(signal?: AbortSignal): Promise<readonly ModelDescriptor[]> {
    const records = await this.#client.listModels(signal);

    this.#catalog.clear();
    for (const record of records) {
      this.#catalog.set(record.id, record);
    }
    this.#catalogLoaded = true;
    this.#registerProvider();

    if (!this.#catalog.has(this.#config.defaultModel)) {
      throw new ProviderConfigurationError(
        `Studio gateway default model "${this.#config.defaultModel}" is not present in the gateway catalog.`,
      );
    }

    return this.listModels();
  }

  resolve(reference: ModelReference): ModelDescriptor {
    if (reference.source !== this.source) {
      throw new ModelResolutionError(
        `Model source "${reference.source}" does not match the "${this.source}" adapter.`,
      );
    }
    if (reference.provider !== DEFAULT_MODEL_PROVIDER) {
      throw new ModelResolutionError(
        `Unknown provider "${reference.provider}" for source "${this.source}".`,
      );
    }

    if (reference.model === DEFAULT_MODEL_NAME) {
      return defaultAliasDescriptor(this.#catalog.get(this.#config.defaultModel));
    }

    const record = this.#catalog.get(reference.model);
    if (!record) {
      throw new ModelResolutionError(
        this.#catalogLoaded
          ? `Unknown model "${reference.model}" for source "${this.source}".`
          : `Model "${reference.model}" cannot be resolved before the Studio gateway catalog is loaded.`,
      );
    }
    return descriptorFromStudioModel(record);
  }

  listModels(): readonly ModelDescriptor[] {
    return [
      defaultAliasDescriptor(this.#catalog.get(this.#config.defaultModel)),
      ...[...this.#catalog.values()].map(descriptorFromStudioModel),
    ];
  }

  #registerProvider(): void {
    const record = this.#catalog.get(this.#config.defaultModel);
    registerProvider(DEFAULT_MODEL_PROVIDER, {
      api: STUDIO_GATEWAY_API,
      baseUrl: this.#config.baseUrl,
      ...(record?.contextWindow === undefined
        ? {}
        : { contextWindow: record.contextWindow }),
      ...(record?.maxTokens === undefined ? {} : { maxTokens: record.maxTokens }),
      telemetry: { providerName: "studio-gateway", serverAddress: this.#config.origin },
    });
  }

  /**
   * The Pi wire-protocol implementation registered for this gateway. It is
   * public so the protocol can be exercised directly against a mock gateway
   * without reaching into Pi's module-scoped registry.
   */
  readonly stream = (
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream => {
    const events = createAssistantMessageEventStream();
    const mapper = new StudioPiEventMapper({
      events,
      model,
      api: STUDIO_GATEWAY_API,
      provider: DEFAULT_MODEL_PROVIDER,
    });

    void (async () => {
      try {
        const body = await this.#client.streamChat(
          toStudioChatRequest(model, context, this.#config, options),
          options?.signal,
        );

        for await (const event of dedupeStudioEvents(decodeStudioEvents(body))) {
          mapper.handle(event);
          // Leaving the loop early cancels the SSE reader, which closes the
          // upstream connection instead of draining a stream nobody reads.
          if (mapper.settled) break;
        }

        mapper.complete();
      } catch (error) {
        if (isAbortError(error) || options?.signal?.aborted) {
          mapper.fail(new StudioGatewayError("aborted"), "aborted");
          return;
        }
        mapper.fail(error);
      }
    })();

    return events;
  };
}

async function* decodeStudioEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<StudioStreamEvent> {
  for await (const frame of parseSseFrames(body)) {
    const event = parseStudioEvent(frame);
    if (event) yield event;
  }
}
