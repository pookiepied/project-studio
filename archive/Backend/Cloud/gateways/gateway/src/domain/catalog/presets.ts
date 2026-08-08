import type { ChatOptions } from "./builders";

export function googleThinking(): ChatOptions {
  return {
    contextWindow: 1_048_576,
    maxTokens: 64_000,
    vision: true,
    inputTypes: ["text", "image", "audio", "video"],
    reasoning: ["none", "minimal", "low", "medium", "high"],
    reasoningControl: "thinkingConfig"
  };
}

export function anthropicThinking(): ChatOptions {
  return {
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    vision: true,
    jsonSchema: false,
    promptCaching: true,
    reasoning: ["none", "low", "medium", "high", "xhigh"],
    reasoningControl: "effort"
  };
}

export function deepseekThinking(): ChatOptions {
  return {
    contextWindow: 1_048_576,
    maxTokens: 384_000,
    vision: false,
    reasoning: ["none", "low", "medium", "high", "xhigh"],
    promptCaching: true
  };
}

export function groqOss(contextWindow: number, maxTokens: number): ChatOptions {
  return {
    contextWindow,
    maxTokens,
    vision: false,
    reasoning: ["low", "medium", "high"]
  };
}

export function alibabaChat(overrides: Partial<ChatOptions>): ChatOptions {
  return {
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    vision: false,
    reasoning: [],
    reasoningSource: "unknown",
    ...overrides
  };
}

export function xiaomiMimo(vision: boolean): ChatOptions {
  return {
    contextWindow: 1_048_576,
    maxTokens: 128_000,
    vision,
    reasoning: [],
    reasoningSource: "unknown"
  };
}
