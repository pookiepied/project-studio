/**
 * Generic OpenAI-compatible adapter.
 *
 * Kept for open-source extensibility — lets operators wire any OpenAI-compatible
 * endpoint (vLLM, LocalAI, custom inference server) without adding a dedicated
 * provider. Not connected to any built-in Studio provider.
 *
 * Usage (via createProvider fallback):
 *   provider: "custom", baseUrl: "https://my-server/v1", apiKey: "..."
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel }     from "ai";
import { BaseAdapter }            from "./base";

export class OpenAICompatAdapter extends BaseAdapter {
  protected readonly providerName: string;
  private readonly p: ReturnType<typeof createOpenAICompatible>;

  constructor(
    providerName: string,
    apiKey: string,
    baseURL: string,
    headers?: Record<string, string>,
  ) {
    super();
    this.providerName = providerName;
    this.p = createOpenAICompatible({ name: providerName, baseURL, apiKey, ...(headers ? { headers } : {}) });
  }

  protected getModel(m: string): LanguageModel { return this.p(m) as LanguageModel; }
}
