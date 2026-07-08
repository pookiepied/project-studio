import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel }    from "ai";
import { BaseAdapter }           from "./base";
import { STUDIO_SITE_URL, STUDIO_APP_TITLE } from "../../config/constants";

export class OpenRouterAdapter extends BaseAdapter {
  protected readonly providerName = "openrouter";
  private readonly provider: ReturnType<typeof createOpenAICompatible>;

  constructor(
    apiKey:          string,
    baseURL?:        string,
    siteUrl          = STUDIO_SITE_URL,
    appTitle         = STUDIO_APP_TITLE,
    gatewayHeaders?: Record<string, string>,
  ) {
    super();
    this.provider = createOpenAICompatible({
      name:    "openrouter",
      baseURL: baseURL ?? "https://openrouter.ai/api/v1",
      apiKey,
      headers: {
        "HTTP-Referer": siteUrl,
        "X-Title":      appTitle,
        ...gatewayHeaders,
      },
    });
  }

  protected getModel(modelId: string): LanguageModel {
    return this.provider(modelId) as LanguageModel;
  }
}
