import { DEFAULT_PERMISSION_MODE } from '@/domain/permissions/modes'
import type { Conversation } from '@/domain/conversation/types'

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
 * you the artifacts, not ask you to run something first. It takes no
 * messages -- there is no harness behind it and nothing could answer -- so
 * the page draws it with no composer, through the same components a real
 * reply lands in. What it shows lives beside the page that shows it,
 * `features/chat/gallery`; this record is the identity the sidebar lists.
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
    // Not a conversation the harness holds, so the mode is the window's
    // default. It is never sent anywhere: the gallery takes no messages.
    permissionMode: DEFAULT_PERMISSION_MODE,
  }
}
