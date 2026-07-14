import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel }    from "ai";
import { BaseAdapter }           from "./base";

export class AlibabaAdapter extends BaseAdapter {
  protected readonly providerName = "alibaba";
  private readonly provider: ReturnType<typeof createOpenAICompatible>;

  constructor(apiKey: string) {
    super();
    this.provider = createOpenAICompatible({
      name:    "alibaba",
      baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
      apiKey,
    });
  }

  protected getModel(modelId: string): LanguageModel {
    return this.provider(modelId) as LanguageModel;
  }
}
