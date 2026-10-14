import type { TurnImageWire } from '../conversation'
import { isRecord } from '@/lib/guards'

export interface QueuedMessage {
  readonly submissionId: string
  readonly text: string
  readonly images: readonly TurnImageWire[]
}

export function parseQueuedMessages(value: unknown): readonly QueuedMessage[] | null {
  if (!Array.isArray(value)) return null
  const input: readonly unknown[] = value
  const messages: QueuedMessage[] = []
  for (const item of input) {
    if (!isRecord(item) || typeof item['submissionId'] !== 'string' || typeof item['text'] !== 'string' || !Array.isArray(item['images'])) return null
    const carried: readonly unknown[] = item['images']
    const images: TurnImageWire[] = []
    for (const image of carried) {
      if (!isRecord(image) || image['type'] !== 'image' || typeof image['data'] !== 'string' || typeof image['mimeType'] !== 'string') return null
      const filename = image['filename']
      if (filename !== undefined && typeof filename !== 'string') return null
      images.push({ type: 'image', data: image['data'], mimeType: image['mimeType'], ...(filename === undefined ? {} : { filename }) })
    }
    messages.push({ submissionId: item['submissionId'], text: item['text'], images })
  }
  return messages
}

export function parseQueuedMessage(value: unknown): QueuedMessage | null {
  return parseQueuedMessages([value])?.[0] ?? null
}
