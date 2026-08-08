import * as v from "valibot";

import { ProviderConfigurationError } from "../../contracts/models.js";
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

export interface LocalModelConfig {
  /** Provider id owning the model the stable alias routes to. */
  readonly defaultProvider: string;
  /** Model id within that provider. */
  readonly defaultModel: string;
  readonly customProviders: readonly CustomProviderConfig[];
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
 */
export function resolveLocalModelConfig(
  input: {
    readonly defaultModel?: string | undefined;
    readonly defaultSelection?:
      | { readonly provider: string; readonly model: string }
      | undefined;
    readonly customProviders?: readonly CustomProviderConfig[] | undefined;
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
