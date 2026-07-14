import { createAnthropic }      from "@ai-sdk/anthropic";
import type { LanguageModel }   from "ai";
import { BaseAdapter }          from "./base";

export class AnthropicAdapter extends BaseAdapter {
  protected readonly providerName = "anthropic";
  private readonly anthropic: ReturnType<typeof createAnthropic>;

  constructor(apiKey: string, baseURL?: string, headers?: Record<string, string>) {
    super();
    this.anthropic = createAnthropic({ apiKey, ...(baseURL ? { baseURL } : {}), ...(headers ? { headers } : {}) });
  }

  protected getModel(modelId: string): LanguageModel {
    return this.anthropic(modelId);
  }
}
