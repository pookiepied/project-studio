import { useState } from 'react'
import { Icons } from '@/components/icons'
import { Button } from '@/components/primitives'
import { useWorkspace } from '@/stores/workspace'
import { Pane } from '@/features/settings/panes/Pane'
import { cn } from '@/lib/cn'

/**
 * Archived chats.
 *
 * Archiving keeps a conversation indefinitely -- there is no thirty-day sweep,
 * and the copy says so, because an archive that quietly deletes is the one
 * feature nobody forgives. Deleting is a separate, explicit act, available one
 * at a time or over a selection.
 *
 * Selection is here rather than a per-row delete because the reason to visit
 * this pane at all is usually to clear several things at once.
 */
export function ArchivePane() {
  const { conversations, setArchived, removeMany } = useWorkspace()
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())

  const archived = conversations
    .filter((conversation) => conversation.archived)
    .sort((a, b) => b.updatedAt - a.updatedAt)

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <Pane
      title="Archived chats"
      description="Kept for as long as you want them. Nothing here expires."
    >
      {archived.length === 0 ? (
        <p className="py-4 text-ui text-muted-foreground">Nothing archived.</p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 py-2.5">
            <span className="text-caption text-muted-foreground">
              {selected.size > 0 ? `${selected.size} selected` : `${archived.length} conversations`}
            </span>
            <div className="flex items-center gap-1.5">
              {selected.size > 0 ? (
                <Button
                  onClick={() => {
                    removeMany([...selected])
                    setSelected(new Set())
                  }}
                >
                  <Icons.delete />
                  Delete selected
                </Button>
              ) : null}
              <Button
                variant="outline"
                onClick={() => {
                  removeMany(archived.map((conversation) => conversation.id))
                  setSelected(new Set())
                }}
              >
                <Icons.clear />
                Clear archive
              </Button>
            </div>
          </div>

          <div className="flex flex-col divide-y">
            {archived.map((conversation) => {
              const checked = selected.has(conversation.id)
              return (
                <div key={conversation.id} className="flex items-center gap-2.5 py-2.5">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    aria-label={`Select ${conversation.title ?? 'conversation'}`}
                    onClick={() => toggle(conversation.id)}
                    className={cn(
                      'flex size-4 shrink-0 items-center justify-center rounded-xs border transition-colors duration-fast',
                      checked
                        ? 'border-transparent bg-primary text-primary-foreground'
                        : 'hover:border-foreground/30',
                    )}
                  >
                    {checked ? <Icons.check /> : null}
                  </button>

                  <span className="min-w-0 flex-1 truncate text-ui text-foreground">
                    {conversation.title ?? 'Untitled'}
                  </span>

                  <Button onClick={() => setArchived(conversation.id, false)}>Restore</Button>
                </div>
              )
            })}
          </div>
        </>
      )}
    </Pane>
  )
}
