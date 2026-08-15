export type AnalyticsRange = "24h" | "7d" | "30d";

export interface AnalyticsOverview {
  range: AnalyticsRange;
  from: number;
  to: number;
  summary: {
    totalRequests: number;
    successfulRequests: number;
    errorRequests: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    cacheReadRate: number;
    cost: number;
    avgLatencyMs: number;
    avgProviderLatencyMs: number;
    avgRoutingLatencyMs: number;
    avgTimeToFirstTokenMs: number;
    avgTokensPerSecond: number;
  };
  timeseries: Array<{
    day: string;
    requests: number;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    cost: number;
    cache_read_tokens: number;
    avg_latency_ms: number;
  }>;
  models: Array<{ model_id: string; provider_id: string; model_category: string; requests: number; total_tokens: number; cost: number; avg_latency_ms: number }>;
  providers: Array<{ provider_id: string; requests: number; total_tokens: number; cost: number; avg_latency_ms: number }>;
  tokens: Array<{ gateway_key_id: string; gateway_key_name: string | null; requests: number; total_tokens: number; cost: number }>;
}

export interface GatewayRequest {
  request_id: string;
  generation_id: string | null;
  created_at: number;
  completed_at: number | null;
  method: string;
  path: string;
  status_code: number;
  gateway_key_id: string | null;
  gateway_key_name: string | null;
  application: string | null;
  model_id: string | null;
  provider_id: string | null;
  model_category: string | null;
  streaming: number;
  reasoning_used: number;
  tools_called: number;
  fallback_used: number;
  finish_reason: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  cached_tokens: number | null;
  cache_read_tokens: number | null;
  cost: number | null;
  routing_latency_ms: number | null;
  provider_latency_ms: number | null;
  total_latency_ms: number | null;
  time_to_first_token_ms: number | null;
  tokens_per_second: number | null;
  error_code: string | null;
  error_message?: string | null;
}

export interface RequestDetail extends GatewayRequest {
  provider_name: string | null;
  provider_base_url: string | null;
  model_display_name: string | null;
  input_modalities: string[] | null;
  output_modalities: string[] | null;
  context_window: number | null;
  max_output_tokens: number | null;
  pricing_input: number | null;
  pricing_output: number | null;
  pricing_cache_read: number | null;
  pricing_cache_write: number | null;
  supports_tools: number;
  supports_vision: number;
  supports_reasoning: number;
  family: string | null;
  lab: string | null;
  open_weights: number;
  knowledge_cutoff: string | null;
  error_message: string | null;
  provider_response_id: string | null;
}

export interface CatalogModel {
  provider_id: string;
  model_id: string;
  display_name: string | null;
  category: string;
  input_modalities: string[] | null;
  output_modalities: string[] | null;
  context_window: number | null;
  max_output_tokens: number | null;
  pricing_input: number | null;
  pricing_output: number | null;
  pricing_cache_read: number | null;
  pricing_cache_write: number | null;
  supports_tools: number;
  supports_parallel_tools: number;
  supports_vision: number;
  supports_reasoning: number;
  reasoning_type: string | null;
  family: string | null;
  lab: string | null;
  open_weights: number;
  knowledge_cutoff: string | null;
  catalog_source: string | null;
  exposed: number;
  enabled: number;
  fetched_at: number | null;
}

export interface Provider {
  id: string;
  name: string;
  base_url: string;
  protocol: string;
  auth_mode: string;
  enabled: number;
  catalog_source?: string | null;
  doc_url?: string | null;
  created_at: number;
  updated_at: number;
  credential_configured?: number;
}

export interface GatewayKey {
  id: string;
  name: string;
  description: string | null;
  key_prefix: string;
  scopes: string | null;
  rate_limit_rpm: number;
  enabled: number;
  created_at: number;
  last_used_at: number | null;
}

export interface NewGatewayKey {
  id: string;
  name: string;
  key: string;
  prefix: string;
  rate_limit_rpm: number;
}

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

const TOKEN_KEY = "studio-gateway-ui-token";
const baseUrl = (import.meta.env.VITE_GATEWAY_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export function getAdminToken(): string {
  try { return sessionStorage.getItem(TOKEN_KEY) ?? ""; } catch { return ""; }
}

export function setAdminToken(token: string): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private browsing can deny session storage; requests still work locally.
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  const token = getAdminToken();
  if (token) headers.set("x-admin-token", token);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  if (!response.ok) {
    let message = `Gateway request failed (${response.status})`;
    try {
      const payload = await response.json() as { error?: { message?: string } };
      message = payload.error?.message ?? message;
    } catch { /* use status fallback */ }
    throw new ApiError(response.status, message);
  }
  return response.json() as Promise<T>;
}

export const gatewayApi = {
  overview: (range: AnalyticsRange) => request<AnalyticsOverview>(`/admin/analytics/overview?range=${range}`),
  requests: (params = "") => request<{ data: GatewayRequest[]; total: number }>(`/admin/requests${params ? `?${params}` : ""}`),
  request: (id: string) => request<{ data: RequestDetail }>(`/admin/requests/${encodeURIComponent(id)}`),
  models: (params = "limit=500") => request<{ data: CatalogModel[]; total: number }>(`/admin/models?${params}`),
  providers: () => request<{ data: Provider[] }>("/admin/providers"),
  provider: (id: string) => request<{ provider: Provider; models: CatalogModel[] }>(`/admin/providers/${encodeURIComponent(id)}`),
  updateProvider: (id: string, body: { enabled?: boolean; base_url?: string }) => request<{ ok: boolean }>(`/admin/providers/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) }),
  saveCredential: (id: string, apiKey: string) => request<{ ok: boolean; hint: string }>(`/admin/providers/${encodeURIComponent(id)}/credential`, { method: "PUT", body: JSON.stringify({ apiKey }) }),
  deleteCredential: (id: string) => request<{ ok: boolean }>(`/admin/providers/${encodeURIComponent(id)}/credential`, { method: "DELETE" }),
  syncProvider: (id: string) => request<{ discovered: number; errors: string[] }>(`/admin/providers/${encodeURIComponent(id)}/sync`, { method: "POST" }),
  bulkModels: (modelIds: Array<{ provider_id: string; model_id: string }>, body: { exposed?: boolean; enabled?: boolean }) => request<{ updated: number }>("/admin/models/bulk", { method: "POST", body: JSON.stringify({ modelIds, ...body }) }),
  syncCatalog: () => request<{ upserted?: number }>("/admin/catalog/sync", { method: "POST" }),
  discovery: () => request<{ discovered?: number }>("/admin/discovery/run", { method: "POST" }),
  keys: () => request<{ data: GatewayKey[] }>("/admin/keys"),
  createKey: (body: { name: string; description?: string; rateLimitRpm?: number }) => request<NewGatewayKey>("/admin/keys", { method: "POST", body: JSON.stringify(body) }),
  updateKey: (id: string, body: { enabled?: boolean; name?: string; description?: string; rateLimitRpm?: number }) => request<{ ok: boolean }>(`/admin/keys/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) }),
  rotateKey: (id: string) => request<NewGatewayKey>(`/admin/keys/${encodeURIComponent(id)}/rotate`, { method: "POST" }),
  deleteKey: (id: string) => request<{ ok: boolean }>(`/admin/keys/${encodeURIComponent(id)}`, { method: "DELETE" }),
  health: () => request<{ status: string; environment?: string; timestamp?: string }>("/health"),
  ready: () => request<{ status: string; db?: string }>("/ready"),
};
