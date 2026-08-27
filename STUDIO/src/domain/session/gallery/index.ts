import { SCENE_DONE, renderScene } from '@/domain/session/gallery/scene'
import type { Conversation } from '@/domain/session/types'

/**
 * The gallery conversation.
 *
 * One place where every artifact the app can draw is visible at once, in its
 * finished state, without having to provoke a tool into producing one. It is
 * the fixture the renderers are judged against and the fastest way to see
 * whether a change to the shell broke something three kinds away from the one
 * being worked on.
 *
 * It is seeded finished rather than empty on purpose: opening it should *show*
 * you the artifacts, not ask you to run something first. Sending anything in
 * it replays the whole sequence from the beginning — see `useGalleryTurn` —
 * so the working states are one keystroke away without being the default.
 */
export const GALLERY_CONVERSATION_ID = 'cnv_gallery'

export function galleryConversation(): Conversation {
  return {
    id: GALLERY_CONVERSATION_ID,
    title: 'Everything Studio can show',
    projectId: null,
    // Pinned, because a fixture you have to scroll to find stops being used.
    pinned: true,
    archived: false,
    updatedAt: Date.now() - 5 * 60 * 1000,
    modelId: null,
    reasoningLevel: null,
    messages: [
      {
        id: 'msg_gallery_user',
        role: 'user',
        text: 'Show me every kind of artifact you can render, and let me watch them resolve.',
        createdAt: Date.now() - 6 * 60 * 1000,
      },
      {
        id: 'msg_gallery_assistant',
        role: 'assistant',
        text: renderScene(SCENE_DONE),
        createdAt: Date.now() - 5 * 60 * 1000,
        thinking: {
          text: 'Six kinds, three with dedicated renderers and three without, so the fallback is on show too. Overlap a couple of them so the working states are visible together.',
          seconds: 3.1,
        },
      },
    ],
  }
}
