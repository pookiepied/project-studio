/**
 * Chat-worker provider barrel.
 *
 * Physical implementation lives in gateway/src/providers/ — that worker can use
 * providers without pulling in any chat-specific code. This barrel re-exports
 * everything and wraps createProvider() so all existing chat callers keep their
 * import paths unchanged.
 *
 * When env.GATEWAY is bound (production), every LLM call is routed through the
 * studio-gateway service binding via GatewayAdapter — API keys live exclusively
 * in studio-gateway's env. When the binding is absent (local dev) the adapter
 * is constructed directly using whatever keys are in the local env.
 */

export type { ProviderAdapter }                    from "@gateway/providers";
export { BaseAdapter, PROVIDER_URLS, getApiKey }   from "@gateway/providers";

import { createProvider as _createProvider }       from "@gateway/providers";
import type { GatewayEnv }                         from "../../gatewayEnv";
import type { ProviderAdapter }                    from "@gateway/providers";
import { getRequestEnv }                           from "../../context";
import { emit }                                    from "../../tracking";
import { GatewayAdapter }                          from "./gatewayAdapter";

export function createProvider(
  provider: string,
  apiKey:   string,
  baseUrl?: string,
  env?:     GatewayEnv,
  userId?:  string,
): ProviderAdapter {
  const reqEnv = getRequestEnv();
  const gateway = reqEnv?.GATEWAY;

  // Production path — route through studio-gateway service binding.
  // API keys live only in gateway's env; chat never needs them directly.
  if (gateway && reqEnv) {
    const adapter = new GatewayAdapter(
      gateway,
      provider,
      userId,
      apiKey || undefined,  // pass user-supplied key; omit if empty so gateway uses its env key
    );
    adapter.withErrorReporter((httpStatus, message, model) => {
      emit(reqEnv, undefined, {
        event:    "provider.error",
        severity: "error",
        data: { provider, httpStatus, errorMessage: message.slice(0, 500), model },
      });
    });
    return adapter;
  }

  // Local dev fallback — direct adapter without service binding.
  const adapter = _createProvider(provider, apiKey, baseUrl, env);
  adapter.withErrorReporter((httpStatus, message, model) => {
    const re = getRequestEnv();
    if (!re) return;
    emit(re, undefined, {
      event:    "provider.error",
      severity: "error",
      data: { provider, httpStatus, errorMessage: message.slice(0, 500), model },
    });
  });
  return adapter;
}
