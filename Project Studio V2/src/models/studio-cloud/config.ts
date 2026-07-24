import { ProviderConfigurationError } from "../../contracts/models.js";

export interface StudioGatewayConfig {
  /** Validated gateway root, without a trailing slash. */
  readonly baseUrl: string;
  /** The only origin the access token may be sent to. */
  readonly origin: string;
  /** Gateway model id the stable `project-studio/default` alias routes to. */
  readonly defaultModel: string;
  readonly requestTimeoutMs: number;
}

export interface StudioGatewayConfigInput {
  readonly baseUrl?: string | undefined;
  readonly defaultModel?: string | undefined;
  readonly requestTimeoutMs?: number | undefined;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 600_000;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Rejects any base URL that would send a bearer token somewhere unsafe:
 * a non-HTTPS scheme, a URL carrying embedded credentials, or a URL with a
 * query/fragment that a caller could use to smuggle state onto every request.
 *
 * Plain HTTP is permitted only for loopback hosts, which is what local mock
 * gateways in tests and local development use.
 */
function validateBaseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ProviderConfigurationError(
      "Studio gateway base URL is not a valid absolute URL.",
    );
  }

  const isLoopback = LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
    throw new ProviderConfigurationError(
      `Studio gateway base URL must use https (got "${url.protocol}"). Plain http is allowed only for loopback hosts.`,
    );
  }
  if (url.username !== "" || url.password !== "") {
    throw new ProviderConfigurationError(
      "Studio gateway base URL must not embed credentials.",
    );
  }
  if (url.search !== "" || url.hash !== "") {
    throw new ProviderConfigurationError(
      "Studio gateway base URL must not contain a query string or fragment.",
    );
  }

  return url;
}

function validateTimeout(raw: string | number | undefined): number {
  if (raw === undefined) return DEFAULT_TIMEOUT_MS;

  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new ProviderConfigurationError(
      "Studio gateway request timeout must be an integer number of milliseconds.",
    );
  }
  if (value < MIN_TIMEOUT_MS || value > MAX_TIMEOUT_MS) {
    throw new ProviderConfigurationError(
      `Studio gateway request timeout must be between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS} ms.`,
    );
  }
  return value;
}

function validateDefaultModel(raw: string): string {
  if (!/^[\w.-]+:[\w./-]+$/.test(raw)) {
    throw new ProviderConfigurationError(
      `Studio gateway default model "${raw}" is not a "<provider>:<model>" identifier.`,
    );
  }
  return raw;
}

export function resolveStudioGatewayConfig(
  input: StudioGatewayConfigInput = {},
): StudioGatewayConfig {
  const rawBaseUrl = input.baseUrl ?? readEnv("PROJECT_STUDIO_GATEWAY_URL");
  if (rawBaseUrl === undefined) {
    throw new ProviderConfigurationError(
      "Studio gateway base URL is required. Set PROJECT_STUDIO_GATEWAY_URL.",
    );
  }

  const url = validateBaseUrl(rawBaseUrl);

  // There is no canonical default model in the Studio Gateway contract, so one
  // must be named explicitly rather than invented here. When the catalog is
  // loaded, the adapter checks that this model actually exists.
  const rawDefaultModel =
    input.defaultModel ?? readEnv("PROJECT_STUDIO_GATEWAY_DEFAULT_MODEL");
  if (rawDefaultModel === undefined) {
    throw new ProviderConfigurationError(
      "Studio gateway default model is required. Set PROJECT_STUDIO_GATEWAY_DEFAULT_MODEL to the gateway model id the stable alias should route to.",
    );
  }
  const defaultModel = validateDefaultModel(rawDefaultModel);
  const requestTimeoutMs = validateTimeout(
    input.requestTimeoutMs ?? readEnv("PROJECT_STUDIO_GATEWAY_TIMEOUT_MS"),
  );

  return {
    baseUrl: `${url.origin}${url.pathname.replace(/\/+$/, "")}`,
    origin: url.origin,
    defaultModel,
    requestTimeoutMs,
  };
}
