import { GALLERY_CONVERSATION_ID } from '@/domain/conversation/gallery'
import { SCENE_DONE, renderScene } from '@/features/chat/gallery/scene'
import type { TranscriptItem } from '@/features/chat/transcript/projection'

/**
 * The artifact gallery, as the live transcript draws it.
 *
 * The gallery used to have a renderer of its own -- a second `Transcript`,
 * a second user bubble, a second assistant row -- because it was seeded from
 * a local record rather than projected from a stream. Two renderers for one
 * column is how the gallery stops being a fixture: whatever it showed was
 * proof about the demo stack, not about the components a real reply lands
 * in. So the gallery is the same `TranscriptItem`s a harness conversation
 * projects, and the live components draw them.
 *
 * Every item is settled: the gallery is a display of finished artifacts, not
 * a conversation with an agent, and nothing in it is being written. The
 * reasoning segment carries no span, because a span is a measurement of
 * deltas that landed and none ever did here; the block says "Thought", which
 * is what is true.
 */
export function galleryItems(): readonly TranscriptItem[] {
  const reply = `${GALLERY_CONVERSATION_ID}_reply`
  return [
    {
      kind: 'user',
      id: `${GALLERY_CONVERSATION_ID}_ask`,
      submissionId: null,
      text: 'Show me every kind of artifact you can render, and let me watch them resolve.',
      attachments: [],
      documents: [],
      timestamp: null,
    },
    {
      kind: 'assistant',
      id: reply,
      submissionId: null,
      model: null,
      segments: [
        {
          kind: 'thinking',
          id: `${reply}#thinking`,
          text: 'Six kinds, three with dedicated renderers and three without, so the fallback is on show too. Overlap a couple of them so the working states are visible together.',
          startedAt: null,
          updatedAt: null,
        },
        { kind: 'text', id: `${reply}#text`, text: renderScene(SCENE_DONE) },
      ],
      end: { state: 'complete' },
      usage: null,
    },
  ]
}
