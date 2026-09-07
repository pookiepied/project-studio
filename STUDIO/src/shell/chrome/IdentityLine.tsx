import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { FADE } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { MenuItem, MenuLabel, MenuSeparator, Popover } from '@/components/primitives'
import { DeleteConversationDialog } from '@/shell/DeleteConversationDialog'
import { cn } from '@/lib/cn'
import { ProjectIconMark } from '@/domain/projects/ProjectIconMark'
import { useNavigation } from '@/stores/navigation'
import { useDetachConversation, useWorkspace } from '@/stores/workspace'
import type { Conversation } from '@/domain/session/types'

/**
 * Project, conversation, branch — one line, centred in the strip.
 *
 * The order is the sentence: which project, which conversation in it, which
 * branch it is working against. Set as three separate pieces of chrome they
 * would be three half-empty regions disagreeing about which is the heading; set
 * as one line the project is the qualifier, the title is the noun, and the
 * branch is the condition.
 *
 * Nothing renders until there is a conversation, so the home surface has no
 * heading to look past.
 *
 * The project and the branch are separate controls rather than one menu,
 * because they answer to different owners: the project is a filing decision the
 * user makes, the branch is a fact about the repository that the harness will
 * eventually report. Merging them would put a real git operation in the same
 * list as "move this chat to a folder".
 */
export function IdentityLine({
  conversation,
  running = false,
}: {
  conversation: Conversation
  /**
   * A turn is in flight in this conversation.
   *
   * The title wears the shimmer the transcript already puts on a running tool
   * row, which is what makes it the run's indicator: nothing new appears,
   * nothing takes a place in the layout, and the app ends up with one visual
   * word for "happening now" used at two scales. It goes here rather than on
   * a capsule of its own because the title is what a reader looks at to know
   * where they are, and while a turn runs "where you are" includes that it is
   * still going.
   *
   * Defaulted, so a caller with nothing to say about a run says nothing.
   */
  running?: boolean
}) {
  // `projects` stays: the line still *shows* which project a conversation is
  // in. Only `setProject` is gone, with the menu that reassigned it.
  const { projects, rename, setBranch, togglePin, setArchived, remove } = useWorkspace()
  const detach = useDetachConversation()
  const { openProject, goHome } = useNavigation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [branchOpen, setBranchOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) field.current?.select()
  }, [editing])

  // Leaving a conversation abandons any half-finished rename with it.
  useEffect(() => {
    setEditing(false)
    setMenuOpen(false)
    setConfirmingDelete(false)
    setBranchOpen(false)
  }, [conversation.id])

  if (!conversation.title) return null

  const project = projects.find((item) => item.id === conversation.projectId) ?? null

  const commit = () => {
    rename(conversation.id, draft)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={field}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
          if (event.key === 'Escape') setEditing(false)
        }}
        // Sized to content so the line does not jump width on becoming
        // editable, and capped so a long title cannot reach the window controls.
        size={Math.max(draft.length, 14)}
        className="max-w-[24rem] rounded-sm bg-selected px-1.5 py-0.5 text-center text-ui text-foreground outline-none"
      />
    )
  }

  return (
    <motion.div {...FADE} className="flex min-w-0 items-center gap-0.5">
      {project ? (
        <button
          type="button"
          onClick={() => openProject(project.id)}
          className="hidden shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-ui text-muted-foreground transition-colors duration-fast hover:bg-tint hover:text-foreground @[26rem]:flex"
        >
          <ProjectIconMark icon={project.icon} />
          <span className="max-w-[7rem] truncate">{project.name}</span>
        </button>
      ) : null}

      {project ? (
        // A middle dot, not a chevron: this is an attribution, not a navigable
        // path. A breadcrumb would promise a level to click back to.
        //
        // Hidden on the same query as the project it follows, or the line
        // opens with a stranded dot once the project drops out.
        <span aria-hidden className="hidden shrink-0 text-muted-foreground/50 @[26rem]:inline">
          &middot;
        </span>
      ) : null}

      <Popover
        open={menuOpen}
        onOpenChange={setMenuOpen}
        side="bottom"
        align="center"
        trigger={
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="group/identity flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-ui transition-colors duration-fast hover:bg-tint"
          >
            {conversation.pinned ? (
              <Icons.pin />
            ) : null}
            <span
              className={cn(
                'min-w-0 max-w-[11rem] truncate text-foreground @[26rem]:max-w-[15rem] @[40rem]:max-w-[20rem]',
                // `inline-block` is what the sweep needs to have a box to
                // travel across; `truncate` already supplies the rest.
                running && 'studio-shimmer inline-block',
              )}
            >
              {conversation.title}
            </span>
            <Icons.expand
              className="shrink-0 text-muted-foreground opacity-0 transition-opacity duration-fast group-hover/identity:opacity-100"
            />
          </button>
        }
      >
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
          icon={<Icons.pin />}
          onSelect={() => {
            togglePin(conversation.id)
            setMenuOpen(false)
          }}
        >
          {conversation.pinned ? 'Unpin' : 'Pin to top'}
        </MenuItem>
        <MenuItem
          icon={<Icons.openExternal />}
          onSelect={() => {
            detach(conversation.id, conversation.title ?? 'Untitled')
            setMenuOpen(false)
          }}
          note="Opens this conversation on its own."
        >
          Open in new window
        </MenuItem>

        {/* No project list here.
            This menu hangs off the conversation's own title, opened from
            inside that conversation — which means the project is already
            answered by where you are standing. Listing every project as a
            selectable row made the most common case (looking at a title you
            are already in) carry the entire filing system, and grew the menu
            by one row per project forever. Filing is a sidebar decision, and
            the sidebar is where it stays. */}
        <MenuSeparator />
        <MenuItem
          icon={<Icons.archive />}
          onSelect={() => {
            setArchived(conversation.id, true)
            setMenuOpen(false)
            goHome()
          }}
          note="Kept indefinitely. Settings has the archive."
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
          // The reader is standing in the conversation being deleted: when
          // the delete really happened the page behind it is gone, so go
          // home. A refusal leaves everything where it is.
          if (error === null) goHome()
          return error
        }}
      />

      {project?.branch ? (
        <>
          <span aria-hidden className="hidden shrink-0 text-muted-foreground/50 @[34rem]:inline">
            &middot;
          </span>
          <Popover
            open={branchOpen}
            onOpenChange={setBranchOpen}
            side="bottom"
            align="center"
            trigger={
              <button
                type="button"
                onClick={() => setBranchOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={branchOpen}
                className="hidden shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-ui text-muted-foreground transition-colors duration-fast hover:bg-tint hover:text-foreground @[34rem]:flex"
              >
                <Icons.branch />
                <span className="max-w-[8rem] truncate">{project.branch}</span>
              </button>
            }
          >
            <MenuLabel>Branch</MenuLabel>
            {project.branches.map((branch) => (
              <MenuItem
                key={branch}
                selected={branch === project.branch}
                onSelect={() => {
                  setBranch(project.id, branch)
                  setBranchOpen(false)
                }}
              >
                {branch}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem icon={<Icons.worktree />} onSelect={() => setBranchOpen(false)}>
              New worktree
            </MenuItem>
          </Popover>
        </>
      ) : null}
    </motion.div>
  )
}
