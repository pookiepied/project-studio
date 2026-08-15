import type { AuthContext } from "../admission/context.js";
import { createStudioUuid } from "../identity/uuid.js";
import type {
  PermissionAnswer,
  PermissionApprover,
} from "../permissions/kernel.js";
import type {
  PermissionDecision,
  PermissionRequest,
} from "../permissions/policy.js";

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

/**
 * The local person-facing approval channel.
 *
 * An unattended process has no honest answer to a policy ask. Keeping the
 * request pending makes that absence visible to the local UI instead of turning
 * it into an allow or a retry loop.
 */
export class PermissionApprovalBroker implements PermissionApprover {
  readonly #pending = new Map<string, PendingEntry>();

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
        entry.cleanup();
        resolve(undefined);
      };
      const cleanup = (): void => signal?.removeEventListener("abort", onAbort);
      this.#pending.set(id, {
        id,
        request,
        decision,
        createdAt: Date.now(),
        resolve,
        cleanup,
      });
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  list(_auth: AuthContext): readonly PendingPermissionApproval[] {
    return [...this.#pending.values()].map(({ id, request, decision, createdAt }) => ({
      id,
      request,
      decision,
      createdAt,
    }));
  }

  answer(id: string, answer: PermissionAnswer, _auth: AuthContext): boolean {
    const entry = this.#pending.get(id);
    if (entry === undefined) return false;
    this.#pending.delete(id);
    entry.cleanup();
    entry.resolve(answer);
    return true;
  }

  cancel(id: string, _auth: AuthContext): boolean {
    const entry = this.#pending.get(id);
    if (entry === undefined) return false;
    this.#pending.delete(id);
    entry.cleanup();
    entry.resolve(undefined);
    return true;
  }
}
