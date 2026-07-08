import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel }       from "ai";
import { BaseAdapter }              from "./base";

export class GoogleAdapter extends BaseAdapter {
  protected readonly providerName = "google";
  private readonly google: ReturnType<typeof createGoogleGenerativeAI>;

  constructor(apiKey: string, baseURL?: string, headers?: Record<string, string>) {
    super();
    this.google = createGoogleGenerativeAI({ apiKey, ...(baseURL ? { baseURL } : {}), ...(headers ? { headers } : {}) });
  }

  protected getModel(modelId: string): LanguageModel {
    return this.google(modelId);
  }
}
