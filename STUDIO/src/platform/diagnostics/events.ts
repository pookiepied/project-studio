import { newUuid } from '@/lib/id'

export const CLIENT_OBSERVATION_NAMES = [
  'client.request', 'client.submission', 'client.stream', 'client.delivery',
  'client.projection', 'client.display', 'client.window',
] as const
export type ClientObservationName = (typeof CLIENT_OBSERVATION_NAMES)[number]
export const CLIENT_ATTRIBUTE_KEYS = [
  'method', 'status', 'durationMs', 'timedOut', 'stage', 'failure', 'characters',
  'settlement', 'kind', 'replaying', 'stopped', 'failed', 'streaming', 'count',
] as const
type ClientAttributeKey = (typeof CLIENT_ATTRIBUTE_KEYS)[number]
type ClientAttributes = Readonly<Partial<Record<ClientAttributeKey, string | number | boolean | null>>>

export interface ClientObservationIdentity {
  readonly requestId?: string
  readonly operationId?: string
  readonly conversationId?: string
  readonly submissionId?: string
  readonly streamId?: string
  readonly messageId?: string
  readonly blockId?: string
}
export interface ClientObservation {
  readonly v: 1
  readonly eventId: string
  readonly bootId: string
  readonly sequence: number
  readonly timestamp: string
  readonly monotonicMs: number
  readonly name: ClientObservationName
  readonly phase: 'start' | 'progress' | 'end'
  readonly outcome?: 'completed' | 'failed' | 'cancelled' | 'unknown'
  readonly identity: ClientObservationIdentity
  /** Deliberately no content surface: the harness owns conversation capture. */
  readonly attributes: ClientAttributes
}
export interface ClientObservationInput {
  readonly name: ClientObservationName
  readonly phase: ClientObservation['phase']
  readonly outcome?: ClientObservation['outcome']
  readonly identity?: ClientObservationIdentity
  readonly attributes?: ClientObservation['attributes']
}

/** One window's passive operational recorder, controlled by the host capture epoch. */
export class ClientObservationBuffer {
  #captureId: string | null = null
  #bootId: string | null = null
  #sequence = 0
  #dropped = 0
  #events: ClientObservation[] = []

  get enabled(): boolean { return this.#captureId !== null }
  get dropped(): number { return this.#dropped }

  configure(captureId: string | null): void {
    if (this.#captureId !== captureId) this.#events = []
    this.#captureId = captureId
  }

  record(input: ClientObservationInput): void {
    if (!this.enabled) return
    try {
      this.#bootId ??= newUuid()
      const identity: Partial<Record<keyof ClientObservationIdentity, string>> = {}
      for (const key of ['requestId', 'operationId', 'conversationId', 'submissionId', 'streamId', 'messageId', 'blockId'] as const) {
        const descriptor = input.identity && Object.getOwnPropertyDescriptor(input.identity, key)
        if (descriptor && 'value' in descriptor && typeof descriptor.value === 'string') identity[key] = descriptor.value.slice(0, 256)
      }
      const attributes: Partial<Record<ClientAttributeKey, string | number | boolean | null>> = {}
      for (const key of CLIENT_ATTRIBUTE_KEYS) {
        const descriptor = input.attributes && Object.getOwnPropertyDescriptor(input.attributes, key)
        const value: unknown = descriptor && 'value' in descriptor ? descriptor.value : undefined
        if (typeof value === 'string') attributes[key] = value.slice(0, 160)
        else if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) attributes[key] = value
      }
      // Feature authors provide bounded primitive metadata, never a body or result.
      const event: ClientObservation = {
        v: 1, eventId: newUuid(), bootId: this.#bootId, sequence: ++this.#sequence,
        timestamp: new Date().toISOString(), monotonicMs: performance.now(),
        name: input.name, phase: input.phase,
        ...(input.outcome === undefined ? {} : { outcome: input.outcome }),
        identity, attributes,
      }
      if (JSON.stringify(event).length > 4096) { this.#dropped++; return }
      this.#events.push(event)
      if (this.#events.length > 200) { this.#events.shift(); this.#dropped++ }
    } catch { this.#dropped++ }
  }

  take(limit = 50): { captureId: string; events: readonly ClientObservation[]; dropped: number } | null {
    if (this.#captureId === null || this.#events.length === 0) return null
    const events = this.#events.splice(0, Math.max(1, Math.min(50, limit)))
    return { captureId: this.#captureId, events, dropped: this.#dropped }
  }

  discard(count: number): void { this.#dropped += count }
}

export const clientObservations = new ClientObservationBuffer()
export function recordClientObservation(input: ClientObservationInput): void {
  clientObservations.record(input)
}
