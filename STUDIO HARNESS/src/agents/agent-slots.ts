/**
 * How many agents may run at once, and the one place that says so.
 *
 * Voice tasks and delegates (the `task` tool's explore, general and plan)
 * share one budget per conversation and one for the machine. The numbers
 * are stated in every agent's system prompt (`agentLimitLine`), so no agent
 * has to guess them from a refusal.
 *
 * The two kinds meet the limit differently, and the difference is what keeps
 * the budget from deadlocking. A voice task that cannot start yet is queued:
 * it holds nothing while it waits, and starts when a running agent settles.
 * A delegate that cannot start is refused at once with a sentence its parent
 * can act on (do the work itself, or wait): a delegate's parent is already
 * running and holding its own slot, so a delegate that waited could wait on
 * its own parent forever.
 */
export const AGENTS_PER_CONVERSATION = 8;
export const AGENTS_ON_MACHINE = 16;

/** The sentence every agent's system prompt carries about the limit. */
export function agentLimitLine(): string {
  return `At most ${AGENTS_PER_CONVERSATION} agents run at once in one chat (voice tasks and delegates together), and ${AGENTS_ON_MACHINE} across all chats on this machine. Past that, a new voice task waits in a queue and a new delegate is refused, so do that work yourself or wait for one to finish.`;
}

export interface AgentSlotCounts {
  /** Agents running now that belong to this conversation. */
  readonly conversation: number;
  /** Agents running now across the machine. */
  readonly machine: number;
}

/** Why a start must wait, or undefined when there is room. */
export function agentLimitReached(counts: AgentSlotCounts): string | undefined {
  if (counts.conversation >= AGENTS_PER_CONVERSATION) {
    return `${counts.conversation} agents are already running in this chat, the limit of ${AGENTS_PER_CONVERSATION}.`;
  }
  if (counts.machine >= AGENTS_ON_MACHINE) {
    return `${counts.machine} agents are already running across all chats, the limit of ${AGENTS_ON_MACHINE}.`;
  }
  return undefined;
}

/**
 * Live delegates, counted per conversation.
 *
 * Voice tasks are counted from the task index (an unsettled row is a running
 * task); delegates have no row, so they are counted here between their start
 * and their end. Process-local on purpose: a delegate does not survive a
 * restart, so neither does its count.
 */
export class DelegateCounter {
  readonly #live = new Map<string, number>();
  #total = 0;

  count(conversationId: string): number {
    return this.#live.get(conversationId) ?? 0;
  }

  get total(): number {
    return this.#total;
  }

  /** Counts one delegate in; the returned function counts it out, once. */
  enter(conversationId: string): () => void {
    this.#live.set(conversationId, this.count(conversationId) + 1);
    this.#total++;
    let left = false;
    return () => {
      if (left) return;
      left = true;
      const next = this.count(conversationId) - 1;
      if (next <= 0) this.#live.delete(conversationId);
      else this.#live.set(conversationId, next);
      this.#total--;
    };
  }
}

/**
 * The gate the patched Flue runtime consults before a `task` call starts a
 * delegate. The bundle cannot import this module (it executes from pnpm's
 * virtual store), so the composition root publishes the gate on globalThis,
 * the same seam the transient-retry policy uses. The patch defends itself:
 * an absent or throwing gate admits the delegate as upstream would.
 *
 *   globalThis.__projectStudioAgentSlots.admitDelegate({ conversationId, agent })
 *     -> { release(): void } | { refused: string }
 *   globalThis.__projectStudioAgentSlots.limitLine
 *     -> the sentence Flue appends to every prompt's Available Agents section
 */
export interface AgentSlotGate {
  readonly limitLine: string;
  admitDelegate(request: { readonly conversationId: string; readonly agent: string }): { readonly release: () => void } | { readonly refused: string };
}

declare global {
  var __projectStudioAgentSlots: AgentSlotGate | undefined;
}

export function installAgentSlots(gate: AgentSlotGate | undefined): void {
  globalThis.__projectStudioAgentSlots = gate;
}
