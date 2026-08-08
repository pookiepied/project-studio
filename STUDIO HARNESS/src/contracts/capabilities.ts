/**
 * What an agent can do, and who says so.
 *
 * Everything executable in the harness — native tools now, MCP tools and
 * skill-provided actions later — is a capability, and every one of them is
 * admitted through the same policy boundary. There is deliberately no second
 * path: a subsystem that can execute without producing a `CapabilityDescriptor`
 * is a subsystem outside the permission system.
 */

/** Where a capability came from. Provenance is a trust input, not a label. */
export type CapabilityOrigin =
  /** Shipped with Project Studio and reviewed by us. */
  | "native"
  /** Provided by an MCP server, local or remote. */
  | "mcp"
  /** Contributed by a skill. */
  | "skill";

/**
 * What executing a capability actually does.
 *
 * Effects are declared by the *integrator* — the code registering the
 * capability — and never by the model, and never by a remote server describing
 * itself. An MCP server claiming its `delete_everything` tool is read-only must
 * not thereby become read-only.
 */
export type CapabilityEffect =
  /** Observes state without changing it. */
  | "read"
  /** Changes local state: files, settings, records. */
  | "write"
  /** Runs code or a subprocess. */
  | "execute"
  /** Sends or receives data outside the machine. */
  | "network";

/**
 * Stable identity for a capability.
 *
 * The namespace keeps two providers of `search` distinguishable, which is what
 * makes a grant meaningful: "allow search" has to mean allow *whose* search.
 */
export interface CapabilityId {
  /** Origin-scoped namespace, e.g. `native` or `mcp:github`. */
  readonly namespace: string;
  /** Capability name within the namespace, e.g. `read_file`. */
  readonly name: string;
}

export function capabilityKey(id: CapabilityId): string {
  return `${id.namespace}/${id.name}`;
}

export interface CapabilityProvenance {
  readonly origin: CapabilityOrigin;
  /**
   * Identifies the specific provider: an MCP server id, a skill id, or
   * `project-studio` for native capabilities.
   */
  readonly sourceId: string;
  /**
   * Whether the provider is part of the application's own trust boundary.
   * Only native capabilities are trusted; anything a user connected is not,
   * regardless of how it describes itself.
   */
  readonly trusted: boolean;
}

export interface CapabilityDescriptor {
  readonly id: CapabilityId;
  readonly title: string;
  readonly description: string;
  readonly effects: readonly CapabilityEffect[];
  readonly provenance: CapabilityProvenance;
  /**
   * Whether a repeated call with identical arguments is safe. Used when a call
   * fails without a definite outcome: a non-idempotent capability must not be
   * retried on an unknown result.
   */
  readonly idempotent: boolean;
}

/**
 * The authority a capability runs under.
 *
 * Every field is supplied by the application from its own state. None of it may
 * originate in a model-produced argument, a tool result, or anything a remote
 * server sent — that is the rule the whole permission system rests on, because
 * a scope the model can choose is a scope the model can widen.
 */
export interface ExecutionScope {
  /** The conversation the call belongs to. */
  readonly conversationId: string;
  /** The project whose resources are reachable, when one is bound. */
  readonly projectId: string | undefined;
  /**
   * The agent making the call. A subagent runs under its own identity so its
   * grants cannot be inherited from the parent by accident.
   */
  readonly agentId: string;
}

/** Effects that are never granted silently, whatever a stored grant says. */
export const ELEVATED_EFFECTS: readonly CapabilityEffect[] = ["execute", "network"];

export function hasElevatedEffect(descriptor: CapabilityDescriptor): boolean {
  return descriptor.effects.some((effect) => ELEVATED_EFFECTS.includes(effect));
}
