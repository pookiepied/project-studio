import { useMemo, useState } from 'react'
import { Icons } from '@/components/icons'
import { MenuItem, MenuLabel, MenuSeparator, Popover, SearchField } from '@/components/primitives'
import { cn } from '@/lib/cn'
import { useNavigation } from '@/stores/navigation'
import { useWorkspace } from '@/stores/workspace'

/**
 * The header's left end: where you are, and the way to anywhere else.
 *
 * The drawer holds the same list, but at Family A's width the drawer is closed
 * nearly all the time, so switching has to work without opening it. Pinned
 * conversations lead, as they do in the sidebar, and projects follow.
 */
export function ConversationSelector({
  title,
  currentId,
  running = false,
}: {
  title: string
  /** The open conversation, marked in the list. */
  currentId: string | null
  /** A turn is in flight: the title wears the transcript's shimmer. */
  running?: boolean
}) {
  const { conversations, projects } = useWorkspace()
  const { openChat, openProject } = useNavigation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()

  const rows = useMemo(
    () => conversations
      .filter((item) => !item.archived && item.title !== null)
      .filter((item) => needle === '' || (item.title ?? '').toLowerCase().includes(needle))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt),
    [conversations, needle],
  )
  const matchingProjects = projects.filter((item) => needle === '' || item.name.toLowerCase().includes(needle))
  const projectName = (id: string | null) => projects.find((item) => item.id === id)?.name

  const choose = (go: () => void) => {
    go()
    setOpen(false)
    setQuery('')
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setQuery('')
      }}
      side="bottom"
      align="start"
      anchorClassName="min-w-0"
      className="w-[min(20rem,calc(100vw-2rem))]"
      trigger={
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Conversations. Current: ${title}`}
          className="flex h-[var(--header-control)] min-w-0 items-center rounded-full pl-[11px] pr-2.5 transition-colors duration-fast hover:bg-tint"
        >
          <Icons.history size="header" />
          <span
            className={cn(
              'ml-4 min-w-0 truncate text-body font-medium text-foreground',
              running && 'studio-shimmer inline-block',
            )}
          >
            {title}
          </span>
          <Icons.dropdown className="ml-2 shrink-0" />
        </button>
      }
    >
      <div className="px-1 pt-1">
        <SearchField
          autoFocus
          appearance="menu"
          ariaLabel="Search conversations"
          placeholder="Search conversations..."
          value={query}
          onChange={setQuery}
        />
      </div>
      <MenuSeparator />
      <div className="studio-scroll-bounded max-h-[min(22rem,60dvh)] overflow-y-auto overscroll-contain">
        {rows.length === 0 && matchingProjects.length === 0 ? (
          <p role="status" className="px-2 py-2 text-ui text-muted-foreground">
            {needle === '' ? 'No conversations yet.' : `Nothing matches "${query.trim()}".`}
          </p>
        ) : null}
        {rows.length > 0 ? <MenuLabel>Conversations</MenuLabel> : null}
        {rows.map((item) => (
          <MenuItem
            key={item.id}
            selected={item.id === currentId}
            hint={projectName(item.projectId)}
            onSelect={() => choose(() => openChat(item.id))}
          >
            {item.title}
          </MenuItem>
        ))}
        {matchingProjects.length > 0 ? <MenuLabel>Projects</MenuLabel> : null}
        {matchingProjects.map((item) => (
          <MenuItem key={item.id} icon={<Icons.project />} onSelect={() => choose(() => openProject(item.id))}>
            {item.name}
          </MenuItem>
        ))}
      </div>
    </Popover>
  )
}
