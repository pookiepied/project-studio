import { galleryConversation } from '@/domain/session/gallery'
import type { Message } from '@/domain/session/types'
import type { TranscriptItem } from '@/features/chat/transcript/projection'

/**
 * The artifact gallery, as the live transcript draws it.
 *
 * The gallery used to have a renderer of its own -- a second `Transcript`,
 * a second user bubble, a second assistant row -- because it was seeded from
 * a local record rather than projected from a stream. Two renderers for one
 * column is how the gallery stops being a fixture: whatever it showed was
 * proof about the demo stack, not about the components a real reply lands
 * in. So the gallery's messages become the same `TranscriptItem`s a harness
 * conversation projects, and the live components draw them.
 *
 * Every item is settled: the gallery is a display of finished artifacts, not
 * a conversation with an agent, and nothing in it is being written. The
 * reasoning segment carries no span, because a span is a measurement of
 * deltas that landed and none ever did here; the block says "Thought", which
 * is what is true.
 */
export function galleryItems(): readonly TranscriptItem[] {
  return galleryConversation().messages.map(itemOf)
}

function itemOf(message: Message): TranscriptItem {
  if (message.role === 'user') {
    return {
      kind: 'user',
      id: message.id,
      submissionId: null,
      text: message.text,
      attachments: [],
      timestamp: null,
    }
  }
  return {
    kind: 'assistant',
    id: message.id,
    submissionId: null,
    model: null,
    segments: [
      ...(message.thinking
        ? [
            {
              kind: 'thinking' as const,
              id: `${message.id}#thinking`,
              text: message.thinking.text,
              startedAt: null,
              updatedAt: null,
            },
          ]
        : []),
      { kind: 'text' as const, id: `${message.id}#text`, text: message.text },
    ],
    end: { state: 'complete' },
    usage: null,
  }
}
