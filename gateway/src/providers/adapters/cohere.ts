import { createCohere }       from "@ai-sdk/cohere";
import type { LanguageModel } from "ai";
import { BaseAdapter }        from "./base";

export class CohereAdapter extends BaseAdapter {
  protected readonly providerName = "cohere";
  private readonly p: ReturnType<typeof createCohere>;

  constructor(apiKey: string) {
    super();
    this.p = createCohere({ apiKey });
  }

  protected getModel(m: string): LanguageModel { return this.p(m); }

  /** Exposed for use in the embeddings route. */
  get provider(): ReturnType<typeof createCohere> { return this.p; }
}
