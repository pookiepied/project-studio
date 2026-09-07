import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Icons } from '@/components/icons'
import { Button, IconButton, Segmented } from '@/components/primitives'
import { DURATION, EASE_OUT } from '@/design/tokens'
import { Pane } from '@/features/settings/panes/Pane'
import { StateNote } from '@/components/state/StateNote'
import { useMcpServers, type McpView } from '@/features/settings/mcp/useMcpServers'
import { ServerDialog } from '@/features/settings/mcp/ServerDialog'
import type { McpServerRecord, McpState } from '@/platform/harness'

/**
 * MCP servers.
 *
 * The list is the user's DEFAULTS, not one project's answer. A server switched
 * on here is inherited by every project and every conversation that has not
 * decided for itself; a project narrows or widens from its own screen. Global
 * scope is only writable here, on purpose - a global change reachable from
 * inside one conversation is a change someone did not know they were making.
 */
export function McpPane() {
  const servers = useMcpServers()
  /**
   * What the dialog is doing: closed, adding, or editing one server.
   *
   * One value rather than an open flag beside a selection, because "open with
   * nothing selected" and "closed but still remembering a selection" are
   * states that can disagree, and neither has a meaning here.
   */
  const [editor, setEditor] = useState<
    { readonly kind: 'closed' } | { readonly kind: 'add' } | { readonly kind: 'edit'; readonly server: McpServerRecord }
  >({ kind: 'closed' })

  return (
    <Pane
      title="MCP servers"
      description="Tools and data Studio can reach. What is on here is the default for new projects and conversations."
    >
      <Header
        busy={servers.refreshing}
        onRefresh={() => void servers.refresh()}
        onAdd={() => setEditor({ kind: 'add' })}
        status={servers.view.status}
      />
      <Body
        servers={servers}
        onEdit={(server) => setEditor({ kind: 'edit', server })}
      />
      <ServerDialog
        open={editor.kind !== 'closed'}
        editing={editor.kind === 'edit' ? editor.server : null}
        onClose={() => setEditor({ kind: 'closed' })}
        onSave={servers.save}
        onSaveCredential={servers.setCredential}
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
  status: McpView['status']
  onRefresh: () => void
  onAdd: () => void
}) {
  // The label follows the state rather than splitting it in two. "Reading what
  // is installed" beside "the harness is not running" is the header
  // contradicting the body, which is worse than saying nothing: it reads as
  // the app still trying when it has already stopped.
  const label =
    status === 'ready'
      ? 'Installed on this machine'
      : status === 'loading'
        ? 'Reading what is installed'
        : ''

  return (
    <div className="flex items-center justify-between py-3.5">
      <p className="text-ui text-muted-foreground">{label}</p>
      <div className="flex items-center gap-1">
        {/* `IconButton` carries its own tooltip, so the label is both the
            accessible name and the tip. The mark winds up before it turns,
            which is the registry's preview-the-action motion; nothing else
            marks a refresh as running, because a list already on screen
            staying there is the point. */}
        <IconButton label="Refresh" onClick={onRefresh} disabled={busy}>
          <Icons.reload />
        </IconButton>
        <Button variant="secondary" size="sm" onClick={onAdd} disabled={status !== 'ready'}>
          <Icons.add />
          Add server
        </Button>
      </div>
    </div>
  )
}

function Body({
  servers,
  onEdit,
}: {
  servers: ReturnType<typeof useMcpServers>
  onEdit: (server: McpServerRecord) => void
}) {
  const { view } = servers

  if (view.status === 'loading') return <ListSkeleton />

  if (view.status === 'no-harness') {
    return (
      <StateNote
        title="The harness is not running."
        detail="MCP servers live in the harness, so the list cannot be read until it starts."
      />
    )
  }

  if (view.status === 'failed') {
    return <StateNote title="The list could not be read." detail={view.error.message} />
  }

  if (view.servers.length === 0) {
    return (
      <StateNote
        title="No MCP servers yet."
        detail="Add one to give Studio tools and data beyond what it ships with."
      />
    )
  }

  return (
    <div className="flex flex-col divide-y">
      {view.servers.map((server) => (
        <ServerRow
          key={server.id}
          server={server}
          onToggle={(enabled) => void servers.setEnabled(server.id, enabled)}
          onEdit={() => onEdit(server)}
          onRemove={() => void servers.remove(server.id)}
        />
      ))}
    </div>
  )
}

/**
 * One server.
 *
 * The row says three things at once and they are genuinely different: what it
 * is (title, and how it is reached), whether it is on by default, and what it
 * is doing right now. The third only appears when there is something to say -
 * a server that is simply off has no state worth a line of text.
 */
function ServerRow({
  server,
  onToggle,
  onEdit,
  onRemove,
}: {
  server: McpServerRecord
  onToggle: (enabled: boolean) => void
  onEdit: () => void
  onRemove: () => void
}) {
  /**
   * Removal asks first, in the row itself.
   *
   * Uninstalling revokes every approval the server was ever granted and
   * forgets it at every scope, so it is not a thing to do on one click. A
   * second dialog over the settings dialog would be a stack nobody enjoys;
   * the row answers the question where the question was asked.
   */
  const [confirming, setConfirming] = useState(false)
  // Seeded from the stored default and held locally so the switch moves the
  // moment it is clicked, rather than waiting for the write and the re-read.
  // The list is re-read on success, so the harness remains the authority; this
  // only removes the pause.
  const [enabled, setEnabled] = useState(server.enabledByDefault)

  return (
    <div className="flex items-start justify-between gap-6 py-3.5">
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <span className="mt-0.5 shrink-0">
          <Icons.mcp />
        </span>
        <div className="min-w-0">
          <p className="truncate text-ui text-foreground">{server.title}</p>
          {/* Above the reach, and only when there is one. This is the sentence
              the model is given about the server, so a person deciding whether
              to leave it on is reading the same thing the model reads. A
              server with no sentence shows none rather than a placeholder:
              an empty line here would read as a server that failed to
              describe itself. */}
          {server.description === '' ? null : (
            <p className="mt-0.5 truncate text-caption text-muted-foreground">
              {server.description}
            </p>
          )}
          <p className="mt-0.5 truncate text-caption text-muted-foreground">{reach(server)}</p>
          <StatusLine server={server} />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {confirming ? (
          <>
            <span className="text-caption text-muted-foreground">Remove?</span>
            <Button variant="secondary" size="sm" onClick={() => setConfirming(false)}>
              Keep
            </Button>
            <Button variant="danger" size="sm" onClick={onRemove}>
              Remove
            </Button>
          </>
        ) : (
          <>
            <IconButton label="Edit" onClick={onEdit}>
              <Icons.edit />
            </IconButton>
            {/* Quiet, not danger. The mark stays `--muted-foreground` like
                every other mark in the app; the weight belongs on the confirm
                button, where the consequence actually is. */}
            <IconButton label="Remove" onClick={() => setConfirming(true)}>
              <Icons.delete />
            </IconButton>
            <Segmented
              layoutId={`mcp-${server.id}`}
              ariaLabel={`${server.title} default`}
              value={enabled ? 'on' : 'off'}
              onChange={(value) => {
                const next = value === 'on'
                setEnabled(next)
                onToggle(next)
              }}
              options={[
                { id: 'off', label: 'Off' },
                { id: 'on', label: 'On' },
              ]}
            />
          </>
        )}
      </div>
    </div>
  )
}

/**
 * How the server is reached, in one line a person can check.
 *
 * The command and its arguments are shown joined by spaces for reading only.
 * They are stored as a real vector and never re-split, so this is a rendering
 * of the vector rather than the thing itself - which matters, because a path
 * containing a space would read ambiguously here and still run correctly.
 */
function reach(server: McpServerRecord): string {
  if (server.transport === 'http') return server.url ?? 'No address set'
  const command = server.command ?? 'No command set'
  return server.args.length === 0 ? command : `${command} ${server.args.join(' ')}`
}

/** What the server is doing, when that is anything worth saying. */
function StatusLine({ server }: { server: McpServerRecord }) {
  const status = server.status
  if (status === undefined) return null

  return (
    <AnimatePresence initial={false}>
      <motion.p
        key={status.state}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: DURATION.fast / 1000, ease: EASE_OUT }}
        className="mt-1 flex items-center gap-1.5 text-caption text-muted-foreground"
      >
        <StateDot state={status.state} />
        {describe(server)}
      </motion.p>
    </AnimatePresence>
  )
}

/**
 * The one piece of colour in the row.
 *
 * The palette is monochrome by rule, with `--danger` as one of two deliberate
 * exceptions - and a server that has given up is exactly what that exception
 * is for. Everything else is a tint of the foreground, so "running" does not
 * shout.
 */
function StateDot({ state }: { state: McpState }) {
  const tone =
    state === 'ready'
      ? 'bg-foreground'
      : state === 'failed' || state === 'given-up'
        ? 'bg-danger'
        : 'bg-muted-foreground'
  return <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${tone}`} />
}

/**
 * The status in words.
 *
 * `given-up` gets its own sentence rather than sharing "failed": failed will
 * be retried and given-up will not, and someone told "failed" would wait for a
 * retry that is never coming.
 */
function describe(server: McpServerRecord): string {
  const status = server.status
  if (status === undefined) return ''
  switch (status.state) {
    case 'ready':
      return status.protocolVersion === undefined
        ? 'Connected'
        : `Connected, ${status.era === 'legacy' ? 'legacy' : 'modern'} protocol ${status.protocolVersion}`
    case 'starting':
      return status.attempts > 0 ? `Starting, attempt ${status.attempts + 1}` : 'Starting'
    case 'stopping':
      return 'Stopping'
    case 'idle':
      return 'Not started'
    case 'failed':
      return status.lastError ?? 'Failed to start; it will be tried again'
    case 'given-up':
      return status.lastError === undefined
        ? 'Gave up after repeated failures'
        : `Gave up after repeated failures: ${status.lastError}`
  }
}

/**
 * The list before it arrives.
 *
 * Three rows because the list is usually short, and a skeleton longer than the
 * content it replaces makes the pane jump when the real list lands.
 */
function ListSkeleton() {
  return (
    <div className="flex flex-col divide-y" aria-hidden>
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex items-center justify-between gap-6 py-3.5">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="h-3 w-32 rounded bg-tint" />
            <div className="h-2.5 w-48 rounded bg-tint" />
          </div>
          <div className="h-7 w-24 shrink-0 rounded-lg bg-tint" />
        </div>
      ))}
    </div>
  )
}
