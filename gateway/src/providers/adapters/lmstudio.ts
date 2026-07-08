import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel }    from "ai";
import { BaseAdapter }           from "./base";

export class LMStudioAdapter extends BaseAdapter {
  protected readonly providerName = "lmstudio";
  private readonly provider: ReturnType<typeof createOpenAICompatible>;

  constructor(port = 1234, host = "localhost") {
    super();
    this.provider = createOpenAICompatible({
      name:    "lmstudio",
      baseURL: `http://${host}:${port}/v1`,
      apiKey:  "lmstudio",
    });
  }

  protected getModel(modelId: string): LanguageModel {
    return this.provider(modelId) as LanguageModel;
  }
}
