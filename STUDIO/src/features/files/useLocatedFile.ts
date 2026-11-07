import { useEffect, useState } from 'react'
import { useOptionalWorkspace } from '@/stores/workspace'
import { fileKindOf, type FileKind } from './fileKinds'
import { namesFolder, type PathReference } from './pathReference'

/** A reference once it has been matched to a real place. */
export interface LocatedFile {
  /** The full path to act on. */
  readonly path: string
  readonly kind: FileKind
  readonly line: number | null
  readonly column: number | null
  /** Inside this conversation's folders, so the harness will show its contents. */
  readonly inConversation: boolean
  /** Other files that fit the same reference; `path` is the newest of them. */
  readonly others: number
}

export type FileLookup =
  | { readonly state: 'idle' | 'locating' }
  /** Nothing fits, or the place is not on this computer. `reason` says which. */
  | { readonly state: 'missing'; readonly reason: string }
  | { readonly state: 'found'; readonly file: LocatedFile }

const NOT_FOUND = 'Not found in this conversation’s folders.'
const NETWORK = 'This path is on another computer.'
const UNREACHABLE = 'Studio could not look for this file. The harness is not responding.'

/**
 * Where a reference really is, asked only once `active`.
 *
 * A reply usually names a file as loosely as `climate-change.md`, and only the
 * harness knows the folders this conversation works in, so the harness answers.
 * Nothing is asked until a person opens the menu: a transcript of paths must not
 * turn into a transcript of disk reads.
 *
 * A full Windows path the harness does not recognise is still that path. It may
 * be anywhere on this computer, and the native side checks it when it is used.
 */
export function useLocatedFile(reference: PathReference, conversationId: string | null, active: boolean): FileLookup {
  const workspace = useOptionalWorkspace()
  const locate = workspace?.locateFile
  const [lookup, setLookup] = useState<FileLookup>({ state: 'idle' })

  useEffect(() => {
    if (!active) return
    const asWritten = (): FileLookup => reference.kind === 'windows'
      ? { state: 'found', file: {
          path: reference.target,
          kind: fileKindOf(reference.target, namesFolder(reference)),
          line: reference.line,
          column: reference.column,
          inConversation: false,
          others: 0,
        } }
      : { state: 'missing', reason: NOT_FOUND }

    if (reference.kind === 'network') {
      setLookup({ state: 'missing', reason: NETWORK })
      return
    }
    if (conversationId === null || locate === undefined) {
      setLookup(asWritten())
      return
    }
    let live = true
    setLookup({ state: 'locating' })
    void locate(conversationId, reference.target).then((result) => {
      if (!live) return
      if (!result.ok) {
        setLookup(reference.kind === 'windows' ? asWritten() : { state: 'missing', reason: UNREACHABLE })
        return
      }
      const found = result.value
      setLookup(found === null ? asWritten() : { state: 'found', file: {
        path: found.path,
        kind: fileKindOf(found.path, found.kind === 'folder'),
        line: reference.line,
        column: reference.column,
        inConversation: true,
        others: found.others,
      } })
    })
    return () => { live = false }
  }, [active, conversationId, locate, reference])

  return lookup
}
