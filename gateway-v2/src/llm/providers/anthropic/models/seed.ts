import type { ModelInfo } from "../../../../core/capabilities";
import { createAnthropicChatModel } from "./metadata";

// Curated Claude lineup, as of 2026-07-05. Anthropic's /v1/models endpoint IS wired for
// live discovery (see ./discovery.ts), but this seed is the fallback when discovery is
// unavailable and the source of truth for non-live metadata.
//
// Deliberately excludes models the old gateway listed that are now RETIRED
// (claude-3-5-sonnet, claude-3-5-haiku, claude-3-7-sonnet, claude-3-opus — retired
// Oct 2025 / Jan–Feb 2026) and Project-Glasswing-only claude-mythos-5.
export const ANTHROPIC_SEED_MODELS: ModelInfo[] = [
  createAnthropicChatModel("claude-fable-5"),
  createAnthropicChatModel("claude-opus-4-8"),
  createAnthropicChatModel("claude-opus-4-7"),
  createAnthropicChatModel("claude-opus-4-6"),
  createAnthropicChatModel("claude-opus-4-5"),
  createAnthropicChatModel("claude-sonnet-5"),
  createAnthropicChatModel("claude-sonnet-4-6"),
  createAnthropicChatModel("claude-sonnet-4-5"),
  createAnthropicChatModel("claude-haiku-4-5")
];
