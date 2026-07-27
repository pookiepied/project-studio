import {
  capabilityKey,
  type CapabilityDescriptor,
  type CapabilityId,
  type ExecutionScope,
} from "../contracts/capabilities.js";
import type { ErrorReporter } from "../observability/error-reporter.js";
import { PermissionError } from "./errors.js";
import type { PermissionGrantStore } from "./grant-store.js";
import {
  BASE_POLICY,
  defaultVerdict,
  type GrantDuration,
  type PermissionDecision,
  type PermissionRequest,
  type PolicyRule,
} from "./policy.js";

/**
 * The single source of permission for the harness.
 *
 * Native tools, MCP tools, and skill-provided actions all decide here. That is
 * the whole point: the moment a second place can authorize execution, the
 * answer to "what is this agent allowed to do" stops being knowable.
 *
 * The kernel decides. It does not execute, and it does not prompt — an approver
 * is injected, so the same policy runs identically in the UI, in a CLI, and in
 * a test.
 */

/** Asks the user. Returning `undefined` means no approver was available. */
export interface PermissionApprover {
  request(
    request: PermissionRequest,
    decision: PermissionDecision,
  ): Promise<{ verdict: "allow" | "deny"; duration: GrantDuration } | undefined>;
}

export interface PermissionKernelOptions {
  readonly grants: PermissionGrantStore;
  readonly approver?: PermissionApprover;
  readonly reporter?: ErrorReporter;
  /** Overridable for tests; production uses `BASE_POLICY`. */
  readonly policy?: readonly PolicyRule[];
}

export class PermissionKernel {
  readonly #registry = new Map<string, CapabilityDescriptor>();
  readonly #grants: PermissionGrantStore;
  readonly #approver: PermissionApprover | undefined;
  readonly #reporter: ErrorReporter | undefined;
  readonly #policy: readonly PolicyRule[];

  constructor(options: PermissionKernelOptions) {
    this.#grants = options.grants;
    this.#approver = options.approver;
    this.#reporter = options.reporter;
    this.#policy = options.policy ?? BASE_POLICY;
  }

  /**
   * Registers a capability.
   *
   * Registration is how the kernel knows a capability's effects and
   * provenance. Nothing unregistered can be decided about, which is why an
   * unknown capability is denied rather than asked about: there is no honest
   * prompt to show for something whose effects are unknown.
   */
  register(descriptor: CapabilityDescriptor): void {
    const key = capabilityKey(descriptor.id);
    const existing = this.#registry.get(key);

    if (existing && existing.provenance.sourceId !== descriptor.provenance.sourceId) {
      // Two providers claiming one name is a collision, not an update. Silently
      // replacing would let a connected server shadow a native capability.
      throw new PermissionError("internal", {
        message: `Capability "${key}" is already registered by a different provider.`,
        capability: key,
      });
    }

    this.#registry.set(key, descriptor);
  }

  get(id: CapabilityId): CapabilityDescriptor | undefined {
    return this.#registry.get(capabilityKey(id));
  }

  list(): readonly CapabilityDescriptor[] {
    return [...this.#registry.values()];
  }

  /**
   * Decides whether a call may proceed, without prompting.
   *
   * Order is load-bearing: policy first, then stored grants, then the default.
   * A grant can never overturn a policy rule, so approving something once
   * cannot widen what the rules allow later.
   */
  evaluate(id: CapabilityId, scope: ExecutionScope): PermissionDecision {
    assertScope(scope);

    const capability = this.#registry.get(capabilityKey(id));
    if (!capability) {
      return {
        verdict: "deny",
        source: "policy",
        reason: `${capabilityKey(id)} is not a registered capability.`,
        grantId: undefined,
      };
    }

    const request: PermissionRequest = { capability, scope };

    for (const rule of this.#policy) {
      const verdict = rule.evaluate(request);
      if (verdict !== undefined) {
        // A policy `ask` still consults grants below — the rule is that the
        // user must be asked *once*, not on every call forever.
        if (verdict !== "ask") {
          return { verdict, source: "policy", reason: rule.reason, grantId: undefined };
        }

        const granted = this.#grants.find(id, scope);
        return granted
          ? {
              verdict: "allow",
              source: "grant",
              reason: "You approved this previously.",
              grantId: granted.id,
            }
          : { verdict: "ask", source: "policy", reason: rule.reason, grantId: undefined };
      }
    }

    const granted = this.#grants.find(id, scope);
    if (granted) {
      return {
        verdict: "allow",
        source: "grant",
        reason: "You approved this previously.",
        grantId: granted.id,
      };
    }

    return defaultVerdict(capability);
  }

  /**
   * Decides, prompting when the decision requires it, and raises when the call
   * may not proceed.
   *
   * Callers get a value only when execution is authorized, so there is no shape
   * in which a caller can accidentally treat "needs approval" as permission.
   */
  async authorize(id: CapabilityId, scope: ExecutionScope): Promise<PermissionDecision> {
    const decision = this.evaluate(id, scope);

    if (decision.verdict === "allow") return decision;

    if (decision.verdict === "deny") {
      throw this.#refuse("denied", id, decision);
    }

    const capability = this.#registry.get(capabilityKey(id));
    if (!capability || !this.#approver) {
      // No approver means nobody is watching. Proceeding would turn every
      // unattended run into a silent grant of everything it asked for.
      throw this.#refuse("approval_required", id, decision);
    }

    const answer = await this.#approver.request({ capability, scope }, decision);
    if (!answer || answer.verdict === "deny") {
      // Not `decision.reason`: that explains why the user was asked, and
      // repeating it after they answered would report a call the user just
      // declined as merely unapproved.
      throw this.#refuse("denied", id, {
        ...decision,
        verdict: "deny",
        reason: "You declined this action.",
      });
    }

    const grant = this.#grants.grant(id, scope, answer.duration);
    return {
      verdict: "allow",
      source: "grant",
      reason: "You approved this.",
      grantId: grant?.id,
    };
  }

  #refuse(
    kind: "denied" | "approval_required",
    id: CapabilityId,
    decision: PermissionDecision,
  ): PermissionError {
    const key = capabilityKey(id);
    const error = new PermissionError(kind, {
      message: decision.reason,
      capability: key,
    });

    // Every refusal is reported. A permission system nobody can audit is a
    // permission system nobody can trust.
    this.#reporter?.report(error, {
      operation: "permissions.authorize",
      capability: key,
      decision_source: decision.source,
      agent_id: id.namespace,
    });

    return error;
  }
}

/**
 * Rejects a scope the application did not fully supply.
 *
 * This is the check that keeps authority out of the model's hands. A blank
 * agent or conversation id would collapse distinct scopes into one shared
 * bucket, so a grant given in one conversation would silently apply everywhere.
 */
function assertScope(scope: ExecutionScope): void {
  if (
    typeof scope.agentId !== "string" ||
    scope.agentId.trim() === "" ||
    typeof scope.conversationId !== "string" ||
    scope.conversationId.trim() === ""
  ) {
    throw new PermissionError("invalid_scope");
  }
}
