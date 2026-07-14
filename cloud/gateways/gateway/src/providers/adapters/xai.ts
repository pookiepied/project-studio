import { createXai }          from "@ai-sdk/xai";
import type { LanguageModel } from "ai";
import { BaseAdapter }        from "./base";

export class XAIAdapter extends BaseAdapter {
  protected readonly providerName = "xai";
  private readonly p: ReturnType<typeof createXai>;

  constructor(apiKey: string, baseURL?: string, headers?: Record<string, string>) {
    super();
    this.p = createXai({ apiKey, ...(baseURL ? { baseURL } : {}), ...(headers ? { headers } : {}) });
  }

  protected getModel(m: string): LanguageModel { return this.p(m); }
}
