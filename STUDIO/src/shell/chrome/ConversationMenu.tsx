import { useEffect, useState } from 'react'
import { Icons } from '@/components/icons'
import { IconButton, InlineRename, MenuItem, MenuLabel, MenuSeparator, MenuViews, Popover } from '@/components/primitives'
import { ConversationExtensionsDialog } from '@/shell/ConversationExtensionsDialog'
import { DeleteConversationDialog } from '@/shell/DeleteConversationDialog'
import { SnapshotsDialog } from '@/shell/SnapshotsDialog'
import { useNavigation } from '@/stores/navigation'
import { useDetachConversation, useWorkspace } from '@/stores/workspace'
import type { Conversation } from '@/domain/conversation/types'

/** The title, while it is being renamed. Stands where the title stood. */
export function ConversationRename({ conversation, onDone }: { conversation: Conversation; onDone: () => void }) {
  const { rename } = useWorkspace()
  return (
    <InlineRename
      initial={conversation.title ?? ''}
      onCommit={(value) => {
        rename(conversation.id, value)
        onDone()
      }}
      onCancel={onDone}
      fit
      className="min-w-0 max-w-[24rem] rounded-sm px-1.5 py-0.5"
    />
  )
}

/**
 * The header's three dots: everything the reference leaves no room for.
 *
 * Studio's own actions live here: the workspace, search and settings, then what
 * can be done to the open conversation. An untitled conversation has had no
 * exchange yet, so it has nothing to act on.
 */
export function ConversationMenu({
  conversation,
  onRename,
  onOpenWorkspace,
  general = false,
}: {
  conversation: Conversation | null
  onRename: () => void
  /** Present while the right workspace is folded. */
  onOpenWorkspace?: () => void
  /** The main window also carries search and settings. */
  general?: boolean
}) {
  const { projects, setBranch, togglePin, setArchived, remove } = useWorkspace()
  const detach = useDetachConversation()
  const { openProject, openSettings, setPaletteOpen, goHome } = useNavigation()
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'actions' | 'branch'>('actions')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [extensionsOpen, setExtensionsOpen] = useState(false)
  const [snapshotsOpen, setSnapshotsOpen] = useState(false)

  const conversationId = conversation?.id
  useEffect(() => {
    setOpen(false)
    setView('actions')
    setConfirmingDelete(false)
    setExtensionsOpen(false)
    setSnapshotsOpen(false)
  }, [conversationId])

  const titled = conversation !== null && conversation.title !== null ? conversation : null
  const project = projects.find((item) => item.id === titled?.projectId) ?? null
  if (titled === null && !general && onOpenWorkspace === undefined) return null

  const close = () => {
    setOpen(false)
    setView('actions')
  }
  const act = (action: () => void) => {
    close()
    action()
  }

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
        side="bottom"
        align="end"
        className="w-[15rem]"
        trigger={
          <IconButton
            label="More"
            size="header"
            tooltipSide="bottom"
            onClick={() => (open ? close() : setOpen(true))}
          >
            <Icons.dots size="header" />
          </IconButton>
        }
      >
        <MenuViews view={view} depth={view === 'branch' ? 1 : 0}>
          {view === 'branch' && project !== null ? (
            <>
              <MenuItem icon={<Icons.back />} onSelect={() => setView('actions')}>Back</MenuItem>
              <MenuSeparator />
              <MenuLabel>Branch</MenuLabel>
              {project.branches.map((branch) => (
                <MenuItem
                  key={branch}
                  selected={branch === project.branch}
                  onSelect={() => act(() => setBranch(project.id, branch))}
                >
                  {branch}
                </MenuItem>
              ))}
              <MenuSeparator />
              <MenuItem icon={<Icons.worktree />} onSelect={close}>New worktree</MenuItem>
            </>
          ) : (
            <>
              {onOpenWorkspace ? (
                <MenuItem icon={<Icons.workspace />} onSelect={() => act(onOpenWorkspace)}>Workspace</MenuItem>
              ) : null}
              {general ? (
                <>
                  <MenuItem icon={<Icons.search />} hint="Ctrl K" onSelect={() => act(() => setPaletteOpen(true))}>Search</MenuItem>
                  <MenuItem icon={<Icons.settings />} onSelect={() => act(() => openSettings())}>Settings</MenuItem>
                </>
              ) : null}
              {titled !== null ? (
                <>
                  {general || onOpenWorkspace ? <MenuSeparator /> : null}
                  <MenuItem icon={<Icons.edit />} onSelect={() => act(onRename)}>Rename</MenuItem>
                  <MenuItem icon={<Icons.pin />} onSelect={() => act(() => togglePin(titled.id))}>
                    {titled.pinned ? 'Unpin' : 'Pin to top'}
                  </MenuItem>
                  <MenuItem
                    icon={<Icons.openExternal />}
                    onSelect={() => act(() => detach(titled.id, titled.title ?? 'Untitled'))}
                  >
                    Open in new window
                  </MenuItem>
                  <MenuItem icon={<Icons.mcp />} onSelect={() => act(() => setExtensionsOpen(true))}>Extensions</MenuItem>
                  <MenuItem icon={<Icons.undo />} onSelect={() => act(() => setSnapshotsOpen(true))}>Project history</MenuItem>
                  {project !== null ? (
                    <MenuItem icon={<Icons.project />} hint={project.name} onSelect={() => act(() => openProject(project.id))}>
                      Open project
                    </MenuItem>
                  ) : null}
                  {project?.branch ? (
                    <MenuItem icon={<Icons.branch />} hint={project.branch} onSelect={() => setView('branch')}>
                      Branch
                    </MenuItem>
                  ) : null}
                  <MenuSeparator />
                  <MenuItem
                    icon={<Icons.archive />}
                    onSelect={() => act(() => {
                      setArchived(titled.id, true)
                      goHome()
                    })}
                  >
                    Archive
                  </MenuItem>
                  <MenuItem icon={<Icons.delete />} destructive onSelect={() => act(() => setConfirmingDelete(true))}>
                    Delete
                  </MenuItem>
                </>
              ) : null}
            </>
          )}
        </MenuViews>
      </Popover>
      <ConversationExtensionsDialog
        conversation={extensionsOpen ? titled : null}
        projectName={project?.name ?? null}
        onClose={() => setExtensionsOpen(false)}
      />
      <SnapshotsDialog conversation={snapshotsOpen ? titled : null} onClose={() => setSnapshotsOpen(false)} />
      <DeleteConversationDialog
        conversation={confirmingDelete ? titled : null}
        onClose={() => setConfirmingDelete(false)}
        onDelete={async (id) => {
          const error = await remove(id)
          // The reader is standing in the conversation being deleted. A refusal
          // leaves everything where it is.
          if (error === null) goHome()
          return error
        }}
      />
    </>
  )
}
