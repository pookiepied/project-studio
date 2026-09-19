import { COMPACTION_PROMPTS } from "../context/compaction-prompt.js";

/**
 * Where a conversation is compacted, as the number Flue's engine takes.
 *
 * Flue compacts after an assistant message when the tokens the provider
 * reported exceed `contextWindow - reserveTokens`, and its own reserve is a
 * flat 20,000 capped at the model's max output. That is compaction at 90% of
 * a 200k window and at 98% of a 1M one, and both are later than the point
 * answers start getting worse. Studio's rule keeps the 20,000 floor and lets
 * it grow with the window: **max(20,000, 15% of the window)**, so a 200k
 * model compacts at 170k and a 1M model at 850k. Not later, because the
 * summariser's own request has to fit in the same window with the whole
 * transcript in it; not earlier, because every compaction re-reads the
 * conversation at full price and a fifth of a large window thrown away per
 * cycle is a real cost.
 *
 * Two of Flue's own guards are kept, because an explicit reserve bypasses
 * both. The reserve never exceeds the model's max output, since the summary
 * is written inside the reserve and a model cannot write past its cap; and
 * on a window so small the reserve would take half of it, a third of the
 * window is reserved instead, which is what Flue does for an 8k model.
 *
 * A model with no window gets no reserve at all: Flue's threshold cannot
 * engage without a window, so the number would decide nothing, and the
 * overflow path - compact when the provider refuses, retry once - is what
 * remains. The Add Model form says so where the window is left empty.
 */

/** The reserve Flue starts from; kept as the floor here. */
export const RESERVE_FLOOR_TOKENS = 20_000;

/** The share of the window held back above the floor. */
export const RESERVE_SHARE = 0.15;

export interface ModelLimits {
  readonly contextWindow: number | "unknown";
  readonly maxOutputTokens: number | "unknown";
}

/** The reserve for one model, or undefined when its window is unknown. */
export function compactionReserveFor(limits: ModelLimits): number | undefined {
  const window = limits.contextWindow;
  if (typeof window !== "number" || window <= 0) return undefined;

  let reserve = Math.max(RESERVE_FLOOR_TOKENS, Math.floor(window * RESERVE_SHARE));
  const maxOutput = limits.maxOutputTokens;
  if (typeof maxOutput === "number" && maxOutput > 0) reserve = Math.min(reserve, maxOutput);
  // Flue's small-window rule: a reserve that would take half the window or
  // more becomes a third of it, and never less than a thousand tokens.
  if (reserve * 2 >= window) reserve = Math.max(1024, Math.floor(window / 3));
  return reserve;
}

/** The point compaction triggers at, in tokens, for a model with a window. */
export function compactionThresholdFor(limits: ModelLimits): number | undefined {
  const reserve = compactionReserveFor(limits);
  if (reserve === undefined || typeof limits.contextWindow !== "number") return undefined;
  return limits.contextWindow - reserve;
}

/** The `compaction` option for `useModel`, as the patched runtime takes it. */
export interface CompactionConfig {
  readonly reserveTokens?: number;
  readonly prompts: typeof COMPACTION_PROMPTS;
}

/**
 * The `compaction` option for `useModel`: Studio's prompts always, and the
 * reserve when the model has a window. A model with no window still gets
 * the prompts, because the overflow path summarises too; it gets no
 * reserve, because a threshold over an unknown window decides nothing.
 */
export function compactionConfigFor(limits: ModelLimits | undefined): CompactionConfig {
  const reserveTokens = limits === undefined ? undefined : compactionReserveFor(limits);
  return {
    prompts: COMPACTION_PROMPTS,
    ...(reserveTokens === undefined ? {} : { reserveTokens }),
  };
}
