import { useState } from 'react'
import { Button, Dialog } from '@/components/primitives'
import type { HarnessFailure } from '@/platform/harness'

/**
 * Confirming a real delete.
 *
 * Archive is recoverable and destroys nothing; delete is permanent and
 * destroys everything the conversation owns. The dialog names the
 * conversation and says what goes, because the button that opened it sits in
 * a list of rows that look alike and a confirmation that does not say which
 * row it means is one nobody can actually check.
 *
 * What goes is stated in one line - the conversation and everything it
 * holds - rather than as the inventory it used to be. The inventory was the
 * implementation listing itself (files, transcript, attachments, queue,
 * permissions, extension choices), and nobody weighing a delete needs the
 * list to know the answer; the row's own menu item had carried a shorter
 * copy of the same list, so the warning was read twice before the dialog
 * even opened. The menu says Delete, the dialog says what that means, once.
 * A running conversation is refused by the harness rather than
 * deleted, and the refusal arrives here verbatim - the failure sentence is
 * evidence, never the headline, so it renders as the alert under the copy.
 *
 * Filled red is right here and wrong in the list. This is the step where the
 * choice has already been narrowed to yes or no, which is the one place
 * `danger` earns being the loudest thing on screen - see Button's docblock.
 */
export function DeleteConversationDialog({
  conversation,
  onClose,
  onDelete,
}: {
  /** Null when nothing is being deleted. Doubles as the open flag. */
  conversation: { readonly id: string; readonly title: string | null } | null
  onClose: () => void
  /** Resolves to the failure to show, or null when it was deleted. */
  onDelete: (id: string) => Promise<HarnessFailure | null>
}) {
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<HarnessFailure | null>(null)

  const close = () => {
    setBusy(false)
    setFailure(null)
    onClose()
  }

  const confirm = async () => {
    if (conversation === null || busy) return
    setBusy(true)
    setFailure(null)

    const error = await onDelete(conversation.id)
    if (error === null) {
      close()
      return
    }
    setBusy(false)
    setFailure(error)
  }

  return (
    <Dialog
      open={conversation !== null}
      onClose={close}
      title="Delete conversation"
      width="24rem"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={close}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" busy={busy} onClick={() => void confirm()}>
            Delete
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 pt-1">
        <p className="text-ui text-foreground">
          Delete {conversation?.title ?? 'this conversation'}?
        </p>
        <p className="text-caption text-muted-foreground">
          This removes the conversation and everything it holds. It cannot be undone.
        </p>
        {failure ? (
          <p role="alert" className="text-caption text-danger">
            {failure.message}
          </p>
        ) : null}
      </div>
    </Dialog>
  )
}
