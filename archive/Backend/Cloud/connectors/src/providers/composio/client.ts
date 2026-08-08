import type { ComposioAction, ComposioAppConfig, Env } from "../../types";
import { connectorError } from "../../errors";

const DEFAULT_COMPOSIO_API = "https://backend.composio.dev/api";

export interface ComposioConnectedAccount {
  id: string;
  user_id: string;
  status: string;
  status_reason?: string;
  toolkit?: { slug?: string };
  auth_config?: { id?: string; auth_scheme?: string; is_composio_managed?: boolean };
  created_at?: string;
  updated_at?: string;
  state?: { val?: { expired_at?: string; redirectUrl?: string; error?: string; error_description?: string } };
}

export interface ComposioToolkit {
  slug?: string;
  name?: string;
  description?: string;
  logo?: string;
  logo_url?: string;
  icon?: string;
  categories?: string[];
  meta?: {
    logo?: string;
    logo_url?: string;
    categories?: string[];
    description?: string;
  };
}

export interface ComposioLinkResponse {
  link_token?: string;
  redirect_url?: string;
  expires_at?: string;
  connected_account_id?: string;
}

function baseUrl(env: Env): string {
  return (env.COMPOSIO_API_BASE ?? DEFAULT_COMPOSIO_API).replace(/\/$/, "");
}

function apiKey(env: Env): string {
  if (!env.COMPOSIO_API_KEY) {
    throw connectorError("not_configured", "COMPOSIO_API_KEY is not configured", { provider: "composio" });
  }
  return env.COMPOSIO_API_KEY;
}

async function composioRequest<T>(
  env: Env,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${baseUrl(env)}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-api-key": apiKey(env),
      ...(init.headers ?? {}),
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const providerError = (data as { error?: { message?: string; slug?: string; request_id?: string; suggested_fix?: string } }).error;
    throw connectorError(
      res.status === 401 || res.status === 403 ? "provider_auth_expired" : "provider_error",
      providerError?.message ?? `Composio API ${path} returned HTTP ${res.status}`,
      {
        provider: "composio",
        provider_status: res.status,
        provider_slug: providerError?.slug,
        provider_request_id: providerError?.request_id,
        suggested_fix: providerError?.suggested_fix,
      },
      res.status === 401 || res.status === 403 ? 401 : 502,
      res.status >= 500,
    );
  }

  return data as T;
}

export async function fetchComposioTools(env: Env, toolkitSlug: string): Promise<ComposioAction[]> {
  const data = await composioRequest<{ items?: ComposioAction[] }>(
    env,
    `/v3.1/tools?toolkit_slug=${encodeURIComponent(toolkitSlug)}&toolkit_versions=latest&include_deprecated=false&limit=1000`,
  );

  return data.items ?? [];
}

export async function createComposioConnectLink(
  env: Env,
  app: ComposioAppConfig,
  input: { userId: string; callbackUrl?: string; alias?: string },
): Promise<ComposioLinkResponse> {
  if (!app.authConfigId) {
    throw connectorError("not_configured", `No Composio auth config is configured for ${app.name}`, {
      app_key: app.appKey,
      env: "COMPOSIO_AUTH_CONFIGS_JSON",
    });
  }

  return composioRequest<ComposioLinkResponse>(env, "/v3.1/connected_accounts/link", {
    method: "POST",
    body: JSON.stringify({
      auth_config_id: app.authConfigId,
      user_id: input.userId,
      alias: input.alias,
      callback_url: input.callbackUrl,
    }),
  });
}

export async function getComposioConnectedAccount(env: Env, connectedAccountId: string): Promise<ComposioConnectedAccount> {
  return composioRequest<ComposioConnectedAccount>(
    env,
    `/v3.1/connected_accounts/${encodeURIComponent(connectedAccountId)}`,
  );
}

export async function getComposioToolkit(env: Env, toolkitSlug: string): Promise<ComposioToolkit> {
  return composioRequest<ComposioToolkit>(
    env,
    `/v3.1/toolkits/${encodeURIComponent(toolkitSlug)}`,
  );
}

export async function refreshComposioConnectedAccount(
  env: Env,
  connectedAccountId: string,
  redirectUrl?: string,
): Promise<{ id: string; status: string; redirect_url?: string }> {
  return composioRequest<{ id: string; status: string; redirect_url?: string }>(
    env,
    `/v3.1/connected_accounts/${encodeURIComponent(connectedAccountId)}/refresh`,
    {
      method: "POST",
      body: JSON.stringify(redirectUrl ? { redirect_url: redirectUrl } : {}),
    },
  );
}

export async function revokeComposioConnectedAccount(env: Env, connectedAccountId: string): Promise<void> {
  await composioRequest<unknown>(
    env,
    `/v3.1/connected_accounts/${encodeURIComponent(connectedAccountId)}/revoke`,
    { method: "POST", body: "{}" },
  );
}

export function mapComposioStatus(status: string | undefined): "initiated" | "active" | "expired" | "revoked" | "failed" {
  switch ((status ?? "").toUpperCase()) {
    case "ACTIVE":
      return "active";
    case "EXPIRED":
      return "expired";
    case "DISABLED":
    case "REVOKED":
      return "revoked";
    case "FAILED":
    case "ERROR":
      return "failed";
    default:
      return "initiated";
  }
}

export async function executeComposioAction(
  env: Env,
  input: { slug: string; connectedAccountId: string; entityId: string; args?: unknown },
): Promise<unknown> {
  const res = await fetch(`${baseUrl(env)}/v3.1/tools/execute/${encodeURIComponent(input.slug)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey(env),
    },
    body: JSON.stringify({
      connected_account_id: input.connectedAccountId,
      user_id: input.entityId,
      arguments: input.args ?? {},
    }),
  });

  const data = await res.json() as { successful?: boolean; successfull?: boolean; data?: unknown; error?: unknown };
  if (!res.ok || data.successful === false || data.successfull === false) {
    throw connectorError(
      res.status === 401 || res.status === 403 ? "provider_auth_expired" : "provider_error",
      typeof data.error === "string" ? data.error : `Composio returned HTTP ${res.status}`,
      { provider: "composio", slug: input.slug, provider_status: res.status },
      res.status === 401 || res.status === 403 ? 401 : 502,
      res.status >= 500,
    );
  }

  return data.data ?? data;
}
