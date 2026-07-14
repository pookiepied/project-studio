import { createDeepSeek }     from "@ai-sdk/deepseek";
import type { LanguageModel } from "ai";
import { BaseAdapter }        from "./base";

export class DeepSeekAdapter extends BaseAdapter {
  protected readonly providerName = "deepseek";
  private readonly p: ReturnType<typeof createDeepSeek>;

  constructor(apiKey: string, baseURL?: string, headers?: Record<string, string>) {
    super();
    this.p = createDeepSeek({ apiKey, ...(baseURL ? { baseURL } : {}), ...(headers ? { headers } : {}) });
  }

  protected getModel(m: string): LanguageModel { return this.p(m); }
}
