import { useState } from 'react'
import { Icons } from '@/components/icons'
import { InlineRename, MenuItem, MenuSeparator, Popover, SelectionChip } from '@/components/primitives'
import { ActivityMark } from '@/shell/sidebar/ActivityMark'
import { DeleteConversationDialog } from '@/shell/DeleteConversationDialog'
import { useForkConversation } from '@/features/chat/connection/fork'
import { useNavigation } from '@/stores/navigation'
import { useDetachConversation, useWorkspace } from '@/stores/workspace'
import type { Conversation } from '@/domain/conversation/types'
import { cn } from '@/lib/cn'

/**
 * One conversation in the sidebar.
 *
 * The row's trailing slot has two occupants, never both. While the
 * conversation is working the dot-matrix mark holds it; otherwise an archive
 * button holds it, appearing on hover only. A running conversation never
 * offers archive under the pointer that is watching it finish — when the work
 * ends the mark swaps back out for the button.
 *
  * Everything else about the conversation as a record — fork, pin, rename,
  * open elsewhere, archive, delete — lives in the menu, and the menu opens on
  * right-click of the row. Keeping the verbs there rather than in a toolbar is
  * what lets the row be a plain title the rest of the time.
  *
  * Archive and delete are two meanings, not two names for one. Archive files
  * the conversation away and destroys nothing; delete asks first, names what
  * it destroys, and cannot be undone.
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
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [editing, setEditing] = useState(false)

  const active = route.kind === 'chat' && route.conversationId === conversation.id
  const working = running.has(conversation.id)

  const archive = () => {
    setArchived(conversation.id, true)
    setMenuOpen(false)
    if (active) goHome()
  }

  if (editing) {
    return (
      <InlineRename
        initial={conversation.title ?? ''}
        onCommit={(value) => {
          rename(conversation.id, value)
          setEditing(false)
        }}
        onCancel={() => setEditing(false)}
        className="rounded-md px-2 py-1"
      />
    )
  }

  return (
    <div
      onContextMenu={(event) => {
        // The row owns right-click: the conversation menu opens here, and the
        // app-wide actions menu must not open beside it. React handles this at
        // the root container, which runs before the document listener the
        // actions menu uses — stopping propagation keeps that listener from
        // ever firing.
        event.preventDefault()
        event.stopPropagation()
        setMenuOpen(true)
      }}
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
        <SelectionChip list="sidebar" />
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
      </button>

      <Popover
        open={menuOpen}
        onOpenChange={setMenuOpen}
        side="bottom"
        align="end"
        trigger={
          // One box, always the same size, so the menu anchors to the same
          // corner and the row never shifts as the occupants swap.
          <span className="relative flex size-5 shrink-0 items-center justify-center">
            {working ? (
              // After the title, not before it. Leading, it would push every
              // title in the column right the moment any one of them started
              // working, and the list would twitch each time a reply began or
              // ended. Trailing, it occupies the slack the truncation already
              // leaves.
              <ActivityMark />
            ) : (
              <button
                type="button"
                aria-label={`Archive ${conversation.title ?? 'Untitled'}`}
                onClick={archive}
                className={cn(
                  // `relative` keeps this button above the selection chip: the
                  // chip is positioned, and a positioned element paints over
                  // anything static beside it.
                  'relative flex size-5 items-center justify-center rounded-full transition-all duration-fast',
                  'text-muted-foreground hover:bg-tint hover:text-foreground',
                  'opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100',
                )}
              >
                <Icons.archive />
              </button>
            )}
          </span>
        }
      >
        <MenuItem
          icon={<Icons.fork />}
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
          onSelect={archive}
        >
          Archive
        </MenuItem>
        <MenuItem
          icon={<Icons.delete />}
          destructive
          note="The conversation, its files and its transcript. Cannot be undone."
          onSelect={() => {
            setMenuOpen(false)
            setConfirmingDelete(true)
          }}
        >
          Delete
        </MenuItem>
      </Popover>
      <DeleteConversationDialog
        conversation={confirmingDelete ? conversation : null}
        onClose={() => setConfirmingDelete(false)}
        onDelete={async (id) => {
          const error = await remove(id)
          // Deleting the open conversation empties the page behind it, so
          // the row sends the reader home - but only when the delete really
          // happened. A refusal leaves the conversation where it is.
          if (error === null && active) goHome()
          return error
        }}
      />
    </div>
  )
}
