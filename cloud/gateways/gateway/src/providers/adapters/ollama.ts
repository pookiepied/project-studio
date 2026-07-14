import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel }    from "ai";
import { BaseAdapter }           from "./base";

export class OllamaAdapter extends BaseAdapter {
  protected readonly providerName = "ollama";
  private readonly provider: ReturnType<typeof createOpenAICompatible>;

  constructor(port = 11434, host = "localhost") {
    super();
    this.provider = createOpenAICompatible({
      name:    "ollama",
      baseURL: `http://${host}:${port}/v1`,
      apiKey:  "ollama",
    });
  }

  protected getModel(modelId: string): LanguageModel {
    return this.provider(modelId) as LanguageModel;
  }
}
