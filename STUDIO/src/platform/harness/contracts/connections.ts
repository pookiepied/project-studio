/**
 * A provider connection as the harness stores it - never with its key - and
 * the probe that tells whether it answers.
 */

import { isRecord } from '@/lib/guards'
import { CREDENTIAL_STATUSES, type ConnectionServes, type CredentialStatus, type LanguageProtocol, type MediaProtocol, PROVIDER_SOURCES, type ProviderSource, type RetrievalProtocol, parseConnectionServes } from './picklists'
import { finiteNumber, flag, listOf, oneOf, optionalText, text } from './guards'

/**
 * `providerConnectionSchema`.
 *
 * Fields are readonly here even though the harness's inferred types are not:
 * on this side a parsed connection is a value that came off the wire, and
 * nothing in the UI has any business writing to it.
 */
export interface ProviderConnection {
  /** Slug-shaped and stable: lowercase, digits, single hyphens. */
  readonly id: string
  readonly displayName: string
  readonly source: ProviderSource
  readonly baseUrl?: string
  readonly enabled: boolean
  /**
   * The vendor whose built-in model list applies, if the catalog knows it.
   * Deliberately not the same field as `id`: `id` is the user's name for this
   * connection, so two OpenAI accounts can coexist. Absent means a vendor the
   * catalog has never heard of — the normal case for a self-hosted endpoint.
   */
  readonly catalogProvider?: string
  /** Whether a key exists. Never the key. */
  readonly credential: CredentialStatus
  readonly serves: ConnectionServes
}

/**
 * A connection as the caller supplies it: everything but `credential`, plus an
 * optional key that exists for exactly the length of one request. `apiKey` is
 * the only place in this entire module where a secret appears, and it appears
 * only on the way out.
 */
export type ProviderConnectionDraft = Omit<ProviderConnection, 'credential'> & {
  readonly apiKey?: string
}

/**
 * What one patch may say about the kinds a connection serves: a protocol
 * adds or re-wires the kind, `null` removes it, absent leaves it alone.
 */
export interface ConnectionServesPatch {
  readonly language?: LanguageProtocol | null
  readonly media?: MediaProtocol | null
  readonly retrieval?: RetrievalProtocol | null
}

/**
 * `ProviderConnectionPatch`. `id` is absent on purpose: changing it makes a
 * different connection while models, defaults and stored credentials still
 * point at the old one. The kinds served may change, because a key that
 * served chat yesterday serves images today without becoming a different
 * account.
 *
 * `baseUrl: null` clears the override; `baseUrl` absent leaves it alone. The
 * distinction is load-bearing — without the explicit clear, a base URL once
 * set could only be reassigned, never returned to the protocol default.
 */
export interface ProviderConnectionPatch {
  readonly displayName?: string
  readonly baseUrl?: string | null
  readonly enabled?: boolean
  readonly serves?: ConnectionServesPatch
  readonly apiKey?: string
}

/**
 * `probeResultSchema`. `ok` is the bit the UI branches on.
 *
 * `modelCount` is present only when the probe could enumerate and `failure`
 * only when it could not — never both as a substitute, so an unreachable
 * provider is never misread as "zero models". `status` is absent when the
 * attempt never produced an HTTP response (DNS refusal, timeout) and
 * `latencyMs` is absent when it never left the process.
 */
export interface ProbeResult {
  readonly ok: boolean
  readonly reachedAt: number
  readonly modelCount?: number
  readonly failure?: string
  readonly status?: number
  readonly latencyMs?: number
}

export function parseProviderConnection(value: unknown): ProviderConnection | null {
  if (!isRecord(value)) return null

  const id = text(value['id'])
  const displayName = text(value['displayName'])
  const source = oneOf(PROVIDER_SOURCES, value['source'])
  const enabled = flag(value['enabled'])
  const credential = oneOf(CREDENTIAL_STATUSES, value['credential'])
  const baseUrl = optionalText(value['baseUrl'])
  const catalogProvider = optionalText(value['catalogProvider'])

  if (
    id === null ||
    displayName === null ||
    source === null ||
    enabled === null ||
    credential === null ||
    !baseUrl.ok ||
    !catalogProvider.ok
  ) {
    return null
  }

  // Rebuilt field by field, never spread from the response. This is what makes
  // an `apiKey` in the body unable to reach a parsed connection.
  const base = {
    id,
    displayName,
    source,
    enabled,
    credential,
    ...(baseUrl.value === undefined ? {} : { baseUrl: baseUrl.value }),
    ...(catalogProvider.value === undefined
      ? {}
      : { catalogProvider: catalogProvider.value }),
  }

  const serves = parseConnectionServes(value['serves'])
  return serves === null ? null : { ...base, serves }
}

export function parseProviderConnections(
  value: unknown,
): readonly ProviderConnection[] | null {
  return listOf(parseProviderConnection, value)
}

export function parseProbeResult(value: unknown): ProbeResult | null {
  if (!isRecord(value)) return null

  const ok = flag(value['ok'])
  const reachedAt = finiteNumber(value['reachedAt'])
  if (ok === null || reachedAt === null) return null

  const rawModelCount = value['modelCount']
  const rawStatus = value['status']
  const rawLatency = value['latencyMs']

  const modelCount = rawModelCount === undefined ? undefined : finiteNumber(rawModelCount)
  const status = rawStatus === undefined ? undefined : finiteNumber(rawStatus)
  const latencyMs = rawLatency === undefined ? undefined : finiteNumber(rawLatency)
  const failure = optionalText(value['failure'])

  if (modelCount === null || status === null || latencyMs === null || !failure.ok) return null

  return {
    ok,
    reachedAt,
    ...(modelCount === undefined ? {} : { modelCount }),
    ...(failure.value === undefined ? {} : { failure: failure.value }),
    ...(status === undefined ? {} : { status }),
    ...(latencyMs === undefined ? {} : { latencyMs }),
  }
}
