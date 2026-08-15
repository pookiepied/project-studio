const ICON_CACHE_KEY = "studio-gateway-provider-icons-v1"

// Simple Icons supplies monochrome brand marks. Provider IDs that are not in
// this map deliberately fall back to a quiet monogram instead of a made-up logo.
const PROVIDER_SLUGS: Record<string, string> = {
  anthropic: "anthropic",
  alibaba: "alibabadotcom",
  cerebras: "cerebras",
  cohere: "cohere",
  deepseek: "deepseek",
  elevenlabs: "elevenlabs",
  fal: "fal",
  fireworks: "fireworks",
  google: "google",
  groq: "groq",
  huggingface: "huggingface",
  minimax: "minimax",
  mistral: "mistralai",
  moonshot: "moonshot",
  nvidia: "nvidia",
  openai: "openai",
  openrouter: "openrouter",
  perplexity: "perplexity",
  together: "together",
  xai: "x",
  xiaomi: "xiaomi",
  zai: "zai",
}

type IconCache = Record<string, string>

function readCache(): IconCache {
  try {
    const parsed = JSON.parse(localStorage.getItem(ICON_CACHE_KEY) ?? "{}")
    return parsed && typeof parsed === "object" ? parsed as IconCache : {}
  } catch {
    return {}
  }
}

function writeCache(cache: IconCache): void {
  try { localStorage.setItem(ICON_CACHE_KEY, JSON.stringify(cache)) } catch { /* storage is optional */ }
}

export function providerSlug(providerId: string | null | undefined): string | null {
  if (!providerId) return null
  const normalized = providerId.toLowerCase().trim()
  return PROVIDER_SLUGS[normalized] ?? (normalized.replace(/[^a-z0-9]/g, "") || null)
}

export function providerIconUrl(providerId: string | null | undefined): string | null {
  const slug = providerSlug(providerId)
  return slug ? `https://cdn.simpleicons.org/${encodeURIComponent(slug)}` : null
}

export function cachedProviderIcon(providerId: string | null | undefined): string | null {
  const slug = providerSlug(providerId)
  return slug ? readCache()[slug] ?? null : null
}

export async function cacheProviderIcon(providerId: string | null | undefined): Promise<string | null> {
  const slug = providerSlug(providerId)
  const url = providerIconUrl(providerId)
  if (!slug || !url) return null
  const existing = readCache()[slug]
  if (existing) return existing
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const svg = await response.text()
    if (!svg.includes("<svg")) return null
    const dataUri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    const cache = readCache()
    cache[slug] = dataUri
    writeCache(cache)
    return dataUri
  } catch {
    return null
  }
}
