import {
  createHarnessClient,
  resolveHarnessAddress,
  type HarnessClient,
} from '@/platform/harness'

/**
 * Real provider icons for the drawn marks, resolved once per session.
 *
 * The harness keeps the on-disk cache and does the models.dev lookup; this
 * module is the webview's window onto it. Three layers of remembering, in
 * order of cheapness: this module's map (one process lifetime), the
 * harness's disk cache (one machine, across sessions), and models.dev itself
 * (refetched by the harness after a TTL).
 *
 * `null` is a real answer here - "no real icon is known" - and it is cached
 * exactly like a success, because a row of two hundred models must not
 * re-ask for the vendors that have no logo on every render. The drawn mark
 * in `ProviderMark` is what renders while a lookup is in flight and forever
 * after a `null`.
 */

const cache = new Map<string, string | null>()
const inflight = new Map<string, Promise<string | null>>()
let clientPromise: Promise<HarnessClient | null> | null = null

/**
 * Forgets every remembered answer and the resolved client with it.
 *
 * A test seam, exported deliberately: the cache is module state exactly so a
 * picker re-rendering two hundred rows asks the harness once, which is also
 * why a test that rendered one vendor without a harness must not decide what
 * the next test sees.
 */
export function resetProviderIconCacheForTests(): void {
  cache.clear()
  inflight.clear()
  clientPromise = null
}

async function getClient(): Promise<HarnessClient | null> {
  clientPromise ??= (async () => {
    const address = await resolveHarnessAddress()
    return address === null ? null : createHarnessClient(address)
  })()
  return clientPromise
}

function toDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

/**
 * The real icon for one vendor id, as a data URI, or null when there is
 * none. Safe to call per render: the answer is remembered and concurrent
 * calls share one request.
 */
export function resolveProviderIcon(providerId: string): Promise<string | null> {
  if (cache.has(providerId)) {
    return Promise.resolve(cache.get(providerId) ?? null)
  }

  const existing = inflight.get(providerId)
  if (existing !== undefined) return existing

  const work = (async () => {
    const client = await getClient()
    if (client === null) {
      cache.set(providerId, null)
      return null
    }
    const result = await client.providerIcon(providerId)
    // A missing icon is a 404 the harness wrote on purpose; both it and a
    // malformed answer resolve to "draw the fallback".
    const uri = result.ok ? toDataUri(result.value.svg) : null
    cache.set(providerId, uri)
    return uri
  })()
  inflight.set(providerId, work)
  void work.finally(() => inflight.delete(providerId))
  return work
}
