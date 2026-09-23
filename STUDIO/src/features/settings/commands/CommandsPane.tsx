import { useState } from 'react'
import { Icons } from '@/components/icons'
import { Button, IconButton } from '@/components/primitives'
import { Loading, StateNote } from '@/components/state'
import { Pane } from '@/features/settings/panes/Pane'
import { CommandDialog } from '@/features/settings/commands/CommandDialog'
import { useCommands, type CommandsView } from '@/features/settings/commands/useCommands'
import type { CommandProblem, CommandRecord, CommandSource } from '@/platform/harness'

/**
 * Slash commands.
 *
 * The list is everything the slash can do: the actions built into Studio,
 * the prompt commands it ships, and the person's own. The person's own can
 * be written here and are files all the same - one Markdown file each, in
 * the folder the pane names, in the format Claude Code reads - so a command
 * written in the editor and one dropped into the folder by hand are the
 * same thing seen from two sides. Built-in and shipped commands are listed
 * so the picker's whole vocabulary is visible in one place, and are not
 * editable, because they are not the person's to change.
 */
export function CommandsPane() {
  const commands = useCommands()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<{ id: string; source: CommandSource } | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const openEditor = async (command: CommandRecord) => {
    const detail = await commands.read(command.id)
    if ('kind' in detail) {
      setNote(detail.message)
      return
    }
    if (detail.source === null) return
    setEditing({ id: command.id, source: detail.source })
  }

  return (
    <Pane
      title="Commands"
      description="What typing / in the composer offers. A command expands to a prompt, or runs something Studio does itself."
    >
      <Header
        busy={commands.refreshing}
        status={commands.view.status}
        onRefresh={() => void commands.refresh()}
        onAdd={() => setAdding(true)}
      />
      <Body
        view={commands.view}
        onEdit={(command) => void openEditor(command)}
        onRemove={async (command) => {
          const error = await commands.remove(command.id)
          setNote(error === null ? null : error.message)
        }}
      />
      {note !== null ? (
        <p role="alert" className="mt-3 text-caption text-danger">
          {note}
        </p>
      ) : null}
      <WhereTheyLive directory={commands.view.status === 'ready' ? commands.view.listing.userDirectory : null} />

      <CommandDialog
        open={adding || editing !== null}
        editing={editing}
        onClose={() => {
          setAdding(false)
          setEditing(null)
        }}
        onSave={(id, source) => commands.save(id, source)}
      />
    </Pane>
  )
}

function Header({
  busy,
  status,
  onRefresh,
  onAdd,
}: {
  busy: boolean
  status: CommandsView['status']
  onRefresh: () => void
  onAdd: () => void
}) {
  const label =
    status === 'ready' ? 'Available in every conversation' : status === 'loading' ? 'Reading the commands' : ''
  return (
    <div className="flex items-center justify-between py-3.5">
      <p className="text-ui text-muted-foreground">{label}</p>
      <div className="flex items-center gap-1">
        <IconButton label="Refresh" onClick={onRefresh} disabled={busy}>
          <Icons.reload />
        </IconButton>
        <Button variant="primary" onClick={onAdd} disabled={status !== 'ready'}>
          New command
        </Button>
      </div>
    </div>
  )
}

function Body({
  view,
  onEdit,
  onRemove,
}: {
  view: CommandsView
  onEdit: (command: CommandRecord) => void
  onRemove: (command: CommandRecord) => void
}) {
  if (view.status === 'loading') return <Loading label="Loading commands" />
  if (view.status === 'no-harness') {
    return (
      <StateNote
        title="The harness is not running."
        detail="Commands are read by the harness, so the list cannot be read until it starts."
      />
    )
  }
  if (view.status === 'failed') {
    return <StateNote title="The list could not be read." detail={view.error.message} />
  }

  const { listing } = view
  return (
    <>
      <div className="flex flex-col divide-y">
        {listing.commands.map((command) => (
          <CommandRow key={command.id} command={command} onEdit={onEdit} onRemove={onRemove} />
        ))}
      </div>
      <Problems problems={listing.problems} />
    </>
  )
}

const PROVENANCE_LABEL = {
  builtin: 'Built into Studio',
  system: 'Ships with Studio',
  user: null,
} as const

function CommandRow({
  command,
  onEdit,
  onRemove,
}: {
  command: CommandRecord
  onEdit: (command: CommandRecord) => void
  onRemove: (command: CommandRecord) => void
}) {
  const own = command.provenance === 'user'
  const tag = PROVENANCE_LABEL[command.provenance]
  return (
    <div className="flex items-start justify-between gap-6 py-3.5">
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <span className="mt-0.5 shrink-0">
          <Icons.command />
        </span>
        <div className="min-w-0">
          <p className="text-ui text-foreground">
            <span className="font-mono">/{command.id}</span>
            {command.argumentHint !== '' ? (
              <span className="ml-1.5 font-mono text-muted-foreground">{command.argumentHint}</span>
            ) : null}
            {tag !== null ? <span className="ml-2 text-caption text-muted-foreground">{tag}</span> : null}
          </p>
          <p className="mt-0.5 text-caption text-muted-foreground">{command.description}</p>
          {command.path !== null ? (
            <p className="mt-0.5 truncate text-caption text-muted-foreground" title={command.path}>
              {command.path}
            </p>
          ) : null}
        </div>
      </div>
      {own ? (
        <div className="flex shrink-0 items-center gap-1">
          <IconButton label={`Edit /${command.id}`} onClick={() => onEdit(command)}>
            <Icons.edit />
          </IconButton>
          <IconButton label={`Remove /${command.id}`} onClick={() => onRemove(command)}>
            <Icons.delete />
          </IconButton>
        </div>
      ) : null}
    </div>
  )
}

function Problems({ problems }: { problems: readonly CommandProblem[] }) {
  if (problems.length === 0) return null
  return (
    <div className="mt-4">
      <p className="mb-1 text-caption text-muted-foreground">Skipped</p>
      <ul className="flex flex-col gap-1.5">
        {problems.map((problem) => (
          <li key={problem.path} className="text-caption text-muted-foreground">
            <span className="text-foreground">{problem.path}</span> — {problem.reason}
          </li>
        ))}
      </ul>
    </div>
  )
}

function WhereTheyLive({ directory }: { directory: string | null }) {
  return (
    <div className="mt-6 border-t pt-4">
      <p className="text-caption text-muted-foreground">
        A command is one Markdown file named after it, with an optional <code>description</code> and{' '}
        <code>argument-hint</code> in its frontmatter and the prompt below - the same file Claude Code
        reads from <code>.claude/commands/</code>. Yours live in{' '}
        <code>{directory ?? '~/.studio/commands/'}</code>; a file put there by hand appears on the next
        refresh.
      </p>
    </div>
  )
}
