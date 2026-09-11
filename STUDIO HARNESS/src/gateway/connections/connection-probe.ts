import type { ProbeResult, ProviderConnection } from "../../contracts/providers.js";
import { DestinationError } from "../../net/destination.js";
import {
  HttpError,
  requestDirect,
  type HttpResponse,
} from "../../net/http.js";
import { libraryBaseUrlFor } from "../catalog/index.js";

/**
 * 8 seconds. A model list is one small JSON document — served from a warm
 * local process or an edge cache — so a provider that has not answered by
 * then is not slow, it is stuck, and a stuck probe must not hold a settings
 * screen open. Eight rather than five leaves room for a cold Ollama or LM
 * Studio answering its first request while it loads, and for one sluggish
 * transcontinental TLS handshake; it stays under ten because a probe is a
 * convenience and never worth a longer wait.
 */
export const PROBE_TIMEOUT_MS = 8_000;

/**
 * Probes one provider connection with a single request.
 *
 * The probe is the user's "test this connection" gesture, so it reports the
 * truth about the far end and nothing else: every provider-side outcome — a
 * refused key, a missing endpoint, a hung server — becomes a `failure` string
 * the user can act on, never a throw. The only throwing condition is a
 * connection that does not exist, which is a caller's mistake rather than a
 * fact about the provider, and is raised by the caller before this runs.
 *
 * The request goes through `net/http.ts` like every outbound connection this
 * process opens, so the `C-17` policy in `destination.ts` applies unchanged.
 * The author is the user who configured the connection: that is what keeps a
 * loopback provider (Ollama, LM Studio) probeable while an address a model
 * produced inside a turn stays refused. A provider squatting on one of our
 * own listening ports is refused whoever asked — reaching our own control
 * plane through a "probe" would be escalation, not a test.
 */

interface ProbeTarget {
  /** The exact URL the probe requests. */
  readonly url: string;
  /**
   * The API base the probe resolved, path included, where a vendor-specific
   * follow-up request could be sent. Present only for the bearer-style list
   * endpoints a public-list quirk can apply to.
   */
  readonly base?: string;
  readonly headers: Record<string, string>;
  /**
   * A vendor's own way of saying the key was wrong, when it is not a 401 or
   * 403: ElevenLabs answers 400, Brave 422, MiniMax HTTP 200 with a status
   * code in the body. Returns true when the answer means the credential was
   * refused.
   */
  readonly refusedCredential?: (status: number, body: string) => boolean;
}

/** Reads the answer as JSON when it is, else nothing. */
function jsonIn(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

function minimaxStatusCode(body: string): number | undefined {
  const parsed = jsonIn(body);
  if (!isRecord(parsed) || !isRecord(parsed.base_resp)) return undefined;
  return typeof parsed.base_resp.status_code === "number" ? parsed.base_resp.status_code : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The probe's answer plus what it learned about what the provider serves. */
export interface DetailedProbeResult extends ProbeResult {
  /**
   * The model ids the provider's own list named, present only when the probe
   * could enumerate a list that carries ids. Consumed by the management
   * service (which records it) and stripped from the wire response - the
   * caller's screen wants the count, not four hundred ids.
   */
  readonly servedIds?: readonly string[];
}

export async function probeProviderConnection(
  connection: ProviderConnection,
  apiKey: string | undefined,
  options: ProbeOptions = {},
): Promise<ProbeResult> {
  const detailed = await probeProviderConnectionDetailed(connection, apiKey, options);
  const { servedIds: _servedIds, ...result } = detailed;
  void _servedIds;
  return result;
}

/**
 * Vendors whose model list answers 200 without checking the credential.
 *
 * OpenRouter serves `/models` to anyone; a rejected key shows up only on the
 * authenticated endpoints, `/key` among them. For these, a 2xx list is not
 * yet a probe pass: one extra authenticated GET asks the vendor whether the
 * key itself is good, and only then does the probe report success. Keyed by
 * `catalogProvider` - the vendor, not the protocol - because a self-hosted
 * OpenAI-compatible endpoint with no such route must not be sent there.
 */
const PUBLIC_LIST_VENDORS: Readonly<Record<string, string>> = {
  openrouter: "/key",
};

async function checkCredential(
  connection: ProviderConnection,
  target: ProbeTarget,
  apiKey: string | undefined,
  timeoutMs: number,
): Promise<DetailedProbeResult | undefined> {
  if (apiKey === undefined || target.base === undefined) return undefined;
  const path = PUBLIC_LIST_VENDORS[connection.catalogProvider ?? ""];
  if (path === undefined) return undefined;

  let response: HttpResponse;
  try {
    response = await requestDirect({
      url: `${target.base}${path}`,
      author: "user",
      headers: { ...target.headers },
      timeoutMs,
    });
  } catch {
    // The list already answered: an unreachable key endpoint is not evidence
    // of a bad key, and the probe reports what it knows.
    return undefined;
  }
  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      reachedAt: Date.now(),
      failure: `${connection.displayName} rejected the credential for this connection.`,
      status: response.status,
    };
  }
  return undefined;
}

export async function probeProviderConnectionDetailed(
  connection: ProviderConnection,
  apiKey: string | undefined,
  options: ProbeOptions = {},
): Promise<DetailedProbeResult> {
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  const reachedAt = Date.now();

  const target = probeTarget(connection, apiKey);
  if (target === undefined) {
    return {
      ok: false,
      reachedAt,
      failure: `${connection.displayName} has no base URL to probe.`,
    };
  }

  // Measured around the one request and nothing else — not target
  // resolution, not response parsing — so the number is what the far end
  // cost, which is what a UI sorting connections by responsiveness wants.
  const startedAt = Date.now();
  let response: HttpResponse;
  try {
    response = await requestDirect({
      url: target.url,
      // The person who configured the connection chose this address, not a
      // model mid-turn — that judgement is what allows the loopback base
      // URLs Ollama and LM Studio live behind.
      author: "user",
      headers: target.headers,
      timeoutMs,
    });
  } catch (error) {
    return {
      ok: false,
      reachedAt,
      failure: failureForTransport(connection, error, timeoutMs),
      latencyMs: Date.now() - startedAt,
    };
  }

  const latencyMs = Date.now() - startedAt;

  const refused =
    response.status === 401 ||
    response.status === 403 ||
    (target.refusedCredential?.(response.status, response.body) ?? false);
  if (refused) {
    return {
      ok: false,
      reachedAt,
      failure:
        apiKey === undefined
          ? `${connection.displayName} requires a credential and none is set for this connection.`
          : `${connection.displayName} rejected the credential for this connection.`,
      status: response.status,
      latencyMs,
    };
  }

  if (response.status === 404) {
    return {
      ok: false,
      reachedAt,
      failure: `${connection.displayName} has no model list at the configured address.`,
      status: response.status,
      latencyMs,
    };
  }

  if (response.status < 200 || response.status >= 300) {
    return {
      ok: false,
      reachedAt,
      failure: `${connection.displayName} answered with HTTP ${response.status}.`,
      status: response.status,
      latencyMs,
    };
  }

  const modelCount = countModels(connection, response.body);
  const servedIds = listModelIds(connection, response.body);
  // A list the vendor serves to anyone proves reachability, not the key.
  // The credential check below is what turns a wrong key into a refusal.
  const credentialFailure = await checkCredential(connection, target, apiKey, timeoutMs);
  if (credentialFailure !== undefined) return credentialFailure;
  return {
    ok: true,
    reachedAt,
    status: response.status,
    latencyMs,
    ...(modelCount === undefined ? {} : { modelCount }),
    ...(servedIds === undefined ? {} : { servedIds }),
  };
}

/**
 * The base URL a catalog-backed connection probes when the user never typed
 * one: the library's answer, which reads the declared catalog and then the
 * language catalog. Kept under this name for the language bootstrap, which
 * asks the same question of the same connection.
 */
export function catalogBaseUrlFor(catalogProvider: string): string | undefined {
  return libraryBaseUrlFor(catalogProvider);
}

/**
 * Where "list models" lives for each protocol, and how the credential is
 * presented there.
 *
 * Retrieval protocols have no model list anywhere in their APIs, so their
 * probe is the base address itself: reachability plus whether the credential
 * was accepted. `modelCount` stays absent for them — reporting 0 would claim
 * a count nobody can make.
 */
/**
 * Joins a version segment to a base that may already carry it.
 *
 * Two kinds of base URL arrive here and they disagree about where the API
 * version lives. Anthropic's catalog base is a bare origin, so the version
 * belongs to the path this file appends. Google's catalog base is
 * `https://generativelanguage.googleapis.com/v1beta` - the version is already
 * in it - and appending a second `/v1beta` produced a doubled path that the
 * vendor answers 404, which reached the user as "has no model list at the
 * configured address" for a connection whose key and address were both fine.
 *
 * Matching the last segment rather than a substring keeps a base that merely
 * contains the word (a proxy at `/v1beta-mirror`) from being mistaken for one
 * that ends in the version.
 */
function withVersion(origin: string, version: string): string {
  return origin.endsWith(`/${version}`) ? origin : `${origin}/${version}`;
}

/** FAL's listing host, distinct from the queue host generations use. */
const FAL_API_HOST = "https://api.fal.ai";

function probeTarget(
  connection: ProviderConnection,
  apiKey: string | undefined,
): ProbeTarget | undefined {
  // An explicit baseUrl always wins — a user who typed a URL meant it. Only
  // when the connection never had one does the catalog answer, and where the
  // URL came from is an implementation detail the result never mentions.
  const base =
    connection.baseUrl ?? catalogBaseUrlFor(connection.catalogProvider ?? "");
  if (base === undefined) return undefined;
  const origin = base.endsWith("/") ? base.slice(0, -1) : base;

  const headers: Record<string, string> = { accept: "application/json" };
  const bearer = apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` };

  switch (probeProtocol(connection)) {
    case "openai-completions":
    case "openai-responses":
    case "mistral-conversations":
    case "openai":
    case "openrouter":
      return { url: `${origin}/models`, base: origin, headers: { ...headers, ...bearer } };
    case "azure-openai-responses":
      // Azure authenticates with its own header, not a bearer token.
      return {
        url: `${origin}/models`,
        headers: {
          ...headers,
          ...(apiKey === undefined ? {} : { "api-key": apiKey }),
        },
      };
    case "deepgram":
      // Deepgram's projects listing answers with the key's own projects.
      return {
        url: `${origin}/projects`,
        headers: {
          ...headers,
          ...(apiKey === undefined ? {} : { authorization: `Token ${apiKey}` }),
        },
      };
    case "fish-audio":
      // The wallet lives at the host, beside the /v1 the speech routes use.
      return {
        url: `${origin.replace(/\/v1$/, "")}/wallet/self/api-credit`,
        headers: { ...headers, ...bearer },
      };
    case "minimax":
      // MiniMax answers HTTP 200 to a wrong key and says so in base_resp.
      return {
        url: `${origin}/v1/files/list`,
        headers: { ...headers, ...bearer },
        refusedCredential: (_status, body) => {
          const code = minimaxStatusCode(body);
          return code !== undefined && code !== 0;
        },
      };
    case "elevenlabs":
      return {
        url: `${origin}/models`,
        headers: {
          ...headers,
          ...(apiKey === undefined ? {} : { "xi-api-key": apiKey }),
        },
        // A wrong key is a 400 whose detail names an authentication error.
        refusedCredential: (status, body) => status === 400 && body.includes("authentication_error"),
      };
    case "anthropic-messages":
      return {
        url: `${withVersion(origin, "v1")}/models`,
        headers: {
          ...headers,
          ...(apiKey === undefined ? {} : { "x-api-key": apiKey }),
          "anthropic-version": "2023-06-01",
        },
      };
    case "google-generative-ai":
    case "google":
      return {
        url: `${withVersion(origin, "v1beta")}/models`,
        headers: {
          ...headers,
          ...(apiKey === undefined ? {} : { "x-goog-api-key": apiKey }),
        },
      };
    // The retrieval vendors have no model list; each is asked the cheapest
    // question its API answers only with a good key.
    case "brave":
      // One search, one result: Brave has no account endpoint, and a wrong
      // token is a 422 naming SUBSCRIPTION_TOKEN_INVALID.
      return {
        url: `${origin}/web/search?q=studio&count=1`,
        headers: {
          ...headers,
          ...(apiKey === undefined ? {} : { "x-subscription-token": apiKey }),
        },
        refusedCredential: (status, body) => status === 422 && body.includes("SUBSCRIPTION_TOKEN_INVALID"),
      };
    case "exa":
      return { url: `${origin}/websets/v0/websets?limit=1`, headers: { ...headers, ...bearer } };
    case "tavily":
      return { url: `${origin}/usage`, headers: { ...headers, ...bearer } };
    case "firecrawl":
      return { url: `${origin}/team/credit-usage`, headers: { ...headers, ...bearer } };
    case "jina":
      return { url: `${origin}/https://example.com`, headers: { ...headers, ...bearer } };
    case "fal":
      // The queue host lists no models; FAL's model listing lives on its API
      // host and refuses a wrong key, with FAL's own `Key` prefix.
      return {
        url: `${FAL_API_HOST}/v1/models?limit=1`,
        headers: {
          ...headers,
          ...(apiKey === undefined ? {} : { authorization: `Key ${apiKey}` }),
        },
      };
  }
}

/**
 * The one wire a probe speaks for a connection that may serve several.
 *
 * A connection is probed once, not once per kind: the key is the same and
 * so is the host. Language comes first because its `/models` answer carries
 * the ids the catalog marks availability from; media next, because its
 * endpoints list too; retrieval last, because a retrieval probe only
 * confirms the key is accepted.
 */
function probeProtocol(connection: ProviderConnection) {
  return connection.serves.language ?? connection.serves.media ?? connection.serves.retrieval;
}

/** Whether this connection's probe answers with a list that carries model ids. */
function listsModels(connection: ProviderConnection): boolean {
  if (connection.serves.language !== undefined) return true;
  const media = connection.serves.media;
  return media !== undefined && !["fal", "deepgram", "fish-audio", "minimax"].includes(media);
}

/**
 * Counts what the endpoint listed, or returns undefined when it listed
 * nothing countable.
 *
 * An empty array is a real answer — zero models — while a body with no array
 * in it is "we could not tell", and the two must not collapse into the same
 * 0. Anthropic paginates its model list, so the count there is the first
 * page's; a probe that paged to exhaustion would stop being one request.
 */
function countModels(connection: ProviderConnection, body: string): number | undefined {
  if (!listsModels(connection)) return undefined;
  const list = modelListIn(body, connection);
  return list?.length;
}

/**
 * The model ids the endpoint listed, or undefined when it listed nothing
 * usable. These are what the catalog later marks availability against, so
 * they are collected verbatim - no trimming, no normalization - because the
 * catalog's rows use the provider's own spelling.
 */
function listModelIds(
  connection: ProviderConnection,
  body: string,
): readonly string[] | undefined {
  if (!listsModels(connection)) return undefined;
  const list = modelListIn(body, connection);
  if (list === undefined) return undefined;

  const ids: string[] = [];
  for (const entry of list) {
    if (!isRecord(entry)) continue;
    const id = typeof entry.id === "string" ? entry.id : typeof entry.name === "string" ? entry.name : undefined;
    if (id === undefined) continue;
    ids.push(id.startsWith("models/") ? id.slice("models/".length) : id);
  }
  return ids;
}

function modelListIn(body: string, connection: ProviderConnection): readonly unknown[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;

  const list = probeProtocol(connection) === "google-generative-ai" ? parsed.models : parsed.data;
  return Array.isArray(list) ? list : undefined;
}

/**
 * A transport failure in the register of the rest of the file: what happened,
 * in words a person reading a settings screen can act on. The credential
 * never appears — it travelled in a header, and a failure message is not a
 * place it can accidentally reach.
 */
function failureForTransport(
  connection: ProviderConnection,
  error: unknown,
  timeoutMs: number,
): string {
  if (error instanceof HttpError) {
    if (error.kind === "unreachable") {
      return `${connection.displayName} could not be reached.`;
    }
    if (error.kind === "timeout") {
      // Never "0 seconds": a caller may pass a sub-second deadline in a test,
      // and a message that rounds the wait away misdescribes it.
      const seconds = Math.max(1, Math.round(timeoutMs / 1000));
      return `${connection.displayName} did not answer within ${seconds} second${seconds === 1 ? "" : "s"}.`;
    }
    return `${connection.displayName}: ${error.message}`;
  }
  if (error instanceof DestinationError) {
    // Already written for a reader: "That address is Project Studio's own
    // service..." says more than a status code could.
    return error.message;
  }
  return `${connection.displayName} could not be probed.`;
}

export interface ProbeOptions {
  readonly timeoutMs?: number;
}
