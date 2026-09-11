import * as v from "valibot";

import { modelCapabilitySchema, reasoningLevelSchema, type ModelCapability } from "./models.js";

/**
 * Which family of work a provider handles.
 *
 * Kept as a closed picklist so a consumer cannot invent a kind the harness
 * has no policy or UI for. Language, media, and retrieval differ in protocol,
 * credential scope, and cost model, so mixing them would hide a real
 * permission or billing boundary.
 */
export const providerKindSchema = v.picklist(["language", "media", "retrieval"]);

export type ProviderKind = v.InferOutput<typeof providerKindSchema>;

/**
 * Where a provider connection is stored and who owns its lifecycle.
 *
 * `local` lives in the harness's own store on this machine. `test` is the
 * in-memory double that lets the suite run without touching the OS store.
 * a future user-hosted source joins here as "gateway"; this is why the field
 * exists at all rather than being assumed — so one harness can mix local and
 * hosted connections without forking the type or the URL space. A future
 * user-hosted source joins here as "gateway"; this is why the field exists at
 * all rather than being assumed.
 */
export const providerSourceSchema = v.picklist(["local", "test"]);

export type ProviderSource = v.InferOutput<typeof providerSourceSchema>;

/**
 * The wire protocol a language connection speaks.
 *
 * Separate from media and retrieval so a language connection cannot be given
 * a media protocol by mistake. The union is narrow on purpose — adding a
 * protocol is a contract change, not a string.
 *
 * Six of Pi's ten language protocols are named here. The four absent ones
 * cannot be driven by a user-declared key: `openai-codex-responses` resolves
 * only a ChatGPT OAuth credential, `bedrock-converse-stream` signs requests
 * with an AWS access-key/secret pair, `google-vertex` needs a service
 * account, and `pi-messages` is Pi's own service protocol.
 */
export const languageProtocolSchema = v.picklist([
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
  "mistral-conversations",
  "azure-openai-responses",
]);

export type LanguageProtocol = v.InferOutput<typeof languageProtocolSchema>;

/**
 * The wire protocol a media connection speaks.
 *
 * Kept apart from language because image and video endpoints have different
 * shape and auth requirements, and a single union would let a text model be
 * asked to render an image without a type error.
 *
 * Each entry names a vendor's media wire *family*, not one endpoint: OpenAI's
 * family covers images, speech and transcription on one key, and an entry per
 * endpoint would have multiplied connections for the same secret. Adding a
 * family is a contract change, which is the union's purpose, and every
 * family named here has an adapter under `gateway/media/adapters`.
 */
export const mediaProtocolSchema = v.picklist([
  "openai",
  "openrouter",
  "google",
  "elevenlabs",
  "fal",
  "deepgram",
  "fish-audio",
  "minimax",
]);

export type MediaProtocol = v.InferOutput<typeof mediaProtocolSchema>;

/**
 * The wire protocol a retrieval connection speaks.
 *
 * Each provider here is a distinct billing boundary and rate limit. A shared
 * enum would let a Tavily key be sent to Brave without a type error, which is
 * the wrong failure to have at the call site.
 */
export const retrievalProtocolSchema = v.picklist(["brave", "tavily", "exa", "firecrawl", "jina"]);

export type RetrievalProtocol = v.InferOutput<typeof retrievalProtocolSchema>;

/**
 * How the harness issues a model call and waits for the result.
 *
 * `stream` yields chunks, `sync` is a single round-trip, `poll` is
 * request-then-poll. "webhook" is deliberately absent — it needs a publicly
 * reachable inbound URL, which a local-first harness does not have. The
 * harness must remain usable behind NAT with no inbound port, so a callback
 * shape would never complete.
 */
export const invocationShapeSchema = v.picklist(["stream", "sync", "poll"]);

export type InvocationShape = v.InferOutput<typeof invocationShapeSchema>;

/**
 * What we know about a credential without holding it.
 *
 * `set` means the store holds a key, `from-env` means the process inherited
 * one from the environment, `absent` means nothing was found. The value is
 * intentionally vague — the contract never carries the secret itself.
 */
export const credentialStatusSchema = v.picklist(["set", "from-env", "absent"]);

export type CredentialStatus = v.InferOutput<typeof credentialStatusSchema>;

/**
 * A connection id names a keychain entry of its very own, so its shape is a
 * security boundary, not a style guide: lowercase letters, digits, and single
 * hyphens, beginning and ending with a letter or digit. The slug shape is
 * also what makes the credential key predictable — it must survive the
 * credential store's own id validation unchanged.
 */
export const providerConnectionIdSchema = v.pipe(
  v.string(),
  v.regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Provider connection ids are lowercase letters, digits, and single hyphens, starting and ending with a letter or digit.",
  ),
);

/**
 * What one connection serves, and on which wire.
 *
 * A connection is to a vendor, and one vendor's key credibly serves several
 * kinds: OpenAI's chat, images, speech and transcription are one key, and so
 * are OpenRouter's. This map is the shape of that fact - a kind is present
 * when the connection serves it, and its value is the protocol spoken for
 * that kind. Each kind keeps its own protocol union, so a retrieval protocol
 * still cannot be put under `language` without a type error; the variant on
 * `kind` that used to guarantee that is gone, because it also guaranteed
 * that the same key had to be typed once per kind.
 *
 * At least one kind is required: a connection that serves nothing is a
 * secret with no purpose, and the store refuses to hold one.
 */
export const connectionServesSchema = v.pipe(
  v.object({
    language: v.optional(languageProtocolSchema),
    media: v.optional(mediaProtocolSchema),
    retrieval: v.optional(retrievalProtocolSchema),
  }),
  v.check(
    (serves) =>
      serves.language !== undefined ||
      serves.media !== undefined ||
      serves.retrieval !== undefined,
    "A provider connection serves at least one kind.",
  ),
);

export type ConnectionServes = v.InferOutput<typeof connectionServesSchema>;

/**
 * A provider connection as the UI and the harness see it.
 *
 * The id is slug-shaped, stable, and user-visible in URLs so it can be
 * bookmarked and logged without leaking a secret or an internal row id.
 */
export const providerConnectionSchema = v.object({
  id: providerConnectionIdSchema,
  displayName: v.pipe(v.string(), v.minLength(1)),
  source: providerSourceSchema,
  baseUrl: v.optional(v.pipe(v.string(), v.minLength(1))),
  enabled: v.boolean(),
  /**
   * Which built-in catalog this connection draws its models from, if any.
   *
   * Separate from `id` because they answer different questions. `id` is the
   * user's name for *this connection*; this is the vendor whose model list
   * applies to it. Collapsing them makes two accounts with the same vendor
   * impossible - two OpenAI keys would both have to be called "openai" -
   * and makes a connection named "work-openai" silently produce no models.
   *
   * Undefined means a provider the built-in catalog has never heard of, which
   * is the normal case for a self-hosted endpoint. Such a connection has only
   * the models the user enters by hand.
   */
  catalogProvider: v.optional(v.pipe(v.string(), v.minLength(1))),
  /**
   * Whether a credential exists. This type NEVER carries an API key, in
   * either direction. Only whether one exists. Keys move through the
   * credential store alone, so a serialized connection cannot leak a secret
   * and a fetched connection cannot be used to write one back.
   */
  credential: credentialStatusSchema,
  serves: connectionServesSchema,
});

export type ProviderConnection = v.InferOutput<typeof providerConnectionSchema>;

/** The kinds a connection serves, in the contract's fixed order. */
export function connectionKinds(connection: {
  readonly serves: ConnectionServes;
}): readonly ProviderKind[] {
  return providerKindSchema.options.filter((kind) => connection.serves[kind] !== undefined);
}

export function servesKind(
  connection: { readonly serves: ConnectionServes },
  kind: ProviderKind,
): boolean {
  return connection.serves[kind] !== undefined;
}

/**
 * The kind a model belongs to, read off what it can do.
 *
 * A model carries no kind of its own: a connection serves kinds, and a model
 * is chat, media or retrieval by its capability. Text generation is
 * language; search and fetch are retrieval; everything else that generates,
 * transcribes or embeds is media. A model that supports nothing recognisable
 * is language, because that is the only kind a hand-entered model with an
 * unknown capability can be run as.
 */
export function kindOfCapability(capability: ModelCapability): ProviderKind {
  if (capability.textGeneration === "supported") return "language";
  if (capability.webSearch === "supported" || capability.webFetch === "supported") {
    return "retrieval";
  }
  const media: readonly (keyof ModelCapability)[] = [
    "imageGeneration",
    "imageEditing",
    "videoGeneration",
    "speechGeneration",
    "transcription",
    "embeddings",
  ];
  if (media.some((slot) => capability[slot] === "supported")) return "media";
  return "language";
}

/**
 * Cost for one million tokens in US dollars.
 *
 * Each field is `number | "unknown"` so an absent price is distinct from
 * zero — the same reason ModelCapability uses "unknown" rather than 0 for an
 * undescribed limit. All values are in USD per million tokens, which is the
 * unit every provider reports in, so comparison needs no conversion.
 */
export const modelPricingSchema = v.object({
  input: v.union([v.number(), v.literal("unknown")]),
  output: v.union([v.number(), v.literal("unknown")]),
  cacheRead: v.union([v.number(), v.literal("unknown")]),
  cacheWrite: v.union([v.number(), v.literal("unknown")]),
});

export type ModelPricing = v.InferOutput<typeof modelPricingSchema>;

/**
 * A single model offered through a provider connection.
 *
 * `connectionId` ties it back to the connection that serves it. `modelId` is
 * exactly as the provider names it, so a request can be issued without
 * translation. `capability` is the full ModelCapability from the existing
 * model contract — not a second vocabulary — so pickers and policy share one
 * shape. `hidden` lets a user hide a model from pickers without deleting it,
 * and `origin` remembers whether it came from the built-in catalog, the user
 * typing it in, or a live fetch, so the UI can explain why it is there and
 * whether it will refresh.
 *
 * `reasoningLevels` is the per-model answer to "how hard can this one think":
 * the levels Pi's own model record supports, in Pi's order, empty for a model
 * that cannot reason. It exists beside `capability.reasoning` because the
 * boolean says WHETHER and this says WHICH - a fixed list of levels offered to
 * every model is how a composer ends up offering Max to a model with no
 * reasoning at all. The value comes from Pi's `getSupportedThinkingLevels`
 * with "off" removed; the composer supplies "default" itself.
 */
export const providerModelSchema = v.object({
  connectionId: v.pipe(v.string(), v.minLength(1)),
  modelId: v.pipe(v.string(), v.minLength(1)),
  displayName: v.pipe(v.string(), v.minLength(1)),
  capability: modelCapabilitySchema,
  // Optional with an empty default so records stored before this field
  // existed still parse; every freshly built row carries it explicitly.
  reasoningLevels: v.optional(v.array(reasoningLevelSchema), []),
  shape: invocationShapeSchema,
  pricing: modelPricingSchema,
  hidden: v.boolean(),
  origin: v.picklist(["catalog", "manual", "fetched"]),
  /**
   * Whether the provider itself still offers this model, as far as anyone
   * knows. Optional with a default of true so stored manual rows - which
   * predate the field - parse unchanged. The value is learned by probing
   * (the provider's own model list) and is advisory: an unavailable row is
   * kept out of pickers, never silently deleted.
   */
  available: v.optional(v.boolean(), true),
});

export type ProviderModel = v.InferOutput<typeof providerModelSchema>;

/**
 * The slots a user can pin a default model for.
 *
 * A subset of ModelCapability keys — only those where "which model should
 * handle this" is a meaningful user preference. Other capabilities like
 * `streaming` describe how a model behaves, not what it is for, so they are
 * not slots a user would pick a default for.
 *
 * Nine today. `imageEditing` is separate from `imageGeneration` because an
 * editor consumes an input image a generator need not accept; `webSearch`
 * and `webFetch` are separate because a search answers a question while a
 * fetch retrieves one named page. Adding a slot is a change to this list and
 * nothing else — the defaults schema below is derived from it.
 */
export const CAPABILITY_SLOTS = [
  "textGeneration",
  "imageGeneration",
  "imageEditing",
  "videoGeneration",
  "speechGeneration",
  "transcription",
  "embeddings",
  "webSearch",
  "webFetch",
] as const satisfies readonly (keyof ModelCapability)[];

export const capabilitySlotSchema = v.picklist(CAPABILITY_SLOTS);

export type CapabilitySlot = v.InferOutput<typeof capabilitySlotSchema>;

/**
 * The user's chosen defaults, if any, per slot.
 *
 * Partial on purpose — most users set one or two defaults and leave the rest
 * to the harness. The value is a reference, not an embedded model, so a
 * renamed model does not orphan the preference; it either still resolves or
 * visibly does not.
 */
export const modelReferenceSlotSchema = v.object({
  connectionId: v.pipe(v.string(), v.minLength(1)),
  modelId: v.pipe(v.string(), v.minLength(1)),
});

/**
 * Built from CAPABILITY_SLOTS rather than written out a second time.
 *
 * These were two hand-maintained copies of the same six names with nothing
 * forcing them to agree: a seventh slot added to the list compiled cleanly
 * while DefaultSelection silently could not express it. Deriving the object
 * means the list is the only place a slot is declared.
 */
export const defaultSelectionSchema = v.object(
  Object.fromEntries(
    CAPABILITY_SLOTS.map((slot) => [slot, v.optional(modelReferenceSlotSchema)]),
  ) as Record<
    CapabilitySlot,
    v.OptionalSchema<typeof modelReferenceSlotSchema, undefined>
  >,
);

export type DefaultSelection = v.InferOutput<typeof defaultSelectionSchema>;

/**
 * What probing a connection found.
 *
 * `ok` is the one bit the UI branches on. `reachedAt` is a timestamp so the
 * caller can show "as of" without re-probing. `modelCount` is present only
 * when the probe could enumerate, and `failure` is present only when it could
 * not — never both as a substitute. The type is deliberately narrow so a
 * probe that cannot reach the provider is not misread as "zero models".
 *
 * `status` and `latencyMs` are what the UI branches on; `failure` is the
 * human sentence it shows. Both are optional because both can be honestly
 * absent: a transport failure — DNS refusal, timeout — never produced an
 * HTTP status, and a probe that never left the process (no address to
 * probe) has no latency to report.
 */
export const probeResultSchema = v.object({
  ok: v.boolean(),
  reachedAt: v.number(),
  modelCount: v.optional(v.number()),
  failure: v.optional(v.string()),
  status: v.optional(v.number()),
  latencyMs: v.optional(v.number()),
});

export type ProbeResult = v.InferOutput<typeof probeResultSchema>;

/** A connection as the caller supplies it: no credential status, but a key. */
export type ProviderConnectionDraft = Omit<ProviderConnection, "credential"> & {
  readonly apiKey?: string;
};

/**
 * What one patch may say about the kinds a connection serves.
 *
 * A kind named with a protocol is added or re-wired; `null` removes it;
 * `undefined` leaves it alone - the same three-way rule `baseUrl` uses. The
 * store refuses a patch that would leave nothing served.
 */
export type ConnectionServesPatch = {
  readonly language?: LanguageProtocol | null;
  readonly media?: MediaProtocol | null;
  readonly retrieval?: RetrievalProtocol | null;
};

/**
 * What may change after creation.
 *
 * `id` is absent on purpose. Changing it turns a connection into a different
 * connection while models, defaults, and stored credentials still point at
 * the old one; the honest operation is remove and re-add. The kinds served
 * may change, because a key that served chat yesterday serves images today
 * without becoming a different account.
 */
export type ProviderConnectionPatch = {
  readonly displayName?: string;
  /**
   * `null` clears the base URL back to absent; `undefined` leaves it alone.
   *
   * The distinction is the whole point. Without an explicit clear, a
   * connection that once had an override could only ever be reassigned, never
   * returned to the protocol's own default - an omission, not a decision.
   * `null` rather than a magic empty string because `""` is already refused
   * by the connection schema, and a sentinel that resembles a value invites
   * exactly the typo it exists to prevent.
   */
  readonly baseUrl?: string | null;
  readonly enabled?: boolean;
  readonly serves?: ConnectionServesPatch;
  readonly apiKey?: string;
};

/**
 * this is the ONLY seam the frontend talks to; in-process callers call it
 * directly, and the HTTP surface is a thin adapter over it, not a second API.
 *
 * One interface keeps authorization, validation, and persistence in one place.
 * A second API — even one that mirrors this one over HTTP — would drift, and
 * drift is how a permission check lives in one path and not the other.
 */
export interface ProviderPort {
  listConnections(): Promise<readonly ProviderConnection[]>;

  getConnection(id: string): Promise<ProviderConnection | undefined>;

  addConnection(draft: ProviderConnectionDraft): Promise<ProviderConnection>;

  updateConnection(
    id: string,
    patch: ProviderConnectionPatch,
  ): Promise<ProviderConnection>;

  removeConnection(id: string): Promise<void>;

  probeConnection(id: string): Promise<ProbeResult>;

  listModels(filter?: {
    readonly connectionId?: string;
    readonly kind?: ProviderKind;
    readonly capability?: CapabilitySlot;
  }): Promise<readonly ProviderModel[]>;

  /**
   * Adds a model the built-in catalog does not know about.
   *
   * Separate from setModelOverride on purpose. An override patches something
   * that already exists; if a rename could also create, then a typo in a
   * model id becomes a permanent model with no capabilities rather than an
   * error, and there is no gesture left that means "I meant the one that
   * exists".
   */
  addManualModel(
    connectionId: string,
    model: {
      readonly modelId: string;
      readonly displayName: string;
      readonly capability?: Partial<ModelCapability>;
      readonly pricing?: Partial<ModelPricing>;
      readonly shape?: InvocationShape;
    },
  ): Promise<ProviderModel>;

  setModelOverride(
    connectionId: string,
    modelId: string,
    patch: { readonly displayName?: string; readonly hidden?: boolean },
  ): Promise<ProviderModel>;

  removeModel(connectionId: string, modelId: string): Promise<void>;

  getDefaults(): Promise<DefaultSelection>;

  setDefault(
    slot: CapabilitySlot,
    ref: { readonly connectionId: string; readonly modelId: string } | undefined,
  ): Promise<void>;
}
