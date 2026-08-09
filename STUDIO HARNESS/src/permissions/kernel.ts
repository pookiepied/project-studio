import {
  capabilityIdProblem,
  capabilityKey,
  type CapabilityDescriptor,
  type CapabilityId,
  type ExecutionScope,
} from "../contracts/capabilities.js";
import type { ErrorReporter } from "../observability/error-reporter.js";
import { PermissionError } from "./errors.js";
import type { PermissionGrantStore } from "./grant-store.js";
import type { ResourceKind } from "./matcher.js";
import { describeMode, resolveAsk } from "./mode.js";
import { offerScopes, resolveScope } from "./scopes.js";
import {
  allowedWhileUntrusted,
  UNGATED_POSTURE,
  type ExecutionPosture,
} from "./trust.js";
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

/**
 * What the call is about to touch.
 *
 * Separate from `ExecutionScope`, which is *who* is calling. This is *what*,
 * and it is what lets `git:log` and `git:push` be decided differently.
 */
export interface CallResource {
  /** Derived by the integrator from the arguments; never the raw argument. */
  readonly resource: string | undefined;
  readonly kind: ResourceKind;
  /**
   * The workspace root, used to cap how wide an approval may be offered.
   *
   * Without it the widest rung is still the resource's own folder, which is
   * safe but repetitive. With it, "this project" becomes offerable — and,
   * importantly, nothing above it ever is.
   */
  readonly root?: string;
}

/**
 * What the user answered.
 *
 * Two independent axes, and keeping them independent is deliberate: breadth is
 * *what* is covered, duration is *how long*. Collapsing them into one list of
 * options would produce a six-item dialog and would quietly drop the
 * combinations people actually want, like "this whole folder, but only for now".
 */
export interface PermissionAnswer {
  readonly verdict: "allow" | "deny";
  readonly duration: GrantDuration;
  /**
   * The `id` of one of the scopes offered in the request.
   *
   * Not a pattern. An approver picks from what it was given and cannot author
   * anything, so a dialog is incapable of granting more than it showed. Omitted
   * means the narrowest offered scope.
   */
  readonly scopeId?: string;
}

/** Asks the user. Returning `undefined` means no approver was available. */
export interface PermissionApprover {
  request(
    request: PermissionRequest,
    decision: PermissionDecision,
  ): Promise<PermissionAnswer | undefined>;
}

export interface PermissionKernelOptions {
  readonly grants: PermissionGrantStore;
  readonly approver?: PermissionApprover;
  readonly reporter?: ErrorReporter;
  /** Overridable for tests; production uses `BASE_POLICY`. */
  readonly policy?: readonly PolicyRule[];
  /**
   * Workspace trust and the execution mode. Omitted means `UNGATED_POSTURE` —
   * every folder trusted, every `ask` asked — which is the pre-trust behaviour
   * and is correct for a fixture, not for the application.
   */
  readonly posture?: ExecutionPosture;
}

export class PermissionKernel {
  readonly #registry = new Map<string, CapabilityDescriptor>();
  readonly #grants: PermissionGrantStore;
  readonly #approver: PermissionApprover | undefined;
  readonly #reporter: ErrorReporter | undefined;
  readonly #policy: readonly PolicyRule[];
  readonly #posture: ExecutionPosture;

  constructor(options: PermissionKernelOptions) {
    this.#posture = options.posture ?? UNGATED_POSTURE;
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

    // The key is a plain join, so an id containing the separator would produce
    // a key another id already owns — and grants, policy rules and audit lines
    // are all keyed by that string. Refused at the only door capabilities come
    // through, which is why nothing downstream has to re-check it.
    const problem = capabilityIdProblem(descriptor.id);
    if (problem) {
      throw new PermissionError("internal", { message: problem, capability: key });
    }

    // An empty effect list is the most permissive thing a capability can
    // declare. Every rule of the form "do all of its effects allow this?" is
    // vacuously true for nothing, so it would be read-only, allowed in an
    // untrusted folder, and auto-allowed by default — all earned by declaring
    // nothing at all.
    //
    // Refused here rather than defended against in each reader, which is the
    // same principle as the one table in `contracts/effects.ts`: one place
    // decides, and nobody else has to remember. A capability that does nothing
    // does not need to exist, and one that does something has to say so.
    if (descriptor.effects.length === 0) {
      throw new PermissionError("internal", {
        message: `Capability "${key}" declares no effects. Every capability must declare what it does.`,
        capability: key,
      });
    }

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
  evaluate(
    id: CapabilityId,
    scope: ExecutionScope,
    call: CallResource = { resource: undefined, kind: "path" },
  ): PermissionDecision {
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

    // Trust is a precondition, not a rule, so it sits ahead of the policy list
    // *and* ahead of grants. A grant collected while a folder was trusted must
    // not outlive the user changing their mind about the folder.
    //
    // Denied, never asked. Asking would let a model that keeps trying collect
    // the same authority one click at a time, which is exactly what answering
    // the question once, about the folder, is for.
    const trust = this.#posture.trust(call.root);
    if (trust !== "trusted" && !allowedWhileUntrusted(capability)) {
      return {
        verdict: "deny",
        source: "policy",
        reason:
          trust === "undecided"
            ? "This folder has not been trusted yet, so only reading is allowed."
            : "This folder is marked as not trusted, so only reading is allowed.",
        grantId: undefined,
      };
    }

    const request: PermissionRequest = {
      capability,
      scope,
      resource: call.resource,
      scopes: offerScopes({
        resource: call.resource,
        kind: call.kind,
        root: call.root,
      }),
    };

    for (const rule of this.#policy) {
      const verdict = rule.evaluate(request);
      if (verdict !== undefined) {
        // A policy `ask` still consults grants below — the rule is that the
        // user must be asked *once*, not on every call forever.
        if (verdict !== "ask") {
          return { verdict, source: "policy", reason: rule.reason, grantId: undefined };
        }

        const granted = this.#grants.find(id, scope, call.resource, call.kind);
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

    const granted = this.#grants.find(id, scope, call.resource, call.kind);
    if (granted) {
      return {
        verdict: "allow",
        source: "grant",
        reason: "You approved this previously.",
        grantId: granted.id,
      };
    }

    const fallback = defaultVerdict(capability);
    if (fallback.verdict !== "ask") return fallback;

    // The mode resolves *this* `ask` and no other. An `ask` from a policy rule
    // returned above and never reaches here, which is the invariant that keeps
    // BASE_POLICY from becoming advisory: Full Auto still prompts before a
    // connected server runs code.
    const mode = this.#posture.mode();
    if (resolveAsk(mode, capability) === "allow") {
      return {
        verdict: "allow",
        source: "default",
        reason: describeMode(mode),
        grantId: undefined,
      };
    }

    return fallback;
  }

  /**
   * Decides, prompting when the decision requires it, and raises when the call
   * may not proceed.
   *
   * Callers get a value only when execution is authorized, so there is no shape
   * in which a caller can accidentally treat "needs approval" as permission.
   */
  async authorize(
    id: CapabilityId,
    scope: ExecutionScope,
    call: CallResource = { resource: undefined, kind: "path" },
  ): Promise<PermissionDecision> {
    const decision = this.evaluate(id, scope, call);

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

    const scopes = offerScopes({
      resource: call.resource,
      kind: call.kind,
      root: call.root,
    });

    const answer = await this.#approver.request(
      { capability, scope, resource: call.resource, scopes },
      decision,
    );
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

    const { scope: chosen, recognized } = resolveScope(scopes, answer.scopeId);

    if (!recognized) {
      // An approver answering with something we did not offer is a bug in the
      // approver, and it has already been handled safely — `resolveScope`
      // narrowed it. Reported so a broken UI shows up as repetitive prompting
      // with a cause, rather than as a mystery.
      this.#reporter?.report(
        new PermissionError("internal", {
          message: `Approver chose an unoffered scope "${answer.scopeId}".`,
          capability: capabilityKey(id),
        }),
        { operation: "permissions.authorize", capability: capabilityKey(id) },
      );
    }

    const grant = this.#grants.grant(id, scope, answer.duration, chosen?.pattern);
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
