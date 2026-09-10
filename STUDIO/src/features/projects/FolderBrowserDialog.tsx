import { useCallback, useEffect, useRef, useState } from 'react'

import { Icons } from '@/components/icons'
import { Button, Dialog, IconButton } from '@/components/primitives'
import { StateNote } from '@/components/state/StateNote'
import type { FolderListing } from '@/platform/harness'
import { useWorkspace } from '@/stores/workspace'
import { cn } from '@/lib/cn'

/**
 * The PC's folders, listed by the harness and walked in a dialog.
 *
 * ---- Why this exists -------------------------------------------------------
 *
 * A folder is chosen on the machine it lives on. The desktop app opens the
 * operating system's own picker; a browser tab has no such dialog to reach
 * for, and the file system being chosen is the PC's, not the phone's (plan
 * step 6). So the harness lists directories over the same admitted connection
 * everything else uses, and this dialog walks the answers. It is also, per
 * the plan, the honest answer for the desktop app's own future needs - which
 * is why it is a real picker and not a shim over the native one.
 *
 * ---- The shape -------------------------------------------------------------
 *
 * One position, one list, one way back. The current directory reads as an
 * address at the top, with Up beside it; every row is a directory that opens
 * itself on click; `Use this folder` chooses the position the person is
 * standing in. That last part is the deliberate difference from a picker that
 * only chooses rows: the person may want a directory they navigated *to*,
 * which is how the native dialog works too, and a list of folders with no way
 * to say "this one" would force picking a child and walking back up.
 *
 * Reading is wider than choosing, on purpose: the listing reaches volume
 * roots and system directories because those are positions a person walks
 * through, and the wall stays where the choice is made - the folder write,
 * whose refusal NewProjectDialog carries verbatim.
 *
 * ---- Two async rules -------------------------------------------------------
 *
 * A failed navigation keeps the last good listing and says why above it: the
 * person is one row away from where they were, not stranded in a dead
 * position. And the newest navigation always wins: two rows opened in quick
 * succession must land the person where they last asked to go, never where an
 * earlier, slower answer said.
 */
export function FolderBrowserDialog({
  open,
  onClose,
  onPick,
}: {
  open: boolean
  onClose: () => void
  /** The directory the person chose, as the harness spelled it. */
  onPick: (path: string) => void
}) {
  const { browseFolders } = useWorkspace()
  const [listing, setListing] = useState<FolderListing | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // The newest navigation wins: each ask takes a number, and an answer may
  // only land while it is still the newest. Without this, a slow first ask
  // overtakes a fast second one and the list lies about where the person is.
  const requestRef = useRef(0)

  const load = useCallback(
    async (path?: string) => {
      const seq = ++requestRef.current
      setLoading(true)
      const result = await browseFolders(path)
      if (seq !== requestRef.current) return
      setLoading(false)
      if (!result.ok) {
        // The last good listing stays on screen; the sentence says why the
        // ask failed and the rows still lead somewhere else.
        setFailure(result.error.message)
        return
      }
      setFailure(null)
      setListing(result.value)
    },
    [browseFolders],
  )

  // Every open starts the walk from the top: the harness answers the first
  // ask with the person's home, so nothing here needs to know where home is,
  // and a second open is a fresh walk rather than yesterday's position.
  useEffect(() => {
    if (!open) return
    setListing(null)
    setFailure(null)
    void load()
  }, [open, load])

  const pick = () => {
    if (listing === null || loading) return
    onPick(listing.path)
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Choose a folder"
      width="24rem"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={listing === null || loading} onClick={pick}>
            Use this folder
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        {/* The position, reading as an address, with the way back out beside
            it - the file-dialog arrangement, so Up sits where a person who
            has used a picker already looks for it. Disabled while nothing is
            listed yet, and at the top of the walk, where up would land where
            the person already is. */}
        <div className="flex items-center gap-1.5">
          <IconButton
            label="Up"
            size="sm"
            disabled={listing === null || listing.parent === null || loading}
            onClick={() => {
              if (listing?.parent != null) void load(listing.parent)
            }}
          >
            <Icons.back size="sm" />
          </IconButton>
          <span
            className="min-w-0 flex-1 truncate font-mono text-caption text-muted-foreground"
            title={listing?.path}
          >
            {listing?.path}
          </span>
        </div>

        {failure !== null ? (
          <StateNote title="That directory could not be listed." detail={failure} />
        ) : null}

        {listing === null ? (
          <p aria-live="polite" className="text-caption text-muted-foreground">
            {loading ? 'Listing the folders on this PC…' : null}
          </p>
        ) : (
          <div
            aria-busy={loading}
            className={cn(
              'studio-scroll-bounded max-h-64 overflow-y-auto',
              loading && 'opacity-60',
            )}
          >
            {listing.directories.length === 0 ? (
              <p className="px-2 py-1.5 text-micro text-muted-foreground/80">No folders inside.</p>
            ) : (
              <div className="flex flex-col gap-0.5">
                {listing.directories.map((directory) => (
                  <button
                    key={directory.path}
                    type="button"
                    onClick={() => void load(directory.path)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-ui text-foreground transition-colors duration-fast hover:bg-tint"
                  >
                    <span className="shrink-0 text-muted-foreground">
                      <Icons.projectOpen size="sm" />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{directory.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
  )
}
