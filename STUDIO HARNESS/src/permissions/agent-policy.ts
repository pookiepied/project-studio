import type {
  CapabilityDescriptor,
  CapabilityEffect,
  ExecutionScope,
} from "../contracts/capabilities.js";
import type { StudioAgentDefinition } from "../contracts/agents.js";

/**
 * The agent-aware tool policy at the gate (ADR 0058 D4, Stage 3).
 *
 * One rule, from ADR 0024: *the list comes from the rule that decides the
 * call*. A delegate's calls are decided by its definition — the allowlist
 * says what its model may see, the effects ceiling says what its calls may
 * earn — so the list the gate hands a delegate's session is the allowlist
 * ∩ the conversation's gate, and the ceiling is checked at call time
 * beside the kernel's own verdict.
 *
 * Why a module and not inline in the sandbox factory: three readers ask
 * the same question (the `tools()` filter, the scope substitution, the
 * effects ceiling), and the resolution logic — execution context →
 * acting agent → definition → policy — is one derivation that must not
 * fork. Every reader imports it from here.
 */

/** What the acting-agent resolution answers for one assembly or call. */
export interface ActingAgentPolicy {
  /** The delegate's registered name, or undefined when the caller is the conversation agent. */
  readonly subagentName: string | undefined;
  /** The definition's tool allowlist, or undefined for the conversation agent (composes its own). */
  readonly allowedNatives: ReadonlySet<string> | undefined;
  /** The delegate's MCP namespace allowlist, or undefined for the conversation agent. */
  readonly allowedMcpNamespaces: ReadonlySet<string> | undefined;
  /** The ceiling on effects a delegate's calls may earn; undefined means no ceiling beyond the kernel's. */
  readonly maxEffects: readonly CapabilityEffect[] | undefined;
}

/** The conversation agent's policy: it composes its surface from live state. */
const CONVERSATION_POLICY: ActingAgentPolicy = {
  subagentName: undefined,
  allowedNatives: undefined,
  allowedMcpNamespaces: undefined,
  maxEffects: undefined,
};

/**
 * The policy for one acting agent, resolved from the execution context the
 * call is happening under.
 *
 * The subagent name comes from the Flue patch's one delegation hunk: child
 * task sessions carry `subagentName` on their execution-context frame, the
 * parent conversation's frames carry nothing, and that presence/absence is
 * the whole signal — `agentName` cannot serve, because on a child frame it
 * still names the submission's agent (the parent's), which is correct for
 * "who owns this durable work" and wrong for "who is acting now".
 *
 * An unknown name is `undefined`-free: a name on the frame that the
 * registry does not know is a harness-authoring bug (the `useSubagent`
 * mount resolves through the registry), and the honest answer is to treat
 * the caller as the most restrictive thing it could be — a delegate with
 * no allowlist. Refusing loudly here would fail a live conversation over
 * a load-time contract the registry already enforces; the architecture
 * test refuses the unregistered agent at build time instead.
 */
export function actingAgentPolicy(
  subagentName: string | undefined,
  registry: { byKind(kind: "delegate"): readonly { definition: StudioAgentDefinition }[] },
): ActingAgentPolicy {
  if (subagentName === undefined) return CONVERSATION_POLICY;
  const found = registry
    .byKind("delegate")
    .find((entry) => entry.definition.identity.agentName === subagentName);
  if (found === undefined) {
    return {
      subagentName,
      allowedNatives: new Set<string>(),
      allowedMcpNamespaces: new Set<string>(),
      maxEffects: ["read"],
    };
  }
  const tools = found.definition.tools;
  const permissions = found.definition.permissions;
  // A delegate is registry-validated to carry both fields, and the
  // missing case is impossible by construction: `assertKindPolicy`
  // refuses a delegate without them at load, before any conversation
  // could reach this line. The type guard states the same contract the
  // registry enforces, so a reader never has to take the narrowing on
  // faith.
  if (tools === undefined || permissions === undefined) return CONVERSATION_POLICY;
  return {
    subagentName,
    allowedNatives: new Set(tools.natives),
    allowedMcpNamespaces: new Set(tools.mcpNamespaces),
    maxEffects: permissions.maxEffects,
  };
}

/**
 * Whether a capability descriptor is visible to the acting agent.
 *
 * Native tools filter by name against the allowlist. MCP tools filter by
 * namespace: a delegate's MCP surface is its definition's static
 * namespace allowlist (resolved at spawn in a later stage — v1 delegates
 * hold none), and a namespace outside it is invisible even when the
 * conversation's gate holds it. The conversation agent sees everything
 * the gate lists, unchanged.
 *
 * `discover` is withheld from every delegate by name, allowlist or no
 * allowlist: adoption mutates the conversation's adopted set, and a
 * delegate adopting a tool would write into the parent's set — the
 * two-writer bug ADR 0029 exists to prevent (D4's recorded decision).
 */
export function visibleToAgent(
  descriptor: CapabilityDescriptor,
  policy: ActingAgentPolicy,
): boolean {
  if (policy.subagentName === undefined) return true;
  if (descriptor.id.namespace === "native") {
    if (descriptor.id.name === "discover") return false;
    return policy.allowedNatives?.has(descriptor.id.name) ?? false;
  }
  return policy.allowedMcpNamespaces?.has(descriptor.id.namespace) ?? false;
}

/**
 * The scope a call resolves under, for the acting agent.
 *
 * The captured scope's `agentId` is the conversation agent's — the scope
 * is built once per submission, and at build time the acting agent IS the
 * conversation. At call time it may be a delegate, and the delegate's
 * grants must be its own (ADR 0038's isolation property, #49): a standing
 * grant given to `studio` must not authorize `explore`'s call, and vice
 * versa. Substituting the agentId at the last moment — here, where the
 * frame says who is acting — is what makes that real, because the kernel
 * and the grant store both match on the scope they are handed.
 *
 * `conversationId` and the rest ride unchanged: the delegate shares the
 * parent conversation's containment (D3), so grants scoped to the
 * conversation still apply — keyed to the delegate's agentId, which is
 * exactly the isolation ADR 0038 stores.
 */
export function scopeForActingAgent(
  scope: ExecutionScope,
  policy: ActingAgentPolicy,
): ExecutionScope {
  if (policy.subagentName === undefined) return scope;
  return { ...scope, agentId: policy.subagentName };
}

/**
 * Whether a capability's effects sit within the acting agent's ceiling.
 *
 * The three-layer read-only agreement (allowlist ∩ ceiling ∩ kernel): the
 * allowlist keeps the model from seeing a writer, this keeps a writer
 * that somehow gets called from being *authorized* by anything but an
 * explicit refusal, and the kernel holds the actual boundary. Checked at
 * the gate, before the kernel is consulted, so a ceiling violation is a
 * refusal the model can read — not a tool that silently does nothing.
 */
export function effectsWithinCeiling(
  descriptor: CapabilityDescriptor,
  policy: ActingAgentPolicy,
): boolean {
  const ceiling = policy.maxEffects;
  if (ceiling === undefined) return true;
  return descriptor.effects.every((effect) => ceiling.includes(effect));
}
