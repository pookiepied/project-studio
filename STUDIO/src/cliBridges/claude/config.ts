import type { ClaudeEffortLevel } from "../types";

/**
 * Claude Code CLI bridge configuration.
 *
 * Permission modes are not here; they live in the centralized permissions
 * module because they are shared across Studio AI, Claude, and future CLIs.
 */

type ClaudeModelGlyph = "leaf" | "lightning" | "star" | "sparkle";

/**
 * `id` is what we pass to Claude Code. The short family aliases keep the bridge
 * compatible with Claude Code's own model routing, while labels stay human.
 */
export const CLAUDE_MODELS: {
  id: string;
  label: string;
  description: string;
  icon: ClaudeModelGlyph;
}[] = [
  { id: "haiku",  label: "Haiku 4.5", description: "Fastest and lightest", icon: "lightning" },
  { id: "sonnet", label: "Sonnet 5",  description: "Balanced default",     icon: "star" },
  { id: "opus",   label: "Opus 4.8",  description: "Deep coding work",     icon: "sparkle" },
  { id: "fable",  label: "Fable 5",   description: "Most capable",         icon: "sparkle" },
];

const CLAUDE_CONTEXT_WINDOW_TOKENS = 200_000;
const CLAUDE_LARGE_CONTEXT_WINDOW_TOKENS = 1_000_000;

export function getClaudeContextWindowTokens(modelId: string): number {
  const id = modelId.toLowerCase();
  if (id.includes("haiku")) return CLAUDE_CONTEXT_WINDOW_TOKENS;
  if (
    id === "sonnet" ||
    id === "opus" ||
    id === "fable" ||
    id.includes("sonnet-5") ||
    id.includes("opus-4-8") ||
    id.includes("fable-5")
  ) {
    return CLAUDE_LARGE_CONTEXT_WINDOW_TOKENS;
  }
  return CLAUDE_CONTEXT_WINDOW_TOKENS;
}

export const CLAUDE_EFFORT_LEVELS: {
  id: ClaudeEffortLevel;
  label: string;
  title: string;
}[] = [
  { id: "low",    label: "Low",    title: "Minimal reasoning, fastest" },
  { id: "medium", label: "Medium", title: "Balanced reasoning" },
  { id: "high",   label: "High",   title: "Deeper reasoning" },
  { id: "max",    label: "Max",    title: "Maximum reasoning budget" },
];

export function effortToThinkingBudget(effort: ClaudeEffortLevel): number {
  switch (effort) {
    case "low":    return 4_096;
    case "medium": return 8_192;
    case "high":   return 16_384;
    case "max":    return 31_999;
  }
}
