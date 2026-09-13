import type { AuthContext } from "../admission/context.js";
import { createStudioUuid } from "../contracts/uuid.js";
import type {
  PermissionAnswer,
  PermissionApprover,
} from "../permissions/kernel.js";
import type {
  PermissionDecision,
  PermissionRequest,
} from "../permissions/policy.js";
import { PendingApprovalStore } from "../permissions/pending-approvals.js";

export interface PendingPermissionApproval {
  readonly id: string;
  readonly request: PermissionRequest;
  readonly decision: PermissionDecision;
  readonly createdAt: number;
}

interface PendingEntry extends PendingPermissionApproval {
  readonly resolve: (answer: PermissionAnswer | undefined) => void;
  readonly cleanup: () => void;
}

export interface PermissionApprovalBrokerOptions {
  /**
   * Where pending questions are recorded.
   *
   * Optional only so a unit test can exercise the in-process half alone. The
   * server always supplies one: without it a restart loses every unanswered
   * question and the person is never asked again (ADR 0036).
   */
  readonly store?: PendingApprovalStore;
}

/**
 * The local person-facing approval channel.
 *
 * An unattended process has no honest answer to a policy ask. Keeping the
 * request pending makes that absence visible to the local UI instead of turning
 * it into an allow or a retry loop.
 */
export class PermissionApprovalBroker implements PermissionApprover {
  /**
   * The live half: the promises callers are parked on.
   *
   * Necessarily in memory — a promise cannot outlive its process. The durable
   * half is the store, and the two are kept in step by writing before the
   * caller parks and deleting on every exit path.
   */
  readonly #pending = new Map<string, PendingEntry>();
  readonly #store: PendingApprovalStore | undefined;

  constructor(options: PermissionApprovalBrokerOptions = {}) {
    this.#store = options.store;
  }

  request(
    request: PermissionRequest,
    decision: PermissionDecision,
    signal?: AbortSignal,
  ): Promise<PermissionAnswer | undefined> {
    const id = createStudioUuid();
    if (signal?.aborted) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      const onAbort = (): void => {
        const entry = this.#pending.get(id);
        if (entry === undefined) return;
        this.#pending.delete(id);
        this.#store?.remove(id);
        entry.cleanup();
        resolve(undefined);
      };
      const cleanup = (): void => signal?.removeEventListener("abort", onAbort);
      const createdAt = Date.now();
      // Recorded before the caller parks. The other order has a window in
      // which a crash loses a question that was already being waited on.
      this.#store?.add({ id, request, decision, createdAt });
      this.#pending.set(id, {
        id,
        request,
        decision,
        createdAt,
        resolve,
        cleanup,
      });
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  /**
   * Every question still waiting, including ones inherited from a previous
   * process.
   *
   * The store is the source of truth precisely because it outlives a restart —
   * reading the `Map` would show only what this process asked, which after a
   * crash is nothing.
   */
  list(_auth: AuthContext): readonly PendingPermissionApproval[] {
    if (this.#store !== undefined) return this.#store.list();
    return [...this.#pending.values()].map(({ id, request, decision, createdAt }) => ({
      id,
      request,
      decision,
      createdAt,
    }));
  }

  answer(id: string, answer: PermissionAnswer, _auth: AuthContext): boolean {
    return this.#settle(id, answer);
  }

  cancel(id: string, _auth: AuthContext): boolean {
    return this.#settle(id, undefined);
  }

  /**
   * Closes a question, whoever asked it.
   *
   * A row with no live waiter is one this process inherited: the run that was
   * waiting on it is gone, so there is nothing to resolve, but the question is
   * genuinely answered and must leave the queue. Reporting `false` there would
   * make the UI show an approval it had just actioned.
   */
  #settle(id: string, answer: PermissionAnswer | undefined): boolean {
    const entry = this.#pending.get(id);
    if (entry === undefined) {
      const inherited = this.#store?.list().some((pending) => pending.id === id) ?? false;
      if (!inherited) return false;
      this.#store?.remove(id);
      return true;
    }

    this.#pending.delete(id);
    this.#store?.remove(id);
    entry.cleanup();
    entry.resolve(answer);
    return true;
  }
}
