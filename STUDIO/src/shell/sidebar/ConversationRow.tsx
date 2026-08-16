import { useState } from 'react'
import { Icons } from '@/components/icons'
import { MenuItem, MenuSeparator, Popover } from '@/components/primitives'
import { ActivityMark } from '@/shell/sidebar/ActivityMark'
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
  const { rename, togglePin, setArchived, remove, running } = useWorkspace()
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(conversation.title ?? '')

  const active = route.kind === 'chat' && route.conversationId === conversation.id
  const working = running.has(conversation.id)

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
        'group/row flex items-center gap-1 rounded-md pr-0.5 transition-colors duration-fast',
        active ? 'bg-selected' : 'hover:bg-tint',
      )}
    >
      <button
        type="button"
        onClick={() => openChat(conversation.id)}
        className={cn(
          // No leading utility here. `text-ui` carries its own line-height, and a
          // Tailwind `leading-*` sits in the utilities layer, which outranks the
          // role class in `@layer components` -- so it silently won and this row
          // rendered at a tighter leading than every other 13px row in the
          // column. Same size, different rhythm, which reads as a size mismatch.
          'flex min-w-0 flex-1 items-center gap-1.5 py-1 pl-2 text-left text-ui',
          active ? 'text-foreground' : 'text-muted-foreground group-hover/row:text-foreground',
        )}
      >
        {conversation.pinned ? <Icons.pin className="shrink-0 text-muted-foreground" /> : null}
        <span className="min-w-0 truncate">{conversation.title ?? 'Untitled'}</span>

        {/* After the title, not before it.
            Leading, it would push every title in the column right the moment
            any one of them started working, and the list would twitch each
            time a reply began or ended. Trailing, it occupies the slack the
            truncation already leaves. */}
        {working ? (
          <span className="ml-auto shrink-0 pl-1">
            <ActivityMark />
          </span>
        ) : null}
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
              'flex size-5 shrink-0 items-center justify-center rounded-full transition-all duration-fast',
              'text-muted-foreground hover:bg-tint',
              // A working row keeps its mark visible until the pointer
              // arrives; the menu button then takes the slot, because the two
              // want the same corner and the one you reached for wins.
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
