import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { FADE } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { MenuItem, MenuLabel, MenuSeparator, Popover } from '@/components/primitives'
import { ProjectIconMark } from '@/domain/projects/ProjectIconMark'
import { useNavigation } from '@/stores/navigation'
import { useDetachConversation, useWorkspace } from '@/stores/workspace'
import type { Conversation } from '@/domain/session/types'

/**
 * Project, conversation, branch -- one line, centred in the strip.
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
export function IdentityLine({ conversation }: { conversation: Conversation }) {
  const { projects, rename, setProject, setBranch, togglePin, setArchived, remove } = useWorkspace()
  const detach = useDetachConversation()
  const { openProject, goHome } = useNavigation()
  const [menuOpen, setMenuOpen] = useState(false)
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
          className="hidden shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-ui leading-none text-muted-foreground transition-colors duration-fast hover:bg-tint hover:text-foreground @[26rem]:flex"
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
            className="group/identity flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-ui leading-none transition-colors duration-fast hover:bg-tint"
          >
            {conversation.pinned ? (
              <Icons.pin className="shrink-0 text-muted-foreground" />
            ) : null}
            <span className="min-w-0 max-w-[11rem] truncate text-foreground @[26rem]:max-w-[15rem] @[40rem]:max-w-[20rem]">
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

        <MenuSeparator />
        <MenuLabel>Project</MenuLabel>
        <MenuItem
          selected={conversation.projectId === null}
          onSelect={() => {
            setProject(conversation.id, null)
            setMenuOpen(false)
          }}
        >
          None
        </MenuItem>
        {projects.map((item) => (
          <MenuItem
            key={item.id}
            selected={conversation.projectId === item.id}
            onSelect={() => {
              setProject(conversation.id, item.id)
              setMenuOpen(false)
            }}
          >
            {item.name}
          </MenuItem>
        ))}

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
          onSelect={() => {
            setMenuOpen(false)
            goHome()
            remove(conversation.id)
          }}
        >
          Delete
        </MenuItem>
      </Popover>

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
                className="hidden shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-ui leading-none text-muted-foreground transition-colors duration-fast hover:bg-tint hover:text-foreground @[34rem]:flex"
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
