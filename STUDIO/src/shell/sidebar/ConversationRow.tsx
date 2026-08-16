import { useState } from 'react'
import { Icons } from '@/components/icons'
import { MenuItem, MenuSeparator, Popover } from '@/components/primitives'
import { useNavigation } from '@/stores/navigation'
import { useWorkspace } from '@/stores/workspace'
import type { Conversation } from '@/domain/session/types'
import { cn } from '@/lib/cn'

/**
 * One conversation in the sidebar.
 *
 * The overflow menu appears on hover or while it is open, and holds every verb
 * that is about the conversation as a record rather than as a place: pin,
 * rename, archive, delete, open elsewhere. Keeping them here rather than in a
 * toolbar is what lets the row be a plain title the rest of the time.
 */
export function ConversationRow({ conversation }: { conversation: Conversation }) {
  const { route, openChat, goHome } = useNavigation()
  const { rename, togglePin, setArchived, remove } = useWorkspace()
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(conversation.title ?? '')

  const active = route.kind === 'chat' && route.conversationId === conversation.id

  const commit = () => {
    rename(conversation.id, draft)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
          if (event.key === 'Escape') setEditing(false)
        }}
        className="w-full rounded-md bg-selected px-2 py-1 text-ui text-foreground outline-none"
      />
    )
  }

  return (
    <div
      className={cn(
        'group/row flex items-center gap-1 rounded-md pr-0.5 transition-colors duration-150',
        active ? 'bg-selected' : 'hover:bg-tint',
      )}
    >
      <button
        type="button"
        onClick={() => openChat(conversation.id)}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-1.5 py-1 pl-2 text-left text-ui leading-tight',
          active ? 'text-foreground' : 'text-muted-foreground group-hover/row:text-foreground',
        )}
      >
        {conversation.pinned ? <Icons.pin className="shrink-0 opacity-60" /> : null}
        <span className="min-w-0 truncate">{conversation.title ?? 'Untitled'}</span>
      </button>

      <Popover
        open={menuOpen}
        onOpenChange={setMenuOpen}
        side="bottom"
        align="end"
        trigger={
          <button
            type="button"
            aria-label="Conversation options"
            onClick={() => setMenuOpen((open) => !open)}
            className={cn(
              'flex size-5 shrink-0 items-center justify-center rounded transition-opacity duration-150',
              'text-muted-foreground hover:text-foreground',
              menuOpen ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100',
            )}
          >
            <Icons.more />
          </button>
        }
      >
        <MenuItem
          icon={<Icons.pin />}
          onSelect={() => {
            togglePin(conversation.id)
            setMenuOpen(false)
          }}
        >
          {conversation.pinned ? 'Unpin' : 'Pin to top'}
        </MenuItem>
        <MenuItem
          icon={<Icons.edit />}
          onSelect={() => {
            setDraft(conversation.title ?? '')
            setMenuOpen(false)
            setEditing(true)
          }}
        >
          Rename
        </MenuItem>
        <MenuItem icon={<Icons.openExternal />} onSelect={() => setMenuOpen(false)}>
          Open in new window
        </MenuItem>

        <MenuSeparator />
        <MenuItem
          icon={<Icons.archive />}
          onSelect={() => {
            setArchived(conversation.id, true)
            setMenuOpen(false)
            if (active) goHome()
          }}
        >
          Archive
        </MenuItem>
        <MenuItem
          icon={<Icons.delete />}
          destructive
          onSelect={() => {
            setMenuOpen(false)
            if (active) goHome()
            remove(conversation.id)
          }}
        >
          Delete
        </MenuItem>
      </Popover>
    </div>
  )
}
