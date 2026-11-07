import { Icons } from '@/components/icons'
import { Fragment } from 'react'
import { splitFilePath } from '@/components/icons/fileTypes'
import { MenuItem, MenuLabel, MenuSeparator, MenuViews } from '@/components/primitives'
import type { FileVerb } from './useFileVerbs'
import { useFileVerbs } from './useFileVerbs'
import type { FileLookup } from './useLocatedFile'

export const FILE_VERB_ICONS = {
  preview: Icons.vision,
  open: Icons.openExternal,
  editor: Icons.coding,
  vscode: Icons.editorVsCode,
  cursor: Icons.editorCursor,
  folder: Icons.projectOpen,
} as const

/**
 * What a file reference opens: what can be done with the file. The rows come from
 * its kind, so an image and a script offer different things, and nothing is offered
 * that can only fail. The full path stays behind Copy path: the file's name says
 * which file this is, and the verbs are what a person came for. Rows sit in the
 * three groups a person chooses between, as the app's other menus do: look at it,
 * work on it, find it.
 *
 * `MenuViews` carries the height, because the rows only arrive once the file is
 * found and the panel should grow to them, not jump.
 */
export function FileMenu({ lookup, written, onPreview, onDone }: {
  lookup: FileLookup
  /** The reference as the reply wrote it, which is all there is to copy if nothing was found. */
  written: string
  onPreview: (() => void) | null
  onDone: () => void
}) {
  const file = lookup.state === 'found' ? lookup.file : null
  const { verbs, run, error, copied, copy } = useFileVerbs(file, onPreview)
  const select = (verb: FileVerb) => { void run(verb).then((done) => { if (done) onDone() }) }

  const groups = [
    verbs.filter((verb) => verb.id === 'preview' || verb.id === 'open'),
    verbs.filter((verb) => verb.id.startsWith('editor:')),
    verbs.filter((verb) => verb.id === 'reveal'),
  ]
  const shown = groups.filter((group, index) => group.length > 0 || index === groups.length - 1)
  return (
    <MenuViews view="file" depth={0}>
      <div className="flex min-w-0 flex-col">
        <MenuLabel><span className="block truncate">{splitFilePath(file?.path ?? written).name}</span></MenuLabel>
        {file !== null && file.line !== null ? (
          <p className="px-2 pb-1 text-micro text-muted-foreground">
            Line {file.line}{file.column !== null ? `, column ${file.column}` : ''}
          </p>
        ) : null}
        {file !== null && file.others > 0 ? (
          <p className="px-2 pb-1 text-micro text-muted-foreground">
            Newest of {file.others + 1} files with this name.
          </p>
        ) : null}
        {lookup.state === 'locating' ? <p className="px-2 pb-1.5 text-caption text-muted-foreground">Finding file…</p> : null}
        {lookup.state === 'missing' ? <p className="px-2 pb-1.5 text-caption text-muted-foreground">{lookup.reason}</p> : null}
        {error !== null ? <p role="alert" className="px-2 py-1 text-caption text-danger">{error}</p> : null}
        {shown.map((group, index) => (
          <Fragment key={index}>
            {index > 0 ? <MenuSeparator /> : null}
            {group.map((verb) => {
              const Mark = FILE_VERB_ICONS[verb.icon]
              return <MenuItem key={verb.id} icon={<Mark />} onSelect={() => select(verb)}>{verb.label}</MenuItem>
            })}
            {index === shown.length - 1 && lookup.state !== 'locating' ? (
              <MenuItem icon={copied ? <Icons.check /> : <Icons.copy />} onSelect={() => copy(file?.path ?? written)}>
                {copied ? 'Copied' : file !== null ? 'Copy path' : 'Copy name'}
              </MenuItem>
            ) : null}
          </Fragment>
        ))}
      </div>
    </MenuViews>
  )
}
