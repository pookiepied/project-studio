import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { DURATION, EASE_IN, SPRING_SURFACE } from '@/design/tokens'
import { Icons } from '@/components/icons'
import type { IconComponent } from '@/components/icons'
import { Overlay } from '@/components/primitives'
import { ALL_SECTIONS } from '@/features/settings'
import { useNavigation } from '@/stores/navigation'
import { useWorkspace } from '@/stores/workspace'
import { cn } from '@/lib/cn'

/**
 * Search and commands.
 *
 * Conversations first when there is a query, commands first when there is not:
 * an empty palette is somebody about to act, and a typed one is somebody
 * looking for something they remember.
 *
 * Settings sections are searchable entries. A tree of fifteen panes is faster to
 * type at than to navigate, and it means "where do I turn off X" has an answer
 * that does not require knowing which group X was filed under.
 */

interface Entry {
  readonly id: string
  readonly label: string
  readonly hint?: string
  readonly icon: IconComponent
  readonly run: () => void
}

export function CommandPalette({ onNewProject }: { onNewProject: () => void }) {
  const { paletteOpen, setPaletteOpen, openChat, openProject, openSettings, goHome, toggleSidebar } =
    useNavigation()
  const { conversations, projects } = useWorkspace()
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!paletteOpen) return
    setQuery('')
    setCursor(0)
    field.current?.focus()
  }, [paletteOpen])

  const entries = useMemo<Entry[]>(() => {
    const needle = query.trim().toLowerCase()

    const commands: Entry[] = [
      { id: 'cmd-new', label: 'New conversation', icon: Icons.newChat, run: goHome },
      { id: 'cmd-project', label: 'New project', icon: Icons.projectNew, run: onNewProject },
      { id: 'cmd-sidebar', label: 'Toggle sidebar', icon: Icons.sidebar, run: toggleSidebar },
    ]

    const chats: Entry[] = conversations
      .filter((conversation) => conversation.title !== null && !conversation.archived)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((conversation) => ({
        id: conversation.id,
        label: conversation.title ?? '',
        hint: projects.find((project) => project.id === conversation.projectId)?.name,
        icon: Icons.chat,
        run: () => openChat(conversation.id),
      }))

    const projectEntries: Entry[] = projects.map((project) => ({
      id: project.id,
      label: project.name,
      hint: 'Project',
      icon: Icons.project,
      run: () => openProject(project.id),
    }))

    const settingsEntries: Entry[] = ALL_SECTIONS.map((section) => ({
      id: `settings-${section.id}`,
      label: section.name,
      hint: 'Settings',
      icon: section.icon,
      run: () => openSettings(section.id),
    }))

    const matches = (entry: Entry) => entry.label.toLowerCase().includes(needle)

    if (!needle) return [...commands, ...chats]
    return [
      ...chats.filter(matches),
      ...projectEntries.filter(matches),
      ...commands.filter(matches),
      ...settingsEntries.filter(matches),
    ]
  }, [
    conversations,
    projects,
    query,
    goHome,
    onNewProject,
    toggleSidebar,
    openChat,
    openProject,
    openSettings,
  ])

  // Clamped in render rather than in an effect, so there is never a frame where
  // the highlight points at a row that no longer exists.
  const index = Math.min(cursor, Math.max(entries.length - 1, 0))

  // The field is a combobox and the rows are its listbox, in ARIA's words:
  // the field keeps focus while the arrows move a highlight, and a screen
  // reader learns which row is current from `aria-activedescendant` rather
  // than from focus, which never leaves the field. The ids are minted here
  // so two palettes could not name each other's rows.
  const listId = useId()
  const optionId = (entry: Entry) => `${listId}-${entry.id}`
  const active = entries[index]
  const list = useRef<HTMLDivElement>(null)

  // The highlight can walk below the fold; the row it lands on comes into view.
  useEffect(() => {
    if (active === undefined) return
    const row = list.current?.querySelector(`[id="${optionId(active)}"]`)
    // jsdom has no scrollIntoView; a row that cannot scroll has nothing to do.
    if (row instanceof HTMLElement && typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'nearest' })
    }
    // `optionId` is a render-scoped closure over a stable id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const choose = (entry: Entry | undefined) => {
    if (!entry) return
    entry.run()
    setPaletteOpen(false)
  }

  return (
    <Overlay open={paletteOpen} onClose={() => setPaletteOpen(false)} anchor="top" className="px-6 pt-[16vh]">
      <motion.div
        role="dialog"
        aria-modal
        aria-label="Search and commands"
        initial={{ opacity: 0, scale: 0.97, y: -6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        // Leaves in the scrim's own time and ease, so the two halves of the
        // dismissal are the same length; see `Dialog` for the mismatch this
        // replaces.
        exit={{ opacity: 0, scale: 0.98, transition: { duration: DURATION.base, ease: EASE_IN } }}
        transition={SPRING_SURFACE}
        className="studio-blur w-full max-w-[30rem] overflow-hidden rounded-xl border shadow-modal"
      >
        <div className="flex items-center gap-2.5 border-b px-3.5 py-2.5">
          <Icons.search />
          <input
            ref={field}
            role="combobox"
            aria-expanded
            aria-autocomplete="list"
            aria-controls={listId}
            aria-activedescendant={active === undefined ? undefined : optionId(active)}
            value={query}
            placeholder="Search conversations and settings"
            onChange={(event) => {
              setQuery(event.target.value)
              setCursor(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setCursor((current) => Math.min(current + 1, entries.length - 1))
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setCursor((current) => Math.max(current - 1, 0))
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                choose(entries[index])
              }
            }}
            className="w-full bg-transparent text-body text-foreground outline-none placeholder:text-muted-foreground/70"
          />
        </div>

        <div
          ref={list}
          id={listId}
          role="listbox"
          aria-label="Results"
          className="studio-scroll-bounded max-h-[min(22rem,44vh)] overflow-y-auto p-1.5"
        >
          {entries.length === 0 ? (
            <p className="px-2.5 py-6 text-center text-ui text-muted-foreground">
              Nothing matches that.
            </p>
          ) : (
            entries.map((entry, position) => {
              const Glyph = entry.icon
              return (
                <button
                  key={entry.id}
                  id={optionId(entry)}
                  type="button"
                  role="option"
                  aria-selected={position === index}
                  // The field holds focus; a click still chooses.
                  tabIndex={-1}
                  onPointerEnter={() => setCursor(position)}
                  onClick={() => choose(entry)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-ui',
                    position === index ? 'bg-selected text-foreground' : 'text-muted-foreground',
                  )}
                >
                  <Glyph />
                  <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                  {entry.hint ? (
                    <span className="shrink-0 text-micro text-muted-foreground">{entry.hint}</span>
                  ) : null}
                </button>
              )
            })
          )}
        </div>
      </motion.div>
    </Overlay>
  )
}
