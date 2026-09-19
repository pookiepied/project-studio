import { StorageError } from "../storage/errors.js";
import type { ConversationUsage } from "./context-usage.js";
import type { ModelLimits } from "./compaction-policy.js";

/**
 * Compacting a conversation by hand.
 *
 * ---- The door -----------------------------------------------------------
 *
 * Flue's engine has a manual path - `runCompaction("manual")`, the same code
 * the threshold runs, emitting `compaction_start { reason: "manual" }` - but
 * 2.0.3 gives nothing outside a running agent a way to reach an agent's own
 * conversation with it. Studio's patch on the runtime adds that door and
 * publishes it on `globalThis` under the key below, the way the retry policy
 * travels the other way: the bundle runs from pnpm's virtual store and cannot
 * import this source, and its export maps are minified. The function takes
 * the agent function and the instance id, opens the instance's session as a
 * submission would, and runs the engine's own compaction under the session's
 * one-operation-at-a-time rule. It refuses with the runtime's
 * `SessionBusyError` while a submission is queued or running.
 *
 * ---- The cool-down --------------------------------------------------------
 *
 * The engine's threshold cannot fire twice in a row - after a compaction the
 * window is nearly empty - but a person can press the button twice, and a
 * second compaction over a summary and a few turns degrades the summary for
 * nothing. So a manual compaction is refused unless **both** hold: at least
 * one measured turn has happened since the last compaction (the tracker's
 * row is a measurement, not the provisional estimate a compaction writes),
 * and the measured context is at least the share of the window below, or
 * the flat count when the window is unknown. Below that the answer is a
 * sentence the button can show - "Nothing to compact yet - the conversation
 * is 12% full" - and a person who wants a fresh start at 12% wants a new
 * conversation.
 */

/** Where the patched runtime publishes the door. Quoted in the patch comment. */
export const COMPACT_AGENT_INSTANCE_KEY = "__projectStudioCompactAgentInstance";

declare global {
  var __projectStudioCompactAgentInstance:
    | ((agent: unknown, id: string) => Promise<void>)
    | undefined;
}

/** The share of a known window a conversation must fill before a manual compaction. */
export const COOL_DOWN_SHARE = 0.3;

/** The tokens a conversation must hold before a manual compaction, window unknown. */
export const COOL_DOWN_TOKENS = 30_000;

/** Whether a manual compaction may run now, and if not, why not. */
export type CompactionReadiness =
  | { readonly available: true }
  | { readonly available: false; readonly reason: string };

function percentOf(total: number, window: number): number {
  return Math.round((total / window) * 100);
}

/**
 * The cool-down, as a pure rule over what the tracker holds and what the
 * model declares. `undefined` usage is a conversation no turn has measured.
 */
export function compactionReadiness(
  usage: ConversationUsage | undefined,
  limits: ModelLimits,
): CompactionReadiness {
  if (usage === undefined) {
    return { available: false, reason: "Nothing to compact yet: no turn has been measured." };
  }
  if (usage.estimated) {
    return {
      available: false,
      reason: "Already compacted. Send a message first, so there is a new turn to fold in.",
    };
  }
  const total = usage.input + usage.cacheRead + usage.cacheWrite + usage.output;
  const window = limits.contextWindow;
  if (typeof window === "number" && window > 0) {
    if (total < window * COOL_DOWN_SHARE) {
      return {
        available: false,
        reason: `Nothing to compact yet: the conversation is ${percentOf(total, window)}% full.`,
      };
    }
    return { available: true };
  }
  if (total < COOL_DOWN_TOKENS) {
    return {
      available: false,
      reason: `Nothing to compact yet: the last request was ${Math.round(total / 1000)}k tokens.`,
    };
  }
  return { available: true };
}

export interface CompactConversationOptions {
  /** The agent function whose instance the conversation is. */
  readonly agent: unknown;
  readonly usage: ConversationUsage | undefined;
  readonly limits: ModelLimits;
  /** The door; injectable for a test, the global by default. */
  readonly door?: ((agent: unknown, id: string) => Promise<void>) | undefined;
}

/**
 * Compacts one conversation now, or refuses with a sentence.
 *
 * A refusal is a `StorageError` of kind `conflict`: the conversation is in a
 * state that does not admit the operation, which is what 409 says, and the
 * message is the reason the button shows. The runtime's own busy refusal
 * comes back the same way, in its words.
 */
export async function compactConversation(
  conversationId: string,
  options: CompactConversationOptions,
): Promise<void> {
  const readiness = compactionReadiness(options.usage, options.limits);
  if (!readiness.available) {
    throw new StorageError("conflict", { message: readiness.reason });
  }
  const door = options.door ?? globalThis[COMPACT_AGENT_INSTANCE_KEY];
  if (door === undefined) {
    throw new StorageError("unavailable", {
      message: "This runtime cannot compact a conversation by hand.",
    });
  }
  try {
    await door(options.agent, conversationId);
  } catch (error) {
    if (isSessionBusy(error)) {
      throw new StorageError("conflict", {
        message: "The conversation is busy. Finish or stop the run first.",
        cause: error,
      });
    }
    throw error;
  }
}

/** The runtime's `SessionBusyError`, recognised by its type rather than its class. */
function isSessionBusy(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const record = error as { readonly name?: unknown; readonly type?: unknown };
  return record.name === "SessionBusyError" || record.type === "session_busy";
}
