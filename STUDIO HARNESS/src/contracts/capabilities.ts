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

/**
 * The one string that identifies a capability everywhere: in the registry, in a
 * stored grant, in a policy rule, in a log line.
 *
 * The join is unescaped, so the two halves must not contain the separator. See
 * `assertValidCapabilityId`, which is what makes that safe to rely on.
 */
export function capabilityKey(id: CapabilityId): string {
  return `${id.namespace}/${id.name}`;
}

/** The character `capabilityKey` joins with, and therefore the one neither half may contain. */
const KEY_SEPARATOR = "/";

/**
 * Refuses an id that cannot be turned into a key unambiguously.
 *
 * `{namespace: "mcp:a", name: "b/c"}` and `{namespace: "mcp:a/b", name: "c"}`
 * produce the identical key `mcp:a/b/c`. Today every namespace and name is
 * written by us, so the collision is unreachable. From Phase 11 a connected MCP
 * server supplies its own tool names, and a server that picks `b/c` would land
 * on another server's key — inheriting its grants.
 *
 * Refused at registration rather than escaped at the join. Escaping would keep
 * the ids distinct but make the key unreadable in every log and every stored
 * grant row, to permit a name nobody has a reason to use.
 *
 * Returns the problem instead of throwing: this file sits below every
 * subsystem, so it cannot reach `PermissionError` without a cycle, and a raw
 * `Error` from `src/` is exactly what the error taxonomy forbids. The caller
 * knows which domain it is failing in.
 */
export function capabilityIdProblem(id: CapabilityId): string | undefined {
  for (const [part, value] of [
    ["namespace", id.namespace],
    ["name", id.name],
  ] as const) {
    if (typeof value !== "string" || value.trim() === "") {
      return `A capability ${part} must not be empty.`;
    }
    if (value.includes(KEY_SEPARATOR)) {
      return `A capability ${part} must not contain "${KEY_SEPARATOR}": received "${value}".`;
    }
  }
  return undefined;
}

/**
 * Who wrote the code behind a capability.
 *
 * Answers exactly one question — *did we review this* — and is read only by the
 * permission policy. A capability we shipped has been through our review; one a
 * user connected has not, however it describes itself.
 */
export type CapabilityAuthor =
  /** Written, reviewed, and shipped by us. */
  | "studio"
  /** Written by someone else. A connected server, a contributed skill. */
  | "third-party";

/**
 * Where a capability came from.
 *
 * `author` replaced a boolean named `trusted` in Phase 11. That boolean had
 * three readers asking three different questions — can this be contained, must
 * a human see it, may it run unattended — and it answered all of them only
 * while *we wrote it*, *it runs in our process*, and *it is safe unattended*
 * were the same fact.
 *
 * An MCP server breaks that in both directions at once: a server the user
 * installs is unreviewed code they consented to, and a server we bundle is
 * reviewed code running outside our process. Whichever value the boolean took,
 * two of its three readers would have been wrong. See ADR 0025.
 *
 * There is deliberately no second field for *where* the code runs. Nothing
 * reads it: what isolation an effect needs is the effect table's question, and
 * whether a program sits outside the folder wall is something the install
 * dialog reads from the server record, not from a descriptor.
 */
export interface CapabilityProvenance {
  readonly origin: CapabilityOrigin;
  /**
   * Identifies the specific provider: an MCP server id, a skill id, or
   * `project-studio` for native capabilities.
   */
  readonly sourceId: string;
  /** Did we review this code? Read by `BASE_POLICY` and `defaultVerdict`. */
  readonly author: CapabilityAuthor;
}

/**
 * Provenance for a capability that ships with the harness and runs inside it.
 *
 * The overwhelmingly common case, and worth a name: nine native tools repeated
 * the same object literal, and a literal repeated nine times is a default that
 * has not been written down. A tenth tool now inherits the right answer instead
 * of copying whichever neighbour it was pasted from.
 */
export const NATIVE_PROVENANCE: CapabilityProvenance = {
  origin: "native",
  sourceId: "project-studio",
  author: "studio",
};

export interface CapabilityDescriptor {
  readonly id: CapabilityId;
  readonly title: string;
  readonly description: string;
  /**
   * The input schema shown with a connected tool. The kernel hashes this with
   * the name and description so an approval cannot survive a changed tool.
   * Native capabilities do not need this field because their definitions ship
   * with the harness.
   */
  readonly inputSchema?: unknown;
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
  /** The admitted local client/session that owns this execution. */
  readonly clientId?: string;
  readonly sessionId?: string;
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

/**
 * What each effect *means* lives in `effects.ts`, not here.
 *
 * This file declares the vocabulary — the four effects, and the shape a
 * capability takes. That file holds the one table saying what each effect
 * requires. Re-exported so callers reading a descriptor do not have to know
 * which of the two files to import from.
 */
export {
  allowedWhileUntrusted,
  hasElevatedEffect,
  isReadOnly,
  requiresUndoPoint,
} from "./effects.js";
