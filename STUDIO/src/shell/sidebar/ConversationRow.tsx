import { useState } from 'react'
import { motion } from 'framer-motion'
import { SPRING_SNAPPY } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { MenuItem, MenuSeparator, Popover } from '@/components/primitives'
import { ActivityMark } from '@/shell/sidebar/ActivityMark'
import { useForkConversation } from '@/features/chat/fork'
import { useNavigation } from '@/stores/navigation'
import { useDetachConversation, useWorkspace } from '@/stores/workspace'
import type { Conversation } from '@/domain/session/types'
import { cn } from '@/lib/cn'

/**
 * One conversation in the sidebar.
 *
 * The overflow menu appears on hover or while it is open, and holds every verb
 * that is about the conversation as a record rather than as a place: fork,
 * pin, rename, archive, delete, open elsewhere. Keeping them here rather than
 * in a toolbar is what lets the row be a plain title the rest of the time.
 *
 * ---- The selection is a sliding chip ---------------------------------------
 *
 * The same device `SettingsTree` uses: the selection is one element with a
 * `layoutId`, so switching conversations reads as the selection travelling
 * down the column while the page crossfades beside it -- a lateral move in the
 * hierarchy, carried by the list it happened in (`SURFACE_SIBLING` is a pure
 * fade precisely because this chip already supplies the motion). A restyled
 * row instead would make the selection vanish here and appear there, two
 * events, and the page fade the only witness that one thing replaced another.
 */
export function ConversationRow({ conversation }: { conversation: Conversation }) {
  const { route, openChat, goHome } = useNavigation()
  const { rename, togglePin, setArchived, remove, running } = useWorkspace()
  const detach = useDetachConversation()
  const { forkWhole } = useForkConversation()
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
        'group/row relative flex items-center gap-1 rounded-md pr-0.5 transition-colors duration-fast',
        // The selected row keeps its own chip and takes no hover tint: the chip
        // is translucent, and a tint beneath it would deepen the selection
        // under the pointer -- two channels for one state.
        active ? null : 'hover:bg-tint',
      )}
    >
      {/* Behind the label, and shared across the whole column. */}
      {active ? (
        <motion.span
          layoutId="sidebar-selection"
          transition={SPRING_SNAPPY}
          aria-hidden
          className="absolute inset-0 rounded-md bg-selected"
        />
      ) : null}
      <button
        type="button"
        onClick={() => openChat(conversation.id)}
        className={cn(
          // No leading utility here. `text-ui` carries its own line-height, and a
          // Tailwind `leading-*` sits in the utilities layer, which outranks the
          // role class in `@layer components` — so it silently won and this row
          // rendered at a tighter leading than every other 13px row in the
          // column. Same size, different rhythm, which reads as a size mismatch.
          'relative flex min-w-0 flex-1 items-center gap-1.5 py-1 pl-2 text-left text-ui',
          active ? 'text-foreground' : 'text-muted-foreground group-hover/row:text-foreground',
        )}
      >
        {conversation.pinned ? <Icons.pin /> : null}
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
              // `relative` keeps this button above the selection chip: the chip
              // is positioned, and a positioned element paints over anything
              // static beside it -- the menu would vanish under its own row.
              'relative flex size-5 shrink-0 items-center justify-center rounded-full transition-all duration-fast',
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
          icon={<Icons.fork />}
          note="A new conversation carrying everything said here."
          onSelect={() => {
            setMenuOpen(false)
            // The fork opens its own conversation on success; a refusal is a
            // menu that simply closed, with the source untouched.
            void forkWhole(conversation)
          }}
        >
          Fork
        </MenuItem>
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
        <MenuItem
          icon={<Icons.openExternal />}
          onSelect={() => {
            detach(conversation.id, conversation.title ?? 'Untitled')
            setMenuOpen(false)
          }}
        >
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
