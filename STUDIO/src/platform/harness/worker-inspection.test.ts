import { describe, expect, it } from 'vitest'
import { createConversationClient, type ServiceInvoke } from './conversation'
import { clientObservations } from '@/platform/diagnostics/events'

describe('worker inspection identity', () => {
  it('reads the real worker instance while retaining its product conversation scope', async () => {
    const calls: { command: string; args: Record<string, unknown> | undefined }[] = []
    const invoke: ServiceInvoke = async (command, args) => {
      calls.push({ command, args })
      return { status: 404, body: '', headers: [] }
    }
    clientObservations.configure('inspection-test')
    try {
      const client = createConversationClient({ conversationId: 'worker-instance', agentName: 'voice-work', observationConversationId: 'parent-conversation', invoke })
      const read = client.attach({ onEvent: () => undefined })
      expect(await read.settled).toEqual({ outcome: 'absent' })
      await read.cancel()
      expect(calls).toHaveLength(1)
      expect(calls[0]?.args?.path).toBe('/agents/voice-work/worker-instance?view=history')
      expect(calls[0]?.args?.init).toMatchObject({ method: 'GET' })
      const events = clientObservations.take()?.events ?? []
      expect(events.length).toBeGreaterThan(0)
      expect(events.every((event) => event.identity.conversationId === 'parent-conversation')).toBe(true)
      expect(JSON.stringify(events)).not.toContain('worker-instance')
    } finally { clientObservations.configure(null) }
  })
})
