import { createGroq }         from "@ai-sdk/groq";
import { generateText }        from "ai";
import type { LanguageModel }  from "ai";
import { BaseAdapter }         from "./base";
import { toCoreMsgs }          from "./shared/messages";
import { toAiSdkTools, toToolCall } from "./shared/tools";
import { cleanModelTokens }    from "../utils";
import type { CapturedUsage, CompletionParams } from "../types";
import type { AgentMessage }   from "../types";

const NO_PARALLEL_MODELS = ["gpt-oss-120b"];

export class GroqAdapter extends BaseAdapter {
  protected readonly providerName = "groq";
  private readonly groq: ReturnType<typeof createGroq>;

  constructor(apiKey: string, baseURL?: string, headers?: Record<string, string>) {
    super();
    this.groq = createGroq({ apiKey, ...(baseURL ? { baseURL } : {}), ...(headers ? { headers } : {}) });
  }

  protected getModel(modelId: string): LanguageModel {
    return this.groq(modelId);
  }

  async complete(params: CompletionParams): Promise<AgentMessage> {
    const noParallel = NO_PARALLEL_MODELS.some(m => params.model.includes(m));
    if (!noParallel || !params.tools?.length) return super.complete(params);

    const tools = toAiSdkTools(params.tools);
    try {
      const result = await generateText({
        // Disable parallel tool calls for affected models via provider options
        model:           this.groq(params.model),
        messages:        toCoreMsgs(params.messages),
        tools,
        toolChoice:      "auto",
        temperature:     params.temperature,
        maxOutputTokens: params.maxTokens,
        maxRetries:      0,
        providerOptions: { groq: { parallelToolCalls: false } },
      });

      if (params.captureUsage) {
        const u = result.usage;
        params.captureUsage({
          prompt_tokens:     u.inputTokens,
          completion_tokens: u.outputTokens,
          total_tokens:      u.totalTokens,
        } satisfies CapturedUsage);
      }

      const toolCalls = (result as any).toolCalls as any[] | undefined;
      return {
        role:    "assistant",
        content: cleanModelTokens(result.text || null),
        ...(toolCalls?.length ? { tool_calls: toolCalls.map(toToolCall) } : {}),
      };
    } catch (err) {
      throw err;
    }
  }
}
