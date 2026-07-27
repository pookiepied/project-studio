import {
  capabilityKey,
  hasElevatedEffect,
  type CapabilityDescriptor,
  type ExecutionScope,
} from "../contracts/capabilities.js";
import { matchesResource, type ResourceKind } from "./matcher.js";

/**
 * What the kernel concluded, and why.
 *
 * `ask` is a real outcome, not a failure. Treating "needs approval" as an error
 * pushes callers into catching it and guessing, which is how approval prompts
 * turn into silent allows.
 */
export type PermissionVerdict = "allow" | "deny" | "ask";

/** Where a decision came from. Rendered to the user, so it must be truthful. */
export type DecisionSource =
  /** A rule that cannot be overridden by a grant. */
  | "policy"
  /** A previously stored user decision. */
  | "grant"
  /** The fallback applied when nothing else matched. */
  | "default";

export interface PermissionDecision {
  readonly verdict: PermissionVerdict;
  readonly source: DecisionSource;
  /** Short, user-facing explanation. Never contains call arguments. */
  readonly reason: string;
  /** Set when a stored grant decided this. */
  readonly grantId: string | undefined;
}

export interface PermissionRequest {
  readonly capability: CapabilityDescriptor;
  readonly scope: ExecutionScope;
  /**
   * What the call actually touches — a resolved path, or `git:push`.
   *
   * Derived by the integrator from the call's arguments, never taken from the
   * model verbatim. It is `undefined` for a capability whose arguments do not
   * narrow what it reaches.
   */
  readonly resource: string | undefined;
}

/** How long an approval lasts. */
export type GrantDuration =
  /** This call only; nothing is stored. */
  | "once"
  /** Until the conversation ends. */
  | "conversation"
  /** Until the user revokes it. */
  | "always";

/**
 * A rule the user cannot grant their way past.
 *
 * These exist because some decisions are not the user's to make in the moment:
 * a model that can talk a user into one click should not thereby reach an
 * unregistered capability.
 */
export interface PolicyRule {
  readonly id: string;
  /** Returns a verdict to short-circuit, or undefined to fall through. */
  readonly evaluate: (request: PermissionRequest) => PermissionVerdict | undefined;
  readonly reason: string;
}

/**
 * Rules evaluated before any stored grant, in order.
 *
 * Deliberately short. A long list of hardcoded rules is a policy nobody can
 * reason about; the extensibility point is grants, not this array.
 */
export const BASE_POLICY: readonly PolicyRule[] = [
  {
    id: "untrusted-elevated",
    reason:
      "Running code or reaching the network from a connected server always needs approval.",
    evaluate: ({ capability }) =>
      !capability.provenance.trusted && hasElevatedEffect(capability)
        ? "ask"
        : undefined,
  },
];

/**
 * Builds a rule that matches a capability and, optionally, what it touches.
 *
 * This is the shape user-authored and project-authored rules take: "allow
 * `native/edit` under `src/**`", "always ask before `native/git` `git:push`".
 * Writing them by hand as `evaluate` closures would put arbitrary code in the
 * policy path, where it could not be stored, listed, or shown to a user.
 */
export function resourceRule(input: {
  readonly id: string;
  readonly capability: string;
  readonly resource?: string;
  readonly kind?: ResourceKind;
  readonly verdict: PermissionVerdict;
  readonly reason: string;
}): PolicyRule {
  const kind: ResourceKind = input.kind ?? "path";

  return {
    id: input.id,
    reason: input.reason,
    evaluate: (request) => {
      if (capabilityKey(request.capability.id) !== input.capability) return undefined;
      return matchesResource(input.resource, request.resource, kind)
        ? input.verdict
        : undefined;
    },
  };
}

/**
 * The fallback when no rule and no grant matched.
 *
 * Read-only capabilities from our own code are allowed; everything else asks.
 * Defaulting to `allow` for anything that writes, executes, or reaches the
 * network would mean the first time a user hears about a capability is after it
 * has already run.
 */
export function defaultVerdict(capability: CapabilityDescriptor): PermissionDecision {
  const readOnly = capability.effects.every((effect) => effect === "read");

  if (readOnly && capability.provenance.trusted) {
    return {
      verdict: "allow",
      source: "default",
      reason: "Reads no more than it needs and ships with Project Studio.",
      grantId: undefined,
    };
  }

  return {
    verdict: "ask",
    source: "default",
    reason: `${capabilityKey(capability.id)} has not been approved yet.`,
    grantId: undefined,
  };
}
