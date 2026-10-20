import * as v from "valibot";

import { modelIdSchema, reasoningChoiceSchema } from "./models.js";
import type { CapabilityEffect } from "./capabilities.js";
import { executionModeSchema, type ExecutionMode } from "../permissions/mode.js";

/**
 * Agent identity.
 *
 * `ExecutionScope.agentId` names **the agent**, not the conversation it is
 * having — its own doc comment says so, and the grant store's `agent_id`
 * column exists beside `conversation_id` and `project_id` for that reason.
 *
 * Flue's initializer receives an `id` that is the agent *instance*, one per
 * conversation thread. Passing it as `agentId` put a conversation identity in
 * the agent field, which left `duration: "always"` unable to outlive the
 * conversation that granted it and made it indistinguishable from
 * `duration: "conversation"` (issue #69). The constant below is what an agent
 * is called; the thread id belongs in `conversationId`.
 *
 * There is one conversation agent. That is exactly why this is worth naming
 * rather than inlining: with a single agent the two readings of `agentId`
 * produce identical behaviour, so nothing would catch the confusion
 * returning.
 */
export const STUDIO_AGENT_ID = "studio";

/**
 * The automatic titling agent, named for the same reason.
 *
 * Its module is `agents/title.ts`, and since Flue 2.0 the identity comes from
 * that module's `Title.agentName` literal rather than the basename - the
 * value below is asserted equal to it so the two cannot drift. It is also the
 * stream prefix the agent owns (`agents/title/<conversation id>`).
 *
 * What keeps it off the HTTP surface is the mount, not the module: 2.0 has no
 * catch-all router, and `transport/http/create-app.ts` calls
 * `createAgentRouter` for the studio agent only. The only caller that can
 * reach this agent is this harness, in process, through `dispatch()`. A
 * person can never start a conversation with it, and no client can address it
 * over HTTP.
 */
export const TITLE_AGENT_ID = "title";

/**
 * The dictation-improving agent, named for the same reason and kept off the
 * HTTP surface the same way. Its module is `agents/improve.ts`; its only
 * caller is `application/text-improver.ts`, in process, through
 * `dispatch()`. Its stream prefix is `agents/improve/<take id>`.
 */
export const IMPROVE_AGENT_ID = "improve";

/**
 * The image-describing agent of the library, kept off the HTTP surface the
 * same way. Its module is `agents/describe.ts`; its only caller is
 * `library/describer.ts`, in process, through `dispatch()`. Its stream
 * prefix is `agents/describe/<take id>`.
 */
export const DESCRIBE_AGENT_ID = "describe";

/**
 * The read-only research delegate (ADR 0058, D11 — the Stage 3 roster).
 *
 * Named beside the four live ids now so the definition vocabulary and its
 * tests can speak it from Stage 2 on, the same way `STUDIO_AGENT_ID` existed
 * before anything read it: the id is a pinned literal, not a computed value,
 * and nothing dispatches to it yet. Stage 3 mounts it through `useSubagent`
 * and gives it a render; this constant is what its definition, its scope,
 * and its grants will key on when that happens.
 */
export const EXPLORE_AGENT_ID = "explore";

/**
 * The hands-on delegate of the Stage 5 roster (ADR 0058, D11): the
 * `GeneralSubagent` equivalent, Studio-shaped. Named beside the other ids for
 * the same reason they are — the id is a pinned literal that definitions,
 * scopes, and grants key on, and the `agents/general.ts` module's
 * `General.agentName` is asserted equal to it.
 */
export const GENERAL_AGENT_ID = "general";

/**
 * The planning delegate of the Stage 5 roster (ADR 0058, D11): read-only
 * research plus the plan tool, producing and updating the list the person
 * ticks. Its module is `agents/plan.ts`; the name is also the native plan
 * tool's name, which is a collision in spelling only — the roster speaks
 * agent names, the tool array speaks capability ids, and neither resolves
 * through the other.
 */
export const PLAN_AGENT_ID = "plan";

/**
 * The turn settings a submission may carry beside its message.
 *
 * A submission body cannot carry these through to the run: Flue parses every
 * direct payload through `DirectAgentPayloadSchema` (`message` and `images`,
 * unknown keys stripped), and the agent initializer receives only `{ id, env }`.
 * These two fields are therefore consumed at our own admission boundary - the
 * middleware in `transport/http/middleware/turn-settings.ts` reads them, writes
 * them to the conversation index, and lets Flue strip them - so the durable
 * row is settled BEFORE the run's initializer reads it. Neither field is
 * required: absent means the conversation's stored settings stand.
 *
 * `modelId` is the local runtime's `<provider>/<model>` reference, the same
 * vocabulary the conversation index stores and the run initializer resolves.
 * `reasoningLevel` is a level or "default"; "default" means the provider's own
 * behaviour and is stored verbatim rather than folded into a synonym.
 *
 * `permissionMode` is the execution mode the turn is sent under, in the
 * harness's own vocabulary (`ask` / `auto`) - the one
 * spelling every wire value is validated against, with no translation before
 * it. It is a consent, so it settles into the index like the other two:
 * before the run is admitted, so the posture the run is decided under is the
 * one the sender chose.
 */
export const submissionTurnSettingsSchema = v.object({
  modelId: v.optional(v.nullable(modelIdSchema)),
  reasoningLevel: v.optional(v.nullable(reasoningChoiceSchema)),
  permissionMode: v.optional(executionModeSchema),
  /**
   * The project a first turn belongs to.
   *
   * Here for the same reason the model is: it has to be durable before the
   * run starts, because the run reads the row to decide where it stands. The
   * client only posts the index row after the receipt, so without this a
   * first turn in a project ran in the conversation's own scratch directory
   * while the person watched a project open on screen - the folders reached
   * the sandbox on the second turn and never on the first.
   *
   * Only ever set, never cleared: a later turn carrying nothing must not
   * unfile a conversation somebody moved.
   */
  projectId: v.optional(v.string()),
});

export type SubmissionTurnSettings = v.InferOutput<typeof submissionTurnSettingsSchema>;

/**
 * ---------------------------------------------------------------------------
 * The agent-definition vocabulary (ADR 0058 D1, Stage 2).
 * ---------------------------------------------------------------------------
 *
 * An agent is a definition: a typed record that says what the agent is, what
 * it may see, and how long it may run — plus the agent function Flue already
 * requires. Data first, so adding an agent type is a declaration, not a
 * runtime fork. The definitions live in `src/agents/definitions/`, never in
 * `src/extend/`: a subagent consumes MCP, skills and hooks; it is not one of
 * them (the recorded rule from the Phase 11 design).
 *
 * Three kinds, mapped onto what exists:
 *
 * - `conversation` — today's `studio`: mounted at `/agents/studio/<cnv_>`,
 *   owned by the product's conversation index. The richest definition; it
 *   keeps its bespoke render, and its tools and skills stay per-conversation
 *   state rather than a static allowlist.
 * - `background` — the `title` / `improve` / `describe` pattern generalized:
 *   dispatch-only, one-shot, addressed by a task instance id the product
 *   mints, never mounted on the HTTP surface.
 * - `worker` — independently addressable work with a conversation-owned
 *   sandbox, model and permission gate. Its lifecycle is indexed like
 *   background work; it is allowed to perform approved tool actions.
 * - `delegate` — a subagent declared by a conversation agent and reached
 *   through Flue's `task` tool (ADR 0058 D2). None exists yet; the shape
 *   below is what Stage 3's `explore` will fill in.
 *
 * The kind is a closed union because the registry and the architecture tests
 * read it: a new kind is a new runtime path, and it must fail the typecheck
 * until the registry knows what it means.
 */
export type AgentKind = "conversation" | "background" | "worker" | "delegate";

/**
 * What a definition may say about tools, per kind.
 *
 * A `conversation` or `background` agent says nothing: the conversation's
 * gate composes its own array (per-conversation state for `studio`, nothing
 * at all for the background three, which mount no sandbox and so can call
 * nothing — a security property the title agent's tests already assert by
 * shape). A `delegate` says an allowlist, because visibility must equal
 * authority (ADR 0058 D4): the parent conversation holds all the tools, and
 * what the delegate's model *sees* is the intersection of the definition's
 * list with what the gate holds.
 *
 * The list is closed and by name: `read`, `glob`, `grep` — the same names
 * the capability registry and the model-facing tool table use. `discover` is
 * withheld from delegates in v1 (a delegate adopting a tool would leak into
 * the parent's conversation-keyed adopted set — the two-writer bug ADR 0029
 * exists to prevent), and MCP namespaces are a separate list so a delegate's
 * MCP surface can be resolved at spawn from the catalog against the static
 * allowlist, never by the delegate at runtime.
 */
export interface AgentToolPolicy {
  /**
   * Native tool names this agent's model may see. Validated against the
   * registered native names at load — a typo'd allowlist would otherwise
   * silently widen into "the delegate cannot use the tool it was named for"
   * at the least convenient moment.
   */
  readonly natives: readonly string[];
  /** MCP namespace keys (`mcp:<server-id>`) this agent may see, if any. */
  readonly mcpNamespaces: readonly string[];
}

/**
 * What a definition may say about skills, per kind.
 *
 * `conversation` is the per-conversation selection chain — not a definition
 * field. `background` agents mount no skills. A `delegate` gets the
 * intersection of this list with the conversation's selection: a skill
 * enabled for the conversation but absent here is invisible to the delegate.
 */
export interface AgentSkillPolicy {
  /** Skill ids (the SKILL.md folder name) this agent may mount, if any. */
  readonly ids: readonly string[];
}

/**
 * What a definition may say about permissions, per kind.
 *
 * `conversation` reads its mode from the settled turn settings. `background`
 * agents hold no tools, so no permission applies to them. A `delegate` has
 * its own consent default. Every delegate in the initial roster says
 * `inherit`: a default `ask` resolves under the conversation's mode, so a
 * person who chose Auto is not stopped by the agents that conversation
 * delegated to. A delegate still never inherits an *approval* (ADR 0038's
 * grant-isolation property, #49): its asks and grants carry its own agent id.
 */
export interface AgentPermissionPolicy {
  /**
   * The ceiling on effects this agent's calls may earn. Not booleans: the
   * effects vocabulary is the permission system's own (`read`, `write`,
   * `execute`, `network`), and read-only is expressible as `["read"]` — one
   * layer of a three-layer agreement (allowlist ∩ ceiling ∩ kernel) that
   * must all say the same thing before a Stage 3 delegate runs.
   */
  readonly maxEffects: readonly CapabilityEffect[];
  /**
   * The delegate's own consent default when the person has not answered, or
   * `inherit` for the conversation's mode.
   */
  readonly mode: ExecutionMode | "inherit";
}

/**
 * How a definition chooses a model.
 *
 * `background` agents pin either a specifier (the title agent's ladder read)
 * or the person's default (`improve`, `describe`); a `delegate` either
 * inherits the parent conversation's model or names a cheap one; a
 * `conversation` agent reads its model from the settled turn settings and
 * says nothing here. `useModel` inside a delegate render is Flue-forbidden;
 * the override rides the definition, and Stage 3 wires it to
 * `useSubagent`'s `model` field.
 */
export type AgentModelPolicy =
  /** The conversation's settled model and level (studio). */
  | { readonly inherit: true }
  /** A pinned specifier; the level is a literal because a background agent has no reason to spend. */
  | { readonly specifier: string; readonly thinkingLevel: "off" };

/**
 * How long one run of an agent may take and retry, stated per agent rather
 * than inherited from the runtime's defaults (1 hour, 10 attempts — values
 * chosen for interactive conversations, which is not what a background
 * titling run or a bounded delegate should silently get). These are the same
 * fields Flue's `AgentStatics.durability` carries; the definition is the
 * single source the agent module's static assignment reads, so the two
 * cannot drift.
 */
export interface AgentDurabilityPolicy {
  readonly maxAttempts: number;
  readonly timeoutMs: number;
}

/**
 * The definition record. Every field is a constraint the registry validates
 * at load: a definition that fails validation fails the process start, not
 * the first conversation unlucky enough to dispatch it.
 */
export interface StudioAgentDefinition {
  readonly identity: {
    /** The pinned literal the module's `agentName` static also carries. */
    readonly agentName: string;
    /** One line for a settings row or a roster list. */
    readonly title: string;
    /** What the parent's model reads when deciding to delegate. */
    readonly description: string;
  };
  readonly kind: AgentKind;
  /**
   * The fixed instruction set. Static per agent, composed per render the way
   * Studio composes its own: the cache-prefix argument for byte-identical
   * instructions belongs to the render, not to this record.
   */
  readonly instructions: string;
  readonly model: AgentModelPolicy;
  /**
   * Which tools and skills apply, per the per-kind rules above. Optional
   * because the per-kind contract (enforced by the registry) is that only a
   * delegate carries them: conversation and background agents compose their
   * surface from live state or nothing at all.
   */
  readonly tools?: AgentToolPolicy | undefined;
  readonly skills?: AgentSkillPolicy | undefined;
  readonly permissions?: AgentPermissionPolicy | undefined;
  readonly durability: AgentDurabilityPolicy;
}

/**
 * The union of every status a durable run may settle into, shared by
 * conversation submissions, process jobs, media jobs, and (Stage 4) agent
 * tasks. ADR 0033's set: the observation layer already emits these as
 * settlement outcomes, and one vocabulary is what lets the task index be a
 * projection of the stream rather than a second opinion about what happened.
 *
 * `waiting_for_user` is a live state, not a settlement: a run parked on a
 * question or an approval. It exists in the union because the task rail will
 * show it between `running` and a settlement, and because a task that dies
 * while parked settles `unknown` on restart — the honest answer for a state
 * the stream cannot prove.
 */
export type AgentTaskStatus =
  | "queued"
  | "running"
  | "waiting_for_user"
  | "completed"
  | "failed"
  | "cancelled"
  | "unknown";

/**
 * Whether one task status is terminal.
 *
 * The cancellation route's question ("is there anything left to stop") and the
 * projector's transition check ("has this settlement been seen before") both
 * ask it, so it lives beside the union rather than beside either consumer —
 * one opinion about the vocabulary, the same way the store's own settlement
 * branch and the projector's announce condition both read it.
 */
export function isSettledTaskStatus(status: AgentTaskStatus): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "unknown"
  );
}

const agentToolPolicySchema = v.object({
  natives: v.array(v.string()),
  mcpNamespaces: v.array(v.string()),
});

const agentSkillPolicySchema = v.object({
  ids: v.array(v.string()),
});

const agentPermissionPolicySchema = v.object({
  maxEffects: v.pipe(
    v.array(v.picklist(["read", "write", "execute", "network"])),
    // Non-empty on purpose: an empty ceiling is not "nothing" but "nobody
    // stated it", and the three-layer read-only agreement (allowlist ∩
    // ceiling ∩ kernel) only works when every layer says something.
    v.minLength(1),
  ),
  mode: v.union([executionModeSchema, v.literal("inherit")]),
});

const agentModelPolicySchema = v.union([
  v.object({ inherit: v.literal(true) }),
  v.object({
    specifier: v.string(),
    thinkingLevel: v.literal("off"),
  }),
]);

/**
 * The wire-level validation of a definition record. The registry runs this
 * at load, then applies the cross-field rules a schema cannot express (a
 * delegate with no tool policy, a conversation agent with one) — those are
 * code, because they encode the per-kind contract, not the shape.
 */
export const studioAgentDefinitionSchema = v.object({
  identity: v.object({
    agentName: v.pipe(v.string(), v.nonEmpty()),
    title: v.pipe(v.string(), v.nonEmpty()),
    description: v.pipe(v.string(), v.nonEmpty()),
  }),
  kind: v.picklist(["conversation", "background", "worker", "delegate"]),
  instructions: v.pipe(v.string(), v.nonEmpty()),
  model: agentModelPolicySchema,
  tools: v.optional(agentToolPolicySchema),
  skills: v.optional(agentSkillPolicySchema),
  permissions: v.optional(agentPermissionPolicySchema),
  durability: v.object({
    maxAttempts: v.pipe(v.number(), v.integer(), v.minValue(1)),
    timeoutMs: v.pipe(v.number(), v.integer(), v.minValue(1)),
  }),
});

export type StudioAgentDefinitionInput = v.InferOutput<typeof studioAgentDefinitionSchema>;
