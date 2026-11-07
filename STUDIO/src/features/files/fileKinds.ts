import { fileTypeOf, splitFilePath } from '@/components/icons/fileTypes'

/**
 * What can be done with a kind of file. This table is the one place that says
 * so: add a type here and the menu and the viewer follow.
 *
 * It decides what to offer, not what is allowed. The native host and the harness
 * each hold their own limit, so a wrong row costs a refused click, never a launch
 * or a leak. `opens` must stay within `INERT_EXTENSIONS` in `open_file.rs`.
 */

export type FileKind =
  | 'markdown' | 'text' | 'page' | 'code' | 'picture' | 'media' | 'document'
  | 'program' | 'secret' | 'folder' | 'other'

/** How the viewer draws a kind, or null where it cannot. */
export type FilePreviewMode = 'markdown' | 'text' | 'picture'

interface FileKindTraits {
  readonly preview: FilePreviewMode | null
  /** Windows may hand it to its own app. */
  readonly opens: boolean
  /** An editor can show it usefully. */
  readonly edits: boolean
}

const TRAITS: Readonly<Record<FileKind, FileKindTraits>> = {
  markdown: { preview: 'markdown', opens: true, edits: true },
  text: { preview: 'text', opens: true, edits: true },
  page: { preview: 'text', opens: true, edits: true },
  // No `opens`: the association for many of these runs them.
  code: { preview: 'text', opens: false, edits: true },
  picture: { preview: 'picture', opens: true, edits: false },
  media: { preview: null, opens: true, edits: false },
  document: { preview: null, opens: true, edits: false },
  program: { preview: null, opens: false, edits: false },
  secret: { preview: null, opens: false, edits: true },
  folder: { preview: null, opens: false, edits: true },
  other: { preview: null, opens: false, edits: true },
}

const BY_EXTENSION: Readonly<Record<string, FileKind>> = Object.fromEntries(
  ([
    ['markdown', 'md markdown'],
    ['text', 'txt log csv tsv json yaml yml'],
    ['page', 'html htm'],
    ['picture', 'png jpg jpeg webp gif avif svg bmp ico heic tif tiff'],
    ['media', 'mp4 m4v mov webm mkv avi mp3 wav flac ogg m4a aac opus'],
    ['document', 'pdf docx xlsx pptx odt ods odp rtf'],
    ['program', 'exe msi com scr dll sys lnk url zip 7z rar tar gz jar'],
    ['secret', 'pem key pfx p12 crt cer'],
  ] as const).flatMap(([kind, list]) => list.split(' ').map((extension) => [extension, kind])),
)

/** Pictures the harness will serve to the viewer; the rest open in their own app. */
const SHOWN_PICTURES = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'svg'])

function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? null : name.slice(dot + 1).toLowerCase()
}

export function fileKindOf(path: string, folder: boolean): FileKind {
  if (folder) return 'folder'
  const { name } = splitFilePath(path)
  if (/^\.env(?:\.|$)/i.test(name)) return 'secret'
  const known = BY_EXTENSION[extensionOf(name) ?? '']
  if (known !== undefined) return known
  // Anything with a language mark is source: `.ts`, `.py`, a `Dockerfile`.
  return fileTypeOf(path) === null ? 'other' : 'code'
}

export function traitsOf(kind: FileKind, path: string): FileKindTraits {
  const traits = TRAITS[kind]
  if (traits.preview !== 'picture') return traits
  const shown = SHOWN_PICTURES.has(extensionOf(splitFilePath(path).name) ?? '')
  return shown ? traits : { ...traits, preview: null }
}
