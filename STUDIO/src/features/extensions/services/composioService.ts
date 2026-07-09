import { apiManager } from "@/core/network/apiManager";
import { tokenManager } from "@/utils/tokenManager";

async function getComposioBase(): Promise<string> {
  const endpoints = await apiManager.getEndpoints();
  return endpoints.mcp.replace(/\/mcp$/, "/composio");
}

async function authHeaders(): Promise<HeadersInit> {
  const token = await tokenManager.getAccessToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const base = await getComposioBase();
  const headers = await authHeaders();
  const res = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error((body as any)?.error?.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ------------------------------------------------------------------
// Apps (browse)
// ------------------------------------------------------------------

export interface ComposioApp {
  appId: string;
  name: string;
  description: string;
  categories: string[];
  logo: string;
  curatedCategory?: string;
}

export async function listComposioApps(params?: {
  search?: string;
}): Promise<{ items: ComposioApp[]; totalPages: number; totalCount: number }> {
  const qs = new URLSearchParams();
  if (params?.search) qs.set("search", params.search);
  const q = qs.toString();
  return apiFetch(`/apps${q ? `?${q}` : ""}`);
}

// ------------------------------------------------------------------
// Connections
// ------------------------------------------------------------------

export interface ComposioConnection {
  id: string;
  appName: string;
  displayName: string;
  status: "ACTIVE" | "INITIATED" | "EXPIRED" | "FAILED";
  enabled: boolean;
  entityId: string;
}

export async function listConnections(): Promise<{ items: ComposioConnection[] }> {
  return apiFetch("/connections");
}

export async function connectApp(
  appName: string,
  redirectUrl?: string
): Promise<{ redirectUrl?: string; connectionStatus: string; connectedAccountId: string; connectionId?: string }> {
  return apiFetch("/connect", {
    method: "POST",
    body: JSON.stringify({ appName, ...(redirectUrl ? { redirectUrl } : {}) }),
  });
}

export async function toggleConnection(connectionId: string, enabled: boolean): Promise<void> {
  await apiFetch(`/connections/${encodeURIComponent(connectionId)}`, {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
}

export async function disconnectApp(connectionId: string): Promise<void> {
  await apiFetch(`/connections/${encodeURIComponent(connectionId)}`, { method: "DELETE" });
}

/**
 * Clears the server-side logo/description cache for Composio apps.
 * The next call to listComposioApps() will re-fetch logos from Composio's API.
 * Safe to call for any authenticated user — the cache only contains public metadata.
 */
export async function refreshComposioAppsCache(): Promise<void> {
  await apiFetch("/apps/cache", { method: "DELETE" });
}
