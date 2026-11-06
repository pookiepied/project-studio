import {
  createHarnessClient,
  resolveHarnessAddress,
  type HarnessClient,
} from '@/platform/harness'

type IconResult = string | null | undefined

const inflight = new Map<string, Promise<IconResult>>()
let clientPromise: Promise<HarnessClient | null> | null = null

export function resetProviderIconRequestsForTests(): void {
  inflight.clear()
  clientPromise = null
}

function getClient(): Promise<HarnessClient | null> {
  clientPromise ??= resolveHarnessAddress()
    .then((address) => address === null ? null : createHarnessClient(address))
    .catch(() => null)
  return clientPromise
}

function toDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

/**
 * Coalesce requests from rows opening together and let the harness own expiry.
 * An unavailable connection leaves the last rendered mark in place, while
 * an explicit miss clears it.
 */
export function resolveProviderIcon(providerId: string): Promise<IconResult> {
  const existing = inflight.get(providerId)
  if (existing !== undefined) return existing

  const work = (async () => {
    const connection = getClient()
    const client = await connection
    if (client === null) {
      if (clientPromise === connection) clientPromise = null
      return undefined
    }
    const result = await client.providerIcon(providerId)
    if (result.ok) return toDataUri(result.value.svg)
    if (result.error.kind === 'harness-error' && result.error.code === 'providers.icons.unknown') return null
    if (clientPromise === connection &&
        (result.error.kind === 'not-reachable' || result.error.kind === 'unauthorized')) {
      clientPromise = null
    }
    return undefined
  })().catch(() => undefined).finally(() => {
    if (inflight.get(providerId) === work) inflight.delete(providerId)
  })
  inflight.set(providerId, work)
  return work
}
