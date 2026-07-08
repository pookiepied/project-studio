import { createMistral }      from "@ai-sdk/mistral";
import type { LanguageModel } from "ai";
import { BaseAdapter }        from "./base";

export class MistralAdapter extends BaseAdapter {
  protected readonly providerName = "mistral";
  private readonly p: ReturnType<typeof createMistral>;

  constructor(apiKey: string, baseURL?: string, headers?: Record<string, string>) {
    super();
    this.p = createMistral({ apiKey, ...(baseURL ? { baseURL } : {}), ...(headers ? { headers } : {}) });
  }

  protected getModel(m: string): LanguageModel { return this.p(m); }
}
