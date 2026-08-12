/**
 * OpenAI provider - no quirks, direct passthrough
 */
import { openAICompletionsAdapter } from "../../adapters/openai-completions/adapter.ts";
export const adapter = openAICompletionsAdapter;
