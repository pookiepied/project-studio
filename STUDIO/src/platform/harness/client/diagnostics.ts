import { isRecord } from '@/lib/guards'
import type { HarnessResult, Requester } from './request'

/** Wire mirror of the harness's version 1 diagnostic control contract. */
export interface DiagnosticPolicy {
  readonly enabled: boolean
  readonly captureContent: boolean
  readonly conversations: readonly string[]
  readonly maxEvents: number
  readonly maxBytes: number
  readonly maxEventBytes: number
}
export interface DiagnosticHealth {
  readonly bootId: string
  readonly captureId: string
  readonly policy: DiagnosticPolicy
  readonly latestSequence: number
  readonly retainedEvents: number
  readonly retainedBytes: number
  readonly evictedEvents: number
  readonly droppedEvents: number
}
export interface DiagnosticPage {
  readonly events: readonly Readonly<Record<string, unknown>>[]
  readonly nextSequence: number
  readonly gap: boolean
  readonly health: DiagnosticHealth
}
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

export function parseDiagnosticHealth(value: unknown): DiagnosticHealth | null {
  if (!isRecord(value) || typeof value.bootId !== 'string' || typeof value.captureId !== 'string' || !isRecord(value.policy)) return null
  const policy = value.policy
  if (typeof policy.enabled !== 'boolean' || typeof policy.captureContent !== 'boolean' ||
    !Array.isArray(policy.conversations) || !policy.conversations.every((id) => typeof id === 'string') ||
    !count(policy.maxEvents) || !count(policy.maxBytes) || !count(policy.maxEventBytes) ||
    !count(value.latestSequence) || !count(value.retainedEvents) || !count(value.retainedBytes) ||
    !count(value.evictedEvents) || !count(value.droppedEvents)) return null
  return {
    bootId: value.bootId, captureId: value.captureId, latestSequence: value.latestSequence, retainedEvents: value.retainedEvents,
    retainedBytes: value.retainedBytes, evictedEvents: value.evictedEvents, droppedEvents: value.droppedEvents,
    policy: { enabled: policy.enabled, captureContent: policy.captureContent, conversations: policy.conversations,
      maxEvents: policy.maxEvents, maxBytes: policy.maxBytes, maxEventBytes: policy.maxEventBytes },
  }
}

function parsePage(value: unknown): DiagnosticPage | null {
  if (!isRecord(value) || !Array.isArray(value.events) || value.events.length > 500 ||
    !value.events.every((event) => isRecord(event) && event.v === 1 && typeof event.eventId === 'string' && count(event.sequence)) ||
    !count(value.nextSequence) || typeof value.gap !== 'boolean') return null
  const health = parseDiagnosticHealth(value.health)
  return health === null ? null : { events: value.events, nextSequence: value.nextSequence, gap: value.gap, health }
}

export interface DiagnosticClient {
  getDiagnostics(): Promise<HarnessResult<DiagnosticHealth>>
  configureDiagnostics(policy: Partial<DiagnosticPolicy>, expectedCaptureId?: string): Promise<HarnessResult<DiagnosticHealth>>
  readDiagnostics(after: number, bootId: string): Promise<HarnessResult<DiagnosticPage>>
  clearDiagnostics(): Promise<HarnessResult<void>>
}
export function diagnosticClient(request: Requester): DiagnosticClient {
  return {
    getDiagnostics: () => request.json('GET', '/api/diagnostics', undefined, parseDiagnosticHealth),
    configureDiagnostics: (policy, expectedCaptureId) => request.json('PUT', '/api/diagnostics/policy',
      { ...policy, ...(expectedCaptureId === undefined ? {} : { expectedCaptureId }) }, parseDiagnosticHealth),
    readDiagnostics: (after, bootId) => request.json('GET', `/api/diagnostics/events?limit=500&after=${after}&bootId=${encodeURIComponent(bootId)}`, undefined, parsePage),
    clearDiagnostics: () => request.empty('DELETE', '/api/diagnostics/events'),
  }
}
