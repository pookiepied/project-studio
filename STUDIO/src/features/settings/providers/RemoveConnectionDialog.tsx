import { useState } from 'react'
import { Button, Dialog } from '@/components/primitives'
import type { HarnessFailure, ProviderConnection } from '@/platform/harness'

/**
 * Confirming a removal.
 *
 * The connection is named in the sentence rather than referred to as "this
 * connection", because the button that opened this sits in a list of rows that
 * look alike, and a confirmation that does not say which row it means is a
 * confirmation nobody can actually check.
 *
 * What happens to the key is stated for the same reason, and it has two
 * answers since the stores were merged. A key typed into this app is deleted
 * with the connection. A key carried over from an older build - kept under the
 * vendor's own name from the days before connections had keys of their own -
 * stays, which is why connecting the same vendor again may not ask for it
 * again. Both are said, because a sentence that is only half true about where
 * a secret lives is worse than a long sentence.
 *
 * Filled red is right here and wrong in the list. This is the step where the
 * choice has already been narrowed to yes or no, which is the one place
 * `danger` earns being the loudest thing on screen - see Button's docblock.
 */
export function RemoveConnectionDialog({
  connection,
  onClose,
  onRemove,
}: {
  /** Null when nothing is being removed. Doubles as the open flag. */
  connection: ProviderConnection | null
  onClose: () => void
  /** Resolves to the failure to show, or null when it was removed. */
  onRemove: (id: string) => Promise<HarnessFailure | null>
}) {
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<HarnessFailure | null>(null)

  const close = () => {
    setBusy(false)
    setFailure(null)
    onClose()
  }

  const confirm = async () => {
    if (connection === null || busy) return
    setBusy(true)
    setFailure(null)

    const error = await onRemove(connection.id)
    if (error === null) {
      close()
      return
    }
    setBusy(false)
    setFailure(error)
  }

  return (
    <Dialog
      open={connection !== null}
      onClose={close}
      title="Remove connection"
      width="24rem"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="danger" busy={busy} onClick={() => void confirm()}>
            Remove
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 pt-1">
        <p className="text-ui text-foreground">
          Remove {connection?.displayName ?? 'this connection'}?
        </p>
        <p className="text-caption text-muted-foreground">
          The API key stored with it is deleted from this machine's credential store. A key carried
          over from an earlier version of Studio stays; connecting the same vendor again can find it
          without retyping. Conversations that sent their turns through this connection will say so
          on their next send.
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
