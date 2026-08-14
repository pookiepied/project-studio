/**
 * Runtime adapter registry — protocol router.
 * Kept separate from catalog mapper for single-responsibility.
 * Transparently preserves OpenAI request/response shapes, SSE, headers.
 */

import type { Adapter } from "../providers/registry.ts";
import type { Protocol } from "../providers/types.ts";
import { anthropicMessagesAdapter } from "./anthropic-messages/adapter.ts";
import { googleGenerativeAdapter } from "./google-generative-ai/adapter.ts";
import { openAICompletionsAdapter } from "./openai-completions/adapter.ts";
import { openAIResponsesAdapter } from "./openai-responses/adapter.ts";
// Protocol adapters are intentionally transport-transparent.
// Quirks for OpenAI-compatible providers are handled in `providers/third-party/common.ts`
// (single `applyQuirk` before AI SDK translation). `withProviderQuirk` below is legacy
// for direct `getProviderAdapter` callers; new code should use `getProviderRuntime` (SDK path).
export const protocolAdapters: Record<Protocol, Adapter> = {
  "anthropic-messages": anthropicMessagesAdapter,
  "openai-completions": openAICompletionsAdapter,
  "openai-responses": openAIResponsesAdapter,
  "google-generative-ai": googleGenerativeAdapter,
};

/** @deprecated — prefer SDK path `thirdPartyChat` which applies quirks once before translation */
export function withProviderQuirk(_providerId: string, adapter: Adapter): Adapter {
  return adapter;
}

export function getProtocolAdapter(protocol: string): Adapter {
  const adapter = protocolAdapters[protocol as Protocol];
  if (!adapter) throw new Error(`Adapter not implemented for protocol: ${protocol}`);
  return adapter;
}

/**
 * Resolve any catalog provider by protocol. A provider id only selects an
 * optional compatibility patch; it no longer needs a hard-coded adapter entry.
 */
export function getProviderAdapter(providerId: string, protocol: Protocol): Adapter {
  const adapter = getProtocolAdapter(protocol);
  if (protocol !== "openai-completions") return adapter;
  return withProviderQuirk(providerId, adapter);
}
