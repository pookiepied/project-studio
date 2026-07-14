/**
 * Cloudflare AI Gateway — URL builder
 *
 * When CF_AI_GATEWAY_ACCOUNT_ID + CF_AI_GATEWAY_NAME are set in the Worker
 * environment, all supported provider calls are automatically routed through
 * the gateway instead of calling providers directly.
 *
 * Benefits (zero application-logic change):
 *   - Request / response logging in Cloudflare dashboard
 *   - Exact + semantic caching
 *   - Per-provider analytics and cost tracking
 *   - Rate-limiting controls
 *   - Fallback routing (configurable in dashboard)
 *
 * Docs:     https://developers.cloudflare.com/ai-gateway/
 * Setup:    Workers & Pages → AI Gateway → Create gateway
 *           Then: wrangler secret put CF_AI_GATEWAY_ACCOUNT_ID
 *                 wrangler secret put CF_AI_GATEWAY_NAME
 *
 * Providers NOT routed through gateway (called directly regardless of config):
 *   - ollama / lmstudio  — local inference, not internet-accessible
 *   - alibaba            — not in Cloudflare AI Gateway's provider list
 *   - minimax            — not in Cloudflare AI Gateway's provider list
 *   - cerebras           — not in Cloudflare AI Gateway's provider list
 *   - cohere             — uses OpenAI-compat layer; native gateway routing differs
 */

const GATEWAY_BASE = "https://gateway.ai.cloudflare.com/v1";

/**
 * Maps our internal provider names to Cloudflare AI Gateway provider slugs.
 * Providers absent from this map are called directly.
 *
 * Reference: https://developers.cloudflare.com/ai-gateway/providers/
 */
const GATEWAY_SLUGS: Record<string, string> = {
  anthropic:  "anthropic",
  openai:     "openai",
  google:     "google-ai-studio",
  groq:       "groq",
  mistral:    "mistral",
  xai:        "grok",       // xAI's gateway slug is "grok" (product name)
  deepseek:   "deepseek",
  openrouter: "openrouter",
  perplexity: "perplexity",
};

/**
 * Returns the Cloudflare AI Gateway base URL for a given provider,
 * or `null` if the provider is not gateway-compatible.
 *
 * The returned URL is a drop-in replacement for the provider's native base URL:
 *
 *   createAnthropic({ baseURL: buildGatewayUrl("anthropic", accountId, name) ?? undefined })
 *
 * The SDK then appends its normal paths (e.g. `/messages`, `/chat/completions`)
 * and the gateway proxies the full request to the real provider.
 */
export function buildGatewayUrl(
  provider:    string,
  accountId:   string,
  gatewayName: string,
): string | null {
  const slug = GATEWAY_SLUGS[provider];
  if (!slug) return null;
  return `${GATEWAY_BASE}/${accountId}/${gatewayName}/${slug}`;
}

/**
 * Returns the authentication header required when the gateway has
 * "Authenticated gateway" enabled.
 *
 * Usage:
 *   createGroq({ apiKey, baseURL: gatewayUrl, headers: buildGatewayHeaders(token) })
 *
 * Returns `undefined` when no token is configured (unauthenticated gateway).
 */
export function buildGatewayHeaders(
  token?: string,
): Record<string, string> | undefined {
  if (!token) return undefined;
  return { "cf-aig-authorization": `Bearer ${token}` };
}
