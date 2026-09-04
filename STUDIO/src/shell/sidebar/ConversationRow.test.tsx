/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConversationRow } from './ConversationRow'
import type { Conversation } from '@/domain/session/types'

/**
 * One conversation in the sidebar.
 *
 * Two things here are invisible in a diff and silent when they break, which is
 * why they are pinned rather than trusted.
 *
 * The first is the trailing slot. It holds the activity mark or the archive
 * button and never both, so a conversation that is working must not offer
 * archive under the pointer that is watching it finish. Nothing about that
 * shows up in a type error: swap the branches and the row still renders, still
 * has a button in the corner, and quietly archives the one conversation a
 * person was waiting on.
 *
 * The second is right-click. The row claims the gesture, and it can only do so
 * by stopping the event before it reaches the document listener `ActionsMenu`
 * hangs there. That depends on React attaching its handlers at the root
 * container rather than at the document -- true today, and exactly the kind of
 * thing that changes underneath an app without anyone editing this file. The
 * document listener below stands in for `ActionsMenu`: if it ever fires, two
 * menus open at once on a real screen.
 */

const CONVERSATION: Conversation = {
  id: 'cnv_1',
  title: 'A conversation being read',
  projectId: null,
  messages: [],
  updatedAt: 2_000,
  pinned: false,
  archived: false,
  modelId: null,
  reasoningLevel: null,
  permissionMode: 'manual',
}

const TITLE = CONVERSATION.title ?? ''
const ARCHIVE = `Archive ${TITLE}`

const goHome = vi.fn()
const openChat = vi.fn()
const navigation = {
  route: { kind: 'home' } as { kind: string; conversationId?: string },
  openChat,
  goHome,
}

vi.mock('@/stores/navigation', () => ({ useNavigation: () => navigation }))

const setArchived = vi.fn()
const remove = vi.fn()
const togglePin = vi.fn()
const rename = vi.fn()
const running = new Set<string>()

vi.mock('@/stores/workspace', () => ({
  useWorkspace: () => ({ rename, togglePin, setArchived, remove, running }),
  useDetachConversation: () => vi.fn(),
}))

vi.mock('@/features/chat/fork', () => ({
  useForkConversation: () => ({ forkWhole: vi.fn() }),
}))

beforeEach(() => {
  navigation.route = { kind: 'home' }
  running.clear()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('the trailing slot', () => {
  it('offers archive while the conversation is idle', () => {
    render(<ConversationRow conversation={CONVERSATION} />)
    expect(screen.getByRole('button', { name: ARCHIVE })).toBeTruthy()
  })

  it('withholds archive while the conversation is working', () => {
    running.add(CONVERSATION.id)
    render(<ConversationRow conversation={CONVERSATION} />)

    // The mark has the slot, so there is no archive to press. This is the
    // whole point of the swap: the row a person is watching finish is the one
    // row where a stray click must not file it away.
    expect(screen.queryByRole('button', { name: ARCHIVE })).toBeNull()
    // And the row is still a row: the title is still the way in.
    expect(screen.getByRole('button', { name: TITLE })).toBeTruthy()
  })
})

describe('archiving from the row', () => {
  it('archives the conversation it belongs to', () => {
    render(<ConversationRow conversation={CONVERSATION} />)
    fireEvent.click(screen.getByRole('button', { name: ARCHIVE }))

    expect(setArchived).toHaveBeenCalledWith(CONVERSATION.id, true)
    // Not the conversation being read, so nothing about where the reader is
    // may change. Navigating here would move someone away from the page they
    // were on because they tidied a different row.
    expect(goHome).not.toHaveBeenCalled()
  })

  it('leaves the conversation it was reading', () => {
    navigation.route = { kind: 'chat', conversationId: CONVERSATION.id }
    render(<ConversationRow conversation={CONVERSATION} />)
    fireEvent.click(screen.getByRole('button', { name: ARCHIVE }))

    // Archiving the open conversation empties the page behind it, so the row
    // sends the reader home rather than leaving them on a record that is no
    // longer in the list they came from.
    expect(setArchived).toHaveBeenCalledWith(CONVERSATION.id, true)
    expect(goHome).toHaveBeenCalledTimes(1)
  })

  it('does not open the conversation on the way past', () => {
    render(<ConversationRow conversation={CONVERSATION} />)
    fireEvent.click(screen.getByRole('button', { name: ARCHIVE }))

    // The archive control sits inside the row whose title opens the chat. If
    // the click ever reached that button too, archiving would open the thing
    // it just archived.
    expect(openChat).not.toHaveBeenCalled()
  })
})

describe('the right-click menu', () => {
  it('opens the conversation menu on the row', () => {
    render(<ConversationRow conversation={CONVERSATION} />)
    fireEvent.contextMenu(screen.getByRole('button', { name: TITLE }))

    // The verbs that are about the conversation as a record, which is the
    // whole reason the row no longer carries an options button.
    for (const verb of ['Fork', 'Pin to top', 'Rename', 'Open in new window', 'Archive', 'Delete']) {
      expect(screen.getByText(verb)).toBeTruthy()
    }
  })

  it('keeps the app-wide actions menu from opening beside it', () => {
    // Standing in for `ActionsMenu`, which listens on the document in the
    // bubble phase exactly like this.
    const appMenu = vi.fn()
    document.addEventListener('contextmenu', appMenu)
    try {
      render(<ConversationRow conversation={CONVERSATION} />)
      fireEvent.contextMenu(screen.getByRole('button', { name: TITLE }))

      // React handles this at the root container, which the event reaches
      // before the document. If that ever stops being true, two menus open.
      expect(appMenu).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('contextmenu', appMenu)
    }
  })

  it('suppresses the webview menu it is replacing', () => {
    render(<ConversationRow conversation={CONVERSATION} />)
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    screen.getByRole('button', { name: TITLE }).dispatchEvent(event)

    // The row's menu is the replacement, so the native one must not arrive
    // under it. `suppressWebviewChrome` cannot do this job here: its listener
    // is on the document, and the row stops the event before it gets there.
    expect(event.defaultPrevented).toBe(true)
  })

  it('archives through the same path as the row button', () => {
    render(<ConversationRow conversation={CONVERSATION} />)
    fireEvent.contextMenu(screen.getByRole('button', { name: TITLE }))
    fireEvent.click(screen.getByText('Archive'))

    expect(setArchived).toHaveBeenCalledWith(CONVERSATION.id, true)
  })

  it('is reachable while the conversation is working', () => {
    running.add(CONVERSATION.id)
    render(<ConversationRow conversation={CONVERSATION} />)
    fireEvent.contextMenu(screen.getByRole('button', { name: TITLE }))

    // The slot is held by the mark, so the menu is the only way to any of
    // these verbs on a working row -- including archiving it deliberately,
    // which is different from archiving it by brushing past the corner.
    expect(screen.getByText('Archive')).toBeTruthy()
    expect(screen.getByText('Delete')).toBeTruthy()
  })
})

describe('deleting from the row', () => {
  function openDelete() {
    render(<ConversationRow conversation={CONVERSATION} />)
    fireEvent.contextMenu(screen.getByRole('button', { name: TITLE }))
    fireEvent.click(screen.getByText('Delete'))
  }

  it('asks first, naming what the delete destroys', () => {
    openDelete()

    expect(remove).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Delete conversation' })).toBeTruthy()
    expect(screen.getByText(/its files and its transcript/)).toBeTruthy()
    expect(screen.getByText(/This cannot be undone/)).toBeTruthy()
  })

  it('deletes on confirm and leaves the conversation it was reading', async () => {
    navigation.route = { kind: 'chat', conversationId: CONVERSATION.id }
    remove.mockResolvedValue(null)
    openDelete()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith(CONVERSATION.id))
    // The open conversation is gone, so the row sends the reader home rather
    // than leaving them on a record that no longer exists.
    expect(goHome).toHaveBeenCalledTimes(1)
  })

  it('stays put and says why when the harness refuses the delete', async () => {
    remove.mockResolvedValue({
      kind: 'harness-error',
      status: 409,
      code: 'storage.conflict',
      message: 'Conversation "cnv_1" has a turn in flight.',
    })
    openDelete()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(screen.getByRole('alert').textContent).toContain('has a turn in flight')
    // A refusal deletes nothing, so the reader stays where they are.
    expect(goHome).not.toHaveBeenCalled()
    expect(remove).toHaveBeenCalledWith(CONVERSATION.id)
  })
})
