import { useState } from 'react'
import { extensionMark } from '@/components/icons/extensionMark'
import { Dialog } from '@/components/primitives'
import { StateNote } from '@/components/state/StateNote'
import { ScopeToggle, inheritSentence } from '@/features/settings/mcp/ScopeToggle'
import { useMcpServers } from '@/features/settings/mcp/useMcpServers'
import type { HarnessFailure, McpScopeReading, McpServerRecord } from '@/platform/harness'

/**
 * What this one conversation can reach, and what it has decided.
 *
 * The conversation scope's own surface, deliberately the last of the three
 * scopes to get one: a conversation's decision is the narrowest and the least
 * wanted, so it gets the smallest room in which it can still be honest. It
 * lives here, with the conversation, rather than in Settings, because the
 * narrowest scope belongs where the conversation lives - the same reasoning
 * that keeps a project's decision on its own page and the default in the
 * Settings pane, one step wider each time.
 *
 * Mounted beside the conversation's identity line and handed the
 * conversation as its open flag, the way `DeleteConversationDialog` is: the
 * scope the rows read flips between closed (the global read, which nobody
 * sees) and this conversation's, and the hook re-reads on that flip - so
 * what the rows show is always the conversation that is actually open, never
 * the last one the dialog remembers.
 *
 * ---- What each row says ---------------------------------------------------
 *
 * A row is this conversation's decision: Inherit, Off, or On - and while it
 * reads Inherit, what Inherit currently resolves to. The last part is the
 * point of the dialog: this conversation sits under a project and a default,
 * and the narrowest switch only means something once the row says what it
 * hands the question to.
 *
 * ---- When a change arrives -----------------------------------------------
 *
 * A change reaches the conversation's tools the next time it sends, and its
 * capabilities note does not change at all: the note was settled at the
 * conversation's first message, because the block is the cached prefix of
 * every request and a note that moved would re-bill the whole conversation
 * behind it. Saying so here is the recommendation the discovery plan made:
 * the harness already applies decisions to conversations that have not
 * started, so what this dialog adds is the one sentence the switch cannot
 * say about the conversation that is already open.
 */
export function ConversationExtensionsDialog({
  conversation,
  projectName,
  onClose,
}: {
  /** Null when the dialog is closed. Doubles as the open flag. */
  conversation: { readonly id: string } | null
  /** The project the conversation stands in, when it has one, for the note. */
  projectName: string | null
  onClose: () => void
}) {
  // Closed, the hook idles on the global read; open, it reads this
  // conversation's. The flip is what makes it fresh: the read keys on the
  // conversation id, so opening the dialog for another conversation is
  // another read, never the previous conversation's list.
  const extensions = useMcpServers(conversation === null ? {} : { conversationId: conversation.id })
  const [lastError, setLastError] = useState<HarnessFailure | null>(null)
  const { view } = extensions

  return (
    <Dialog
      open={conversation !== null}
      onClose={() => {
        setLastError(null)
        onClose()
      }}
      title="Extensions"
      width="28rem"
    >
      <div className="flex flex-col gap-3 pt-1">
        <p className="text-caption text-muted-foreground">
          What this conversation can reach, decided here rather than for its project or for
          everything.
        </p>

        {view.status === 'loading' ? (
          <p className="py-2 text-ui text-muted-foreground" role="status" aria-label="Loading extensions">
            Reading what is installed.
          </p>
        ) : null}

        {view.status === 'no-harness' ? (
          <StateNote
            title="The harness is not running."
            detail="Extensions live in the harness, so the list cannot be read until it starts."
          />
        ) : null}

        {view.status === 'failed' ? (
          <StateNote title="The list could not be read." detail={view.error.message} />
        ) : null}

        {view.status === 'ready' ? (
          view.servers.length === 0 ? (
            <p className="py-2 text-ui text-muted-foreground">
              No extensions are installed. Add one under Settings, Extensions.
            </p>
          ) : (
            <div className="flex flex-col divide-y">
              {view.servers.map((server) => (
                <ConversationScopeRow
                  key={server.id}
                  server={server}
                  reading={server.conversation}
                  projectName={projectName}
                  onDecide={(enabled) => {
                    void extensions
                      .setEnabled(server.id, enabled)
                      .then(setLastError)
                  }}
                />
              ))}
            </div>
          )
        ) : null}

        {lastError === null ? null : (
          <p role="alert" className="text-caption text-danger">
            {lastError.message}
          </p>
        )}

        {view.status === 'ready' && view.servers.length > 0 ? (
          <p className="text-caption text-muted-foreground">
            This conversation applies the change the next time it sends. Its capabilities note was
            settled at its first message and does not change, so the model meets a later addition
            when it looks, or in a new conversation.
          </p>
        ) : null}
      </div>
    </Dialog>
  )
}

/**
 * One conversation's decision about one extension.
 *
 * The optimistic seed and the Inherit note follow the project screen's rows
 * exactly, because they are the same question one scope narrower: what this
 * scope stored, and - while the answer is Inherit - what the wider scopes
 * make of it.
 */
function ConversationScopeRow({
  server,
  reading,
  projectName,
  onDecide,
}: {
  server: McpServerRecord
  reading?: McpScopeReading
  projectName: string | null
  onDecide: (enabled: boolean | null) => void
}) {
  // Held so the switch moves the moment it is clicked, rather than waiting
  // for the write and the re-read; the hook's re-read remains the authority.
  const [decision, setDecision] = useState(reading?.decision ?? null)

  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <span className="mt-0.5 shrink-0">{extensionMark(server)}</span>
        <div className="min-w-0">
          <p className="truncate text-ui text-foreground">{server.title}</p>
          {server.description === '' ? null : (
            <p className="mt-0.5 truncate text-caption text-muted-foreground">
              {server.description}
            </p>
          )}
          {reading !== undefined && decision === null ? (
            <p className="mt-0.5 truncate text-caption text-muted-foreground">
              {inheritSentence(reading, projectName === null ? undefined : projectName)}
            </p>
          ) : null}
        </div>
      </div>
      <div className="shrink-0 pt-0.5">
        <ScopeToggle
          value={decision}
          onChange={(enabled) => {
            setDecision(enabled)
            onDecide(enabled)
          }}
          ariaLabel={`${server.title} in this conversation`}
          layoutId={`conversation-extension-${server.id}`}
        />
      </div>
    </div>
  )
}
