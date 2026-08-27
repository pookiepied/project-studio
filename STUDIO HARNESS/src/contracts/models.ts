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
 * Maps a stored choice onto the `thinkingLevel` the agent initializer returns.
 *
 * "default" maps to "off", which is how this runtime says "no explicit effort
 * requested": Pi's agent loop turns "off" into an absent reasoning option and
 * Pi's protocol layer then renders that per provider (an omitted parameter for
 * OpenAI-style endpoints). It cannot be left unset instead, because Flue
 * substitutes "medium" for an unset thinkingLevel - and a default that arrived
 * as medium would be exactly the synonym this contract refuses.
 */
export function runThinkingLevelForChoice(
  choice: ReasoningChoice | null | undefined,
): ReasoningLevel | "off" {
  if (choice === null || choice === undefined || choice === "default") return "off";
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
  readonly videoGeneration: CapabilityState;
  readonly speechGeneration: CapabilityState;
  readonly transcription: CapabilityState;
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
  videoGeneration: capabilityStateSchema,
  speechGeneration: capabilityStateSchema,
  transcription: capabilityStateSchema,
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
