import type { RuntimeConsumer } from "@studio/v2-contracts";

/**
 * The small, declarative part of a runtime's identity. Behavioral differences
 * (tool gating, how a finished run is persisted) are protected methods on
 * RuntimeSession that subclasses override; this profile carries only the
 * static config the base needs before any of those run.
 */
export interface RuntimeProfile {
  /** Which runtime this is — drives the Studio Context handoff and prompts. */
  consumer: RuntimeConsumer;
  /**
   * System prompt used when Studio Context is unavailable (501/404) or returns
   * no runtime prompt. Context's per-consumer prompt takes precedence.
   */
  fallbackSystemPrompt: string;
}
