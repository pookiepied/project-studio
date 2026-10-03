import * as v from "valibot";

import type { Agent } from "@flue/runtime";

import { StudioError } from "../../contracts/errors.js";
import {
  studioAgentDefinitionSchema,
  type AgentKind,
  type StudioAgentDefinition,
  type StudioAgentDefinitionInput,
} from "../../contracts/agents.js";

/**
 * The agent registry (ADR 0058 D1, Stage 2).
 *
 * One place that answers "what agents does this harness have", as
 * definitions rather than scattered modules. The registry exists so the
 * questions coming in Stages 3–5 have one answer with one shape: which
 * delegate the model may name on the `task` tool, what allowlist a
 * delegate's tool visibility resolves against, what consent default its
 * calls carry, what a settings roster shows. Nothing here changes what the
 * four live agents do — that is the Stage 2 gate — it names what they are.
 *
 * **Load-time validation, not first-use validation.** A definition that
 * fails fails the process start, the same contract Flue's own scanner
 * enforces (duplicate identities refuse the build). A conversation must
 * never be the first thing to discover that a delegate's allowlist names a
 * tool that does not exist.
 *
 * The registry is deliberately NOT the registration mechanism: Flue's
 * `'use agent'` scan still registers the agent functions with the runtime,
 * and `dispatch` still resolves by function value. What this registry adds
 * is the data beside those functions — validated once, addressable by name.
 */

/**
 * A definition together with the agent function it describes.
 *
 * The pairing is what makes the registry honest: a definition with no
 * function is a roster line about nothing, and a function with no
 * definition is a mount the architecture test refuses (every agent the
 * harness mounts or dispatches resolves through the registry).
 */
export interface RegisteredAgent {
  readonly definition: StudioAgentDefinition;
  /** The same function object the module exports and Flue registers. */
  readonly agent: Agent;
}

/** One entry per failure the registry can refuse. */
export type AgentRegistryErrorKind =
  | "invalid"
  | "duplicate-name"
  | "unknown-native-tool"
  | "unknown-skill"
  | "kind-policy";

export class AgentRegistryError extends StudioError {
  readonly domain = "agents" as const;

  constructor(
    kind: AgentRegistryErrorKind,
    message: string,
    private readonly details: Record<string, unknown> = {},
  ) {
    super(kind, message, { retryable: false });
    this.name = "AgentRegistryError";
  }

  toDetails(): Record<string, unknown> {
    return this.details;
  }
}

/**
 * The native tool names the shipped families register, as a closed list the
 * allowlist validation checks against.
 *
 * Hand-maintained in step with `src/tools/native/index.ts`, and the
 * maintenance is the point: a new native tool is a decision about what every
 * conversation agent can do, and this list is where that decision has to be
 * repeated before any definition may name the tool. A registry that
 * validated against the live gate instead would answer "what exists in this
 * composition", which is a question a test composition can make lie.
 *
 * `task` is deliberately absent: it is Flue's framework tool, present in
 * every tool array, not a native capability a definition allowlists.
 */
const NATIVE_TOOL_NAMES: ReadonlySet<string> = new Set([
  "read",
  "write",
  "edit",
  "delete",
  "move",
  "glob",
  "grep",
  "git",
  "shell",
  "jobs",
  "discover",
  "ask_user_question",
  "request_folder",
  "plan",
  "library_search",
  "library_keep",
  "studio_image",
  "studio_video",
  "ocr",
  "web_search",
  "fetch",
]);

/**
 * The skills Studio ships, as a closed list the skill-allowlist validation
 * checks against. A user's own skills folder is not part of this list and
 * never can be: a definition naming a skill only this machine's user
 * installed would be a definition that behaves differently per machine.
 *
 * Same maintenance contract as `NATIVE_TOOL_NAMES`: adding a bundled skill
 * is a decision, and this list is where it is repeated.
 */
const BUNDLED_SKILL_IDS: ReadonlySet<string> = new Set(["create-skill", "customize-studio"]);

/**
 * The cross-field rules a schema cannot express: what each kind of agent may
 * say about itself. These are the per-kind contract, in code because they
 * encode decisions, not shapes.
 *
 * - A **conversation** agent composes its tools, skills and permissions from
 *   per-conversation state (the selection chain, the settled mode). A static
 *   allowlist here would be a second, competing source of the same answer,
 *   so the definition says none of the three.
 * - A **background** agent mounts no sandbox and no tools — that is the
 *   security property the title/describe/improve tests assert by shape — so
 *   the same three fields are refused for the same reason as on a
 *   conversation agent, from the other side.
 * - A **delegate** is the one kind the fields exist for, and they are
 *   mandatory: a delegate without a tool allowlist would inherit the
 *   parent's whole array (the Stage 0 measurement), which is exactly the
 *   visibility/authority gap D4 exists to close.
 */
function assertKindPolicy(definition: StudioAgentDefinitionInput): void {
  const staticPolicyFields = [
    definition.tools !== undefined,
    definition.skills !== undefined,
    definition.permissions !== undefined,
  ];

  if (definition.kind === "delegate") {
    if (staticPolicyFields.some((present) => !present)) {
      throw new AgentRegistryError(
        "kind-policy",
        `The delegate "${definition.identity.agentName}" must declare its tools, skills and permissions: a delegate without an allowlist inherits the parent's whole tool array.`,
        { agentName: definition.identity.agentName },
      );
    }
    return;
  }

  if (staticPolicyFields.some((present) => present)) {
    throw new AgentRegistryError(
      "kind-policy",
      `The ${definition.kind} agent "${definition.identity.agentName}" composes its tools, skills and permissions from live state, not from a static allowlist; remove the field(s).`,
      { agentName: definition.identity.agentName },
    );
  }
}

/** Validates and normalizes one definition record. Throws at load, never mid-run. */
export function validateAgentDefinition(input: unknown): StudioAgentDefinition {
  const parsed = v.safeParse(studioAgentDefinitionSchema, input);
  if (!parsed.success) {
    // The flattened issues are strings already; joining them keeps the
    // message a sentence while the details carry the structured shape.
    const flat = v.flatten(parsed.issues);
    const summary = Array.isArray(flat.root) ? flat.root.join("; ") : "(no summary)";
    throw new AgentRegistryError(
      "invalid",
      `An agent definition failed schema validation: ${summary}.`,
      { issues: flat },
    );
  }
  const definition = parsed.output;
  assertKindPolicy(definition);

  if (definition.tools !== undefined) {
    const unknown = definition.tools.natives.filter((name) => !NATIVE_TOOL_NAMES.has(name));
    if (unknown.length > 0) {
      throw new AgentRegistryError(
        "unknown-native-tool",
        `The delegate "${definition.identity.agentName}" names native tools that do not exist: ${unknown.join(", ")}.`,
        { agentName: definition.identity.agentName, unknown },
      );
    }
  }

  if (definition.skills !== undefined) {
    const unknown = definition.skills.ids.filter((id) => !BUNDLED_SKILL_IDS.has(id));
    if (unknown.length > 0) {
      throw new AgentRegistryError(
        "unknown-skill",
        `The delegate "${definition.identity.agentName}" names skills that are not bundled: ${unknown.join(", ")}. A user's own skills folder is not a definition's to name.`,
        { agentName: definition.identity.agentName, unknown },
      );
    }
  }

  return definition;
}

/**
 * The registry itself: a frozen map by `agentName`, built once at module
 * load from the definitions the modules below export.
 *
 * Two invariants, both enforced at construction:
 *
 * 1. **Unique names.** `agentName` is the durable identity — Flue's scanner
 *    refuses duplicates at build time, and this refuses them at load time,
 *    so a definition collision cannot survive to a conversation.
 * 2. **Function-value pairing.** Every entry carries the agent function the
 *    module exports, the same object `dispatch()` resolves by value, so the
 *    registry cannot drift from the runtime's registration.
 */
export class AgentRegistry {
  readonly #agents: ReadonlyMap<string, RegisteredAgent>;

  constructor(entries: readonly RegisteredAgent[]) {
    const map = new Map<string, RegisteredAgent>();
    for (const entry of entries) {
      const name = entry.definition.identity.agentName;
      if (map.has(name)) {
        throw new AgentRegistryError(
          "duplicate-name",
          `Two agent definitions claim the name "${name}": the agentName is the durable identity, so it must be unique across the harness.`,
          { agentName: name },
        );
      }
      map.set(name, entry);
    }
    this.#agents = map;
  }

  /** The definition for one agent name, or undefined when no such agent exists. */
  get(agentName: string): RegisteredAgent | undefined {
    return this.#agents.get(agentName);
  }

  /** Every registered agent, sorted by name: the roster a settings surface reads. */
  list(): readonly RegisteredAgent[] {
    return [...this.#agents.values()].sort((left, right) =>
      left.definition.identity.agentName.localeCompare(right.definition.identity.agentName),
    );
  }

  /** Every agent of one kind. The Stage 3 render asks this for `"delegate"`. */
  byKind(kind: AgentKind): readonly RegisteredAgent[] {
    return this.list().filter((entry) => entry.definition.kind === kind);
  }

  /**
   * The one agent function this harness mounts on the HTTP surface.
   *
   * `create-app.ts` mounts exactly one agent router, and the conversation
   * index, the stop control, and the turn-settings middleware all assume it
   * is `studio`. That assumption is load-bearing enough to assert here
   * rather than leave to a comment: a second conversation agent is a
   * multi-conversation-surface decision (ADR 0058 leaves it to the future),
   * and this method is what refuses to hand one out silently.
   */
  conversationAgent(): RegisteredAgent {
    const conversations = this.byKind("conversation");
    const found = conversations[0];
    if (conversations.length !== 1 || found === undefined) {
      throw new AgentRegistryError(
        "kind-policy",
        `Exactly one conversation agent may exist (the HTTP surface mounts one router); found ${conversations.length}: ${conversations.map((entry) => entry.definition.identity.agentName).join(", ") || "(none)"}.`,
      );
    }
    return found;
  }
}
