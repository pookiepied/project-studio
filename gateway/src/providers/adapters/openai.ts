import { createOpenAI }       from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { BaseAdapter }        from "./base";

export class OpenAIAdapter extends BaseAdapter {
  protected readonly providerName = "openai";
  private readonly p: ReturnType<typeof createOpenAI>;

  constructor(apiKey: string, baseURL?: string, headers?: Record<string, string>) {
    super();
    this.p = createOpenAI({ apiKey, ...(baseURL ? { baseURL } : {}), ...(headers ? { headers } : {}) });
  }

  protected getModel(m: string): LanguageModel { return this.p(m); }
}
