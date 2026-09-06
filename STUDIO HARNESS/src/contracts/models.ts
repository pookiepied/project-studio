import * as v from "valibot";

import { StudioError } from "./errors.js";

export const modelSourceSchema = v.picklist([
  "local",
  "test",
]);

export type ModelSource = v.InferOutput<typeof modelSourceSchema>;

export const modelReferenceSchema = v.object({
  source: modelSourceSchema,
  provider: v.pipe(v.string(), v.minLength(1)),
  model: v.pipe(v.string(), v.minLength(1)),
});

export type ModelReference = v.InferOutput<typeof modelReferenceSchema>;

/**
 * The reasoning effort levels Pi's runtime can carry, in its own order.
 *
 * This is the one place the vocabulary is declared. It mirrors pi-agent-core's
 * `ThinkingLevel` union exactly - which Flue re-exports as its own type - so a
 * level stored here is a level the run can ask for, and a level Pi does not
 * know cannot enter a record. `xhigh` and `max` only ever reach a request for
 * models whose `thinkingLevelMap` names them; Pi clamps a request a model
 * cannot honour rather than sending an invalid effort.
 *
 * `default` is deliberately NOT a member: it is the choice a person makes (or
 * the state a conversation rests in) meaning "no level asked for", and it is
 * modelled beside the levels rather than as one of them, because the wire
 * shapes differ - a level becomes an explicit provider parameter, while
 * default asks for the provider's own behaviour. See
 * `runThinkingLevelForChoice` for the one mapping into the run.
 */
export const REASONING_LEVELS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ReasoningLevel = (typeof REASONING_LEVELS)[number];

export const reasoningLevelSchema = v.picklist(REASONING_LEVELS);

/**
 * A reasoning choice as a record stores it: a level, or "default".
 *
 * The value is stored verbatim, never folded into a synonym: "default" means
 * the provider's own default behaviour, and "medium" means medium.
 */
export const reasoningChoiceSchema = v.union([
  v.literal("default"),
  reasoningLevelSchema,
]);

export type ReasoningChoice = v.InferOutput<typeof reasoningChoiceSchema>;

/**
 * The resting reasoning level for a model's supported levels.
 *
 * Medium when the model supports it. Otherwise the nearest supported level in
 * `REASONING_LEVELS` order, preferring the lower one on a tie. The anchor is
 * medium itself, not the midpoint of the model's own list: a model exposing
 * `xhigh` and `max` would otherwise rest at high, quietly more expensive than
 * the everyday balance medium names. An empty list means the model does not
 * reason at all, and the answer is "off".
 */
export function restingReasoningLevel(
  supported: readonly ReasoningLevel[],
): ReasoningLevel | "off" {
  if (supported.length === 0) return "off";
  if (supported.includes("medium")) return "medium";
  const order = REASONING_LEVELS;
  const mediumIndex = order.indexOf("medium");
  let best = supported[0];
  // The length check above makes this access safe without asserting.
  if (best === undefined) return "off";
  let bestDistance = Math.abs(order.indexOf(best) - mediumIndex);
  for (const candidate of supported) {
    const distance = Math.abs(order.indexOf(candidate) - mediumIndex);
    const candidateIndex = order.indexOf(candidate);
    const bestIndex = order.indexOf(best);
    if (distance < bestDistance || (distance === bestDistance && candidateIndex < bestIndex)) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Maps a stored choice onto the `thinkingLevel` the agent render passes.
 *
 * A stored "default" resolves to the resting level from `restingReasoningLevel`,
 * never to absence. Absence was the previous spelling - "default" mapped to
 * "off", which the agent loop drops before any request is built so the
 * protocol layer receives no reasoning option. That absence is abandoned
 * because what each adapter does with it is not one thing:
 *
 * - Omits the parameter, as intended: OpenAI Responses, Azure Responses, Codex
 *   Responses, OpenAI Completions (plain), Bedrock, Mistral, `ant-ling`.
 * - Sends an explicit "off", but checks `model.thinkingLevelMap?.off !== null`
 *   first, so a catalog entry can opt out: Anthropic, DeepSeek, OpenRouter,
 *   `string-thinking`. The harness uses this escape for OpenRouter in
 *   `applyOpenRouterDefaultReasoning` (`src/models/local/runtime.ts`).
 * - Sends an explicit "off" with no escape hatch at all: Google Generative AI,
 *   Google Vertex, `zai`, `qwen`, `qwen-chat-template`, `together`.
 *
 * That last group is why absence had to go. On Google, no reasoning option
 * sends `thinking: { enabled: false }`, which becomes `thinkingBudget: 0` on
 * Gemini 2.x and the lowest available level on Gemini 3, which cannot be
 * disabled at all, while Gemini's own default is thinking on. "Default" was
 * quietly turning thinking down, and because `includeThoughts` is only set on
 * the enabled branch, no thinking was ever shown either.
 *
 * Every one of these produces a valid request and no provider requires the
 * parameter, which is why the silence went unnoticed. Resting on medium keeps
 * every request on the explicit-level path all eleven adapters are built and
 * tested for, with no vendored patch and no per-model table to maintain.
 *
 * "off" survives as one thing only: the value for a model that does not
 * reason, which is an empty supported list. A non-reasoning model still sends
 * no reasoning parameter, exactly as before.
 */
export function runThinkingLevelForChoice(
  choice: ReasoningChoice | null | undefined,
  supported: readonly ReasoningLevel[],
): ReasoningLevel | "off" {
  if (supported.length === 0) return "off";
  if (choice === null || choice === undefined || choice === "default") {
    return restingReasoningLevel(supported);
  }
  return choice;
}

/**
 * A stored reasoning choice, or "default" when it is absent or not a value the
 * contract describes.
 *
 * The column is validated on every write, so the fallback exists for rows that
 * predate the schema or were written by something that bypassed it - reading
 * such a row as the default is honest, where reading it as a level would send
 * a request nobody chose.
 */
export function reasoningChoiceOr(
  value: string | null | undefined,
): ReasoningChoice {
  if (value === null || value === undefined) return "default";
  const parsed = v.safeParse(reasoningChoiceSchema, value);
  return parsed.success ? parsed.output : "default";
}

/**
 * A conversation's model reference, in the local runtime's own vocabulary:
 * `<pi-provider>/<model-id>`, e.g. `openrouter/anthropic/claude-sonnet-4.5`.
 *
 * The same shape the local model source's default selection already uses, so
 * one string has three consumers that agree: the conversation index stores it,
 * the run initializer turns it into the `project-studio/<reference>` specifier
 * Flue resolves, and the local adapter parses it back out to route the request.
 * Connection ids are deliberately not part of it - they name a keychain entry
 * and a settings row, not a model the runtime can resolve.
 */
export const modelIdSchema = v.pipe(
  v.string(),
  v.minLength(1),
  v.regex(
    /^[a-z0-9][a-z0-9-]*\/\S+$/,
    "A model reference is <provider>/<model>, with a provider id Pi can resolve.",
  ),
);

/**
 * "unknown" means the dimension has not been described yet, distinct from a
 * confirmed "unsupported". Numeric limits use "unknown" rather than 0 for the
 * same reason.
 */
export const capabilityStateSchema = v.picklist([
  "supported",
  "unsupported",
  "unknown",
]);

export type CapabilityState = v.InferOutput<typeof capabilityStateSchema>;

export interface ModelCapability {
  readonly textGeneration: CapabilityState;
  readonly streaming: CapabilityState;
  readonly reasoning: CapabilityState;
  readonly toolCalling: CapabilityState;
  readonly vision: CapabilityState;
  readonly embeddings: CapabilityState;
  readonly reranking: CapabilityState;
  readonly imageGeneration: CapabilityState;
  /** Producing a new image guided by one the user supplies. Distinct from imageGeneration: an editor consumes an input image, a generator need not accept one. */
  readonly imageEditing: CapabilityState;
  readonly videoGeneration: CapabilityState;
  readonly speechGeneration: CapabilityState;
  readonly transcription: CapabilityState;
  /** Retrieving web results for a query. Distinct from webFetch: a search answers a question, a fetch retrieves one named page. */
  readonly webSearch: CapabilityState;
  readonly webFetch: CapabilityState;
  readonly contextWindow: number | "unknown";
  readonly maxOutputTokens: number | "unknown";
}

/**
 * The runtime counterpart of ModelCapability, kept beside it on purpose.
 *
 * A second copy of this shape written by hand somewhere else compiles happily
 * after a field is added here and then validates the old shape forever. One
 * schema, checked against the interface, is what makes adding a capability a
 * compile error everywhere it needs to be one.
 */
export const modelCapabilitySchema = v.object({
  textGeneration: capabilityStateSchema,
  streaming: capabilityStateSchema,
  reasoning: capabilityStateSchema,
  toolCalling: capabilityStateSchema,
  vision: capabilityStateSchema,
  embeddings: capabilityStateSchema,
  reranking: capabilityStateSchema,
  imageGeneration: capabilityStateSchema,
  imageEditing: capabilityStateSchema,
  videoGeneration: capabilityStateSchema,
  speechGeneration: capabilityStateSchema,
  transcription: capabilityStateSchema,
  webSearch: capabilityStateSchema,
  webFetch: capabilityStateSchema,
  contextWindow: v.union([v.number(), v.literal("unknown")]),
  maxOutputTokens: v.union([v.number(), v.literal("unknown")]),
});

// Fails to compile the moment the schema and the interface disagree.
const _capabilityShapesAgree: ModelCapability =
  undefined as unknown as v.InferOutput<typeof modelCapabilitySchema>;
void _capabilityShapesAgree;

export interface ModelDescriptor {
  readonly source: ModelSource;
  readonly provider: string;
  readonly model: string;
  readonly resolvedModelId: string;
  readonly capability: ModelCapability;
  readonly operational: boolean;
}

export interface ModelProviderAdapter {
  readonly source: ModelSource;
  readonly operational: boolean;
  register(): void;
  resolve(reference: ModelReference): ModelDescriptor;
  listModels(): readonly ModelDescriptor[];
  /**
   * The reasoning levels one stored reference supports, in Pi's order, empty
   * for a model that does not reason.
   *
   * Synchronous because the agent render is synchronous and the Pi catalog it
   * reads is composed synchronously in `models/local/runtime.ts`. The render
   * feeds this into `runThinkingLevelForChoice` so a stored "default" rests on
   * medium rather than on silence. Unknown references answer medium, which
   * keeps the request on the explicit path; only a known non-reasoning model
   * answers empty.
   */
  supportedReasoningLevels(modelId: string | null): readonly ReasoningLevel[];
  /**
   * The model a background job may run on, as a specifier this source can
   * resolve at run time, or undefined when the source cannot name one.
   *
   * A background job - titling today - is a small one-shot model call whose
   * output is a few words. Running it on the conversation's model would be
   * the default silently spending whatever a person chats with on eight
   * words, so the source is asked instead, and it answers with the least
   * expensive model it can honestly reach: one whose provider holds working
   * credentials, priced from its own listed rates. When that is the only
   * model connected - the exactly-one-expensive-model case - it is still the
   * answer, because the alternative is a conversation that stays badly named
   * forever to save a fraction of a cent, and the choice is documented
   * rather than silent. Undefined sends the caller to the stable alias, the
   * same fallback an unconfigured source gets everywhere else.
   *
   * `skip` asks for a later rank: the first answer failed, and the caller is
   * stepping down the ladder. A source with nothing at that rank answers
   * undefined, which the caller reads as "the ladder is exhausted".
   */
  backgroundModel(skip?: number): Promise<string | undefined>;
  /**
   * The whole ranked ladder, as the source would answer `backgroundModel`
   * rank by rank, computed in one sweep and held for synchronous reads.
   *
   * The ladder exists for a render that cannot await: a Flue 2.0 agent
   * function is synchronous, so the titling render asks for rank N and must
   * be answered without touching the keychain. The snapshot is the model
   * layer's maintained answer, not a cache the reader manages - the source
   * recomputes it when `refreshBackgroundLadder()` runs and answers the
   * snapshot as-is at every other moment, even if the credential picture has
   * moved since. Empty means never computed (or nothing was reachable at the
   * last refresh); the caller reads that the same way 1.0 read an undefined
   * rank, rank by rank.
   */
  backgroundLadder(): readonly string[];
  /**
   * Recomputes the ladder snapshot from live availability. Awaited by the
   * composition root at boot - before the server can accept a dispatch -
   * so a titling render never sees the uncomputed state in production.
   */
  refreshBackgroundLadder(): Promise<void>;
}

export interface ModelProviderPort {
  resolve(reference: ModelReference): string;
  resolveDescriptor(reference: ModelReference): ModelDescriptor;
  listModels(): readonly ModelDescriptor[];
  validate(reference: ModelReference): void;
}

/**
 * Stable, gateway-neutral identity for the studio agent's model. It carries
 * no source/provider/implementation detail so switching model sources never
 * requires editing the agent definition.
 */
export const DEFAULT_MODEL_PROVIDER = "project-studio";
export const DEFAULT_MODEL_NAME = "default";
export const STUDIO_MODEL_ID = `${DEFAULT_MODEL_PROVIDER}/${DEFAULT_MODEL_NAME}`;

export function defaultModelReference(source: ModelSource): ModelReference {
  return {
    source,
    provider: DEFAULT_MODEL_PROVIDER,
    model: DEFAULT_MODEL_NAME,
  };
}

/**
 * A model source was selected that cannot start: missing configuration, an
 * unknown source, or an invalid value. Never retryable — the process must be
 * reconfigured.
 */
export class ProviderConfigurationError extends StudioError {
  readonly domain = "models" as const;

  constructor(message: string) {
    super("configuration", message);
    this.name = "ProviderConfigurationError";
  }
}

/**
 * A model reference could not be resolved to a descriptor. Raised instead of
 * substituting a different source, provider, or model.
 */
export class ModelResolutionError extends StudioError {
  readonly domain = "models" as const;

  constructor(message: string) {
    super("resolution", message);
    this.name = "ModelResolutionError";
  }
}
