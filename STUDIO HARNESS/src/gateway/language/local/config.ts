import * as v from "valibot";

import { ProviderConfigurationError, type ReasoningLevel } from "../../../contracts/models.js";
import { DEFAULT_CUSTOM_API, supportedCustomApis } from "./apis.js";
import { assertValidProviderId } from "./credential-bridge.js";

/**
 * A provider Project Studio does not ship, described by the user.
 *
 * This is the extensibility path that gives BYOK its real breadth. Ollama, LM
 * Studio, LiteLLM, vLLM, corporate proxies, and most new hosted services all
 * speak the OpenAI wire format, so they need configuration rather than code.
 */
export interface CustomProviderConfig {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  /** Pi wire protocol. Defaults to the OpenAI-compatible one. */
  readonly api: string;
  /** Model ids to expose. Local servers cannot always be enumerated. */
  readonly models: readonly string[];
  readonly contextWindow: number | undefined;
  readonly maxTokens: number | undefined;
}

/**
 * One user-added model under a catalog-backed provider.
 *
 * A model the catalogs have never heard of, entered by hand under a vendor
 * they do - "add a model to an existing provider". The runtime registers it
 * beside the vendor's own models so a turn naming it resolves instead of
 * failing; the levels and limits are the user's own word about the model.
 */
export interface ExtraRuntimeModel {
  readonly id: string;
  readonly name: string;
  readonly reasoningLevels: readonly ReasoningLevel[];
  readonly contextWindow: number | undefined;
  readonly maxTokens: number | undefined;
}

/** The models one provider gains from the user's hand-entered rows. */
export interface ExtraProviderModelGroup {
  readonly provider: string;
  readonly baseUrl: string;
  readonly api: string;
  readonly models: readonly ExtraRuntimeModel[];
}

export interface LocalModelConfig {
  /**
   * Provider id owning the model the stable alias routes to, or `undefined`
   * when the user has connected nothing yet.
   *
   * Undefined is a state, not an error, on the app path: a harness somebody
   * just installed starts, serves the provider-management routes that let the
   * settings UI fix the omission, and refuses individual turns until a model
   * is chosen. The env-driven path (`PROJECT_STUDIO_LOCAL_DEFAULT_MODEL`)
   * treats absence as an error instead, because a headless caller that asked
   * for `local` by name has nothing to configure through a UI.
   */
  readonly defaultProvider: string | undefined;
  /** Model id within that provider. `undefined` under the same rule. */
  readonly defaultModel: string | undefined;
  readonly customProviders: readonly CustomProviderConfig[];
  readonly extraModels: readonly ExtraProviderModelGroup[];
}

const DEFAULT_API = DEFAULT_CUSTOM_API;

const customProviderSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1)),
  name: v.optional(v.pipe(v.string(), v.minLength(1))),
  baseUrl: v.pipe(v.string(), v.minLength(1)),
  api: v.optional(v.pipe(v.string(), v.minLength(1))),
  models: v.optional(v.array(v.pipe(v.string(), v.minLength(1)))),
  contextWindow: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
  maxTokens: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
});

const customProvidersSchema = v.array(customProviderSchema);

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Splits `provider/model` on the first separator only. Model ids frequently
 * contain slashes themselves — OpenRouter ids look like
 * `openrouter/anthropic/claude-sonnet-4` — so splitting on the last separator,
 * or on every one, would mangle them.
 */
export function parseModelSpecifier(raw: string): {
  provider: string;
  model: string;
} {
  const separator = raw.indexOf("/");
  if (separator <= 0 || separator === raw.length - 1) {
    throw new ProviderConfigurationError(
      `Local default model "${raw}" must be written as "<provider>/<model>", for example "anthropic/claude-sonnet-4-6" or "ollama/llama3.1:8b".`,
    );
  }
  return {
    provider: raw.slice(0, separator),
    model: raw.slice(separator + 1),
  };
}

/**
 * Resolves the local source's configuration.
 *
 * Settings are the real source: `defaultSelection` and `customProviders` come
 * from the provider settings store. The environment variables remain as an
 * override for development and for headless runs that have no settings
 * database, and they are only consulted when settings supply nothing.
 *
 * This is the strict entry point: a caller that reaches for it without any
 * selection gets an error, because headless callers cannot fix the omission
 * themselves. The composition path that starts a desktop app uses
 * [`tolerantLocalModelConfig`], where an unselected default is a state the
 * settings UI exists to resolve.
 */
export function resolveLocalModelConfig(
  input: {
    readonly defaultModel?: string | undefined;
    readonly defaultSelection?:
      | { readonly provider: string; readonly model: string }
      | undefined;
    readonly customProviders?: readonly CustomProviderConfig[] | undefined;
    readonly extraModels?: readonly ExtraProviderModelGroup[] | undefined;
  } = {},
): LocalModelConfig {
  const selection = input.defaultSelection ?? resolveDefaultSelection(input.defaultModel);
  if (selection === undefined) {
    throw new ProviderConfigurationError(
      'No default model is selected. Choose one in provider settings, or set PROJECT_STUDIO_LOCAL_DEFAULT_MODEL to "<provider>/<model>".',
    );
  }

  return {
    defaultProvider: selection.provider,
    defaultModel: selection.model,
    customProviders: input.customProviders ?? readCustomProviders(),
    extraModels: input.extraModels ?? [],
  };
}

/**
 * The default selection carried by `PROJECT_STUDIO_LOCAL_DEFAULT_MODEL`, or
 * `undefined` when it says nothing.
 *
 * Exported so the composition root can apply the same settings-first,
 * environment-second order the strict resolver uses, without that resolver's
 * throw on total absence.
 */
export function defaultSelectionFromEnvironment():
  | { readonly provider: string; readonly model: string }
  | undefined {
  return resolveDefaultSelection(undefined);
}

/**
 * The tolerant counterpart, for paths where a first launch is normal.
 *
 * Same fields, same validation of whatever selection exists — an env override
 * is still parsed and a malformed specifier still fails here. What differs is
 * only absence: no selection yields `undefined`, not a startup failure.
 */
export function tolerantLocalModelConfig(input: {
  readonly defaultSelection?:
    | { readonly provider: string; readonly model: string }
    | undefined;
  readonly customProviders: readonly CustomProviderConfig[];
  readonly extraModels?: readonly ExtraProviderModelGroup[];
}): LocalModelConfig {
  return {
    defaultProvider: input.defaultSelection?.provider,
    defaultModel: input.defaultSelection?.model,
    customProviders: input.customProviders,
    extraModels: input.extraModels ?? [],
  };
}

function resolveDefaultSelection(
  explicit: string | undefined,
): { provider: string; model: string } | undefined {
  const raw = explicit ?? readEnv("PROJECT_STUDIO_LOCAL_DEFAULT_MODEL");
  return raw === undefined ? undefined : parseModelSpecifier(raw);
}

/**
 * Reads the user's custom providers without requiring a default model, so
 * provider management works before a default has been chosen.
 */
export function resolveCustomProviders(): readonly CustomProviderConfig[] {
  return readCustomProviders();
}

/**
 * Combines stored providers with any declared in the environment.
 *
 * Stored providers win on an id collision: settings are what the user edited
 * most recently, and a stale environment variable silently overriding the UI
 * would be indistinguishable from the edit not saving.
 */
export function mergeCustomProviders(
  stored: readonly CustomProviderConfig[],
  fromEnvironment: readonly CustomProviderConfig[] = readCustomProviders(),
): readonly CustomProviderConfig[] {
  const merged = new Map<string, CustomProviderConfig>();
  for (const entry of fromEnvironment) merged.set(entry.id, entry);
  for (const entry of stored) merged.set(entry.id, entry);
  return [...merged.values()];
}

function readCustomProviders(): readonly CustomProviderConfig[] {
  const raw = readEnv("PROJECT_STUDIO_LOCAL_PROVIDERS");
  if (raw === undefined) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ProviderConfigurationError(
      "PROJECT_STUDIO_LOCAL_PROVIDERS must be a JSON array of provider definitions.",
    );
  }

  const result = v.safeParse(customProvidersSchema, parsed);
  if (!result.success) {
    throw new ProviderConfigurationError(
      "PROJECT_STUDIO_LOCAL_PROVIDERS entries must each have an id and baseUrl, with optional name, api, models, contextWindow, and maxTokens.",
    );
  }

  return result.output.map((entry) => normalizeCustomProvider(entry));
}

export interface CustomProviderInput {
  readonly id: string;
  readonly name?: string | undefined;
  readonly baseUrl: string;
  readonly api?: string | undefined;
  readonly models?: readonly string[] | undefined;
  readonly contextWindow?: number | undefined;
  readonly maxTokens?: number | undefined;
}

/**
 * Validates and canonicalizes one user-declared provider.
 *
 * Shared by the environment path and the settings store so a provider cannot be
 * accepted through one door under rules the other would reject.
 */
export function normalizeCustomProvider(
  entry: CustomProviderInput,
): CustomProviderConfig {
  try {
    assertValidProviderId(entry.id);
  } catch {
    throw new ProviderConfigurationError(
      `Custom provider id "${entry.id}" must be lowercase letters, digits, and hyphens.`,
    );
  }

  validateBaseUrl(entry.id, entry.baseUrl);

  const api = entry.api ?? DEFAULT_API;
  // The runtime can only build a provider for a wire protocol it can load.
  // Without this check an unknown value produces a provider that silently does
  // not exist, which reads to the user as the connection having vanished.
  if (!supportedCustomApis().includes(api)) {
    throw new ProviderConfigurationError(
      `Custom provider "${entry.id}" declares unsupported api "${api}". Supported: ${supportedCustomApis().join(", ")}.`,
    );
  }

  return {
    id: entry.id,
    name: entry.name ?? entry.id,
    baseUrl: entry.baseUrl.replace(/\/+$/, ""),
    api,
    models: entry.models ?? [],
    contextWindow: entry.contextWindow,
    maxTokens: entry.maxTokens,
  };
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Local servers legitimately run over plain HTTP on loopback — that is exactly
 * what Ollama and LM Studio do — but a remote endpoint receiving a user's API
 * key must use TLS.
 */
function validateBaseUrl(id: string, raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ProviderConfigurationError(
      `Custom provider "${id}" has a baseUrl that is not a valid absolute URL.`,
    );
  }

  const isLoopback = LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
    throw new ProviderConfigurationError(
      `Custom provider "${id}" must use https. Plain http is allowed only for loopback hosts such as Ollama or LM Studio.`,
    );
  }
  if (url.username !== "" || url.password !== "") {
    throw new ProviderConfigurationError(
      `Custom provider "${id}" must not embed credentials in its baseUrl.`,
    );
  }
}
