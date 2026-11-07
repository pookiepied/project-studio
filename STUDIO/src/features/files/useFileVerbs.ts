import { useEffect, useState } from 'react'
import { copyText } from '@/lib/clipboard'
import { installedEditors, openFile, openInEditor, type EditorChoice } from '@/platform/tauri/files'
import { revealPath } from '@/platform/tauri/reveal'
import { isTauri } from '@/platform/tauri/window'
import { traitsOf } from './fileKinds'
import type { LocatedFile } from './useLocatedFile'

/** One thing a person can do with a file. `id` is stable for keys and tests. */
export interface FileVerb {
  readonly id: string
  readonly label: string
  readonly icon: 'preview' | 'open' | 'editor' | 'vscode' | 'cursor' | 'folder'
  readonly run: () => Promise<void>
}

/** Native refusals are fixed sentences; anything else is not shown to a person. */
function sentence(failure: unknown, fallback: string): string {
  return typeof failure === 'string' && failure !== '' ? failure : fallback
}

/**
 * The verbs for a file, in the order they read best: look at it here, open it in
 * its own app, open it in an editor, find it on disk. Copying is separate
 * because it needs no desktop and answers with "Copied" rather than closing.
 */
export function useFileVerbs(file: LocatedFile | null, preview: (() => void) | null) {
  const [editors, setEditors] = useState<readonly EditorChoice[]>([])
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Asked as the menu opens rather than once the file is found, so the editor rows
  // arrive with the others instead of a moment after them.
  useEffect(() => {
    let live = true
    void installedEditors().then((found) => { if (live) setEditors(found) })
    return () => { live = false }
  }, [])

  const verbs: FileVerb[] = []
  if (file !== null) {
    const traits = traitsOf(file.kind, file.path)
    const { path, line, column } = file
    if (preview !== null && traits.preview !== null && file.inConversation) {
      verbs.push({ id: 'preview', label: 'Preview', icon: 'preview', run: () => Promise.resolve(preview()) })
    }
    if (isTauri()) {
      if (traits.opens) {
        verbs.push({ id: 'open', label: file.kind === 'page' ? 'Open in browser' : 'Open', icon: 'open', run: () => openFile(path) })
      }
      if (traits.edits) {
        for (const editor of editors) {
          verbs.push({ id: `editor:${editor.id}`, label: `Open in ${editor.label}`,
            icon: editor.id === 'vscode' || editor.id === 'cursor' ? editor.id : 'editor',
            run: () => openInEditor(editor.id, path, line, column) })
        }
      }
      verbs.push({ id: 'reveal', label: file.kind === 'folder' ? 'Open in File Explorer' : 'Show in folder', icon: 'folder',
        run: () => revealPath(path) })
    }
  }

  /** Resolves true when the verb worked, so a menu knows to close. */
  const run = async (verb: FileVerb): Promise<boolean> => {
    setError(null)
    try {
      await verb.run()
      return true
    } catch (failure) {
      setError(sentence(failure, `${verb.label} did not work.`))
      return false
    }
  }

  const copy = (text: string) => {
    void copyText(text).then((done) => setCopied(done), () => setCopied(false))
  }

  return { verbs, run, error, copied, copy }
}
