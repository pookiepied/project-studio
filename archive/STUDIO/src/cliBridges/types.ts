/**
 * CLI bridge types.
 *
 * A "CLI bridge" is NOT an API provider. Providers (Anthropic, OpenAI, …) give
 * HTTP API access and live in the models/provider layer. A CLI bridge spawns a
 * local command-line tool (Claude Code, and in future Codex CLI, Copilot CLI,
 * Aider, …) and streams its output back into the chat. It is a fundamentally
 * different mechanism that happens to talk to a provider underneath.
 *
 * `ChatEngine` selects which path a turn takes:
 *   - "studio" → the native Studio AI path (API providers, agent loop, tools)
 *   - "claude" → the Claude Code CLI bridge
 */
export type ChatEngine = "studio" | "claude";

/** Reasoning/effort budget exposed for the Claude bridge — mirrors Studio's reasoning levels. */
export type ClaudeEffortLevel = "low" | "medium" | "high" | "max";
