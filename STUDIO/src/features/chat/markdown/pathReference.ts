/**
 * What a path a reply mentions is, decided before any of it is clickable.
 *
 * Model output is untrusted display data, and the only thing this module may
 * turn it into is a description: what the reference names, and what kind of
 * place it points at. Nothing here touches the filesystem and nothing here
 * decides to act - the component acts on an explicit click, and the native
 * side validates again. Recognition is deliberately conservative in both
 * directions:
 *
 * - A rooted reference (drive letter, UNC share, leading slash) is always
 *   clear enough to name a file or a directory, extension or not. That is the
 *   only way `C:\\Apps\\Studio` or `C:\\Apps\\Studio\\Studio.exe` become
 *   references without a hand-maintained list of every extension that exists.
 * - Relative references need a separator or a file extension. Bare words
 *   remain prose. Spaces and shell punctuation are ordinary filename data;
 *   the native boundary uses navigation APIs, never command interpretation.
 */

export type PathReferenceKind =
  /** A Windows absolute path: `C:\\...`. Openable on this computer. */
  | 'windows'
  /** A UNC path: `\\\\server\\share\\...`. Another computer's filesystem. */
  | 'network'
  /** A POSIX absolute path: `/home/...`. Not a Windows path at all. */
  | 'unix'
  /** Everything else, resolved against the conversation's workspace. */
  | 'relative'

export interface PathReference {
  /** The reference exactly as the reply wrote it, suffix included. */
  readonly raw: string
  /** The filesystem path the reference names, suffix and any `file:` spelling removed. */
  readonly target: string
  /** A trailing `:line` / `:line:column` on the reference, when it carried one. */
  readonly line: number | null
  readonly column: number | null
  readonly kind: PathReferenceKind
}

/** Bare filenames need an extension; a separator already makes a path explicit. */
const EXTENSION = /\.[a-z0-9][a-z0-9_-]*$/i

const DRIVE = /^[A-Za-z]:[\\/]/
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/
const COMMAND_TAIL = /\.(?:exe|com|bat|cmd|ps1|sh)\s+(?:[-/]|[&|])/i
const FORBIDDEN = /["<>|*?]/

/** Control characters cannot appear in a path anyone means to open. */

function hasControlCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code < 0x20 || code === 0x7F) return true
  }
  return false
}

/**
 * Reads a path reference out of inline text, or null when the text is not one.
 *
 * A trailing `:line` or `:line:column` is display metadata, not part of the
 * path - but it is stripped only when what remains still names something,
 * which is what keeps the drive-letter colon from ever reading as a line
 * number: stripping `C:42` leaves `C`, and `C` is not a path, so the whole
 * string is not a reference.
 */
export function parsePathReference(text: string): PathReference | null {
  if (text === '' || text !== text.trim() || hasControlCharacter(text)) return null
  if (text.startsWith('~') || /^%[^%]+%/.test(text)) return null
  if (text.startsWith('::')) return null

  let raw = text
  let line: number | null = null
  let column: number | null = null
  const suffix = /^(.+?):(\d+)(?::(\d+))?$/.exec(raw)
  if (suffix !== null) {
    raw = suffix[1]
    line = Number(suffix[2])
    column = suffix[3] === undefined ? null : Number(suffix[3])
  }
  if ((line !== null && !Number.isSafeInteger(line)) || (column !== null && !Number.isSafeInteger(column))) return null

  let target = raw
  let kind: PathReferenceKind
  if (/^file:/i.test(target)) {
    try {
      const url = new URL(target)
      if (url.search !== '' || url.hash !== '') return null
      const pathname = decodeURIComponent(url.pathname)
      target = url.hostname !== '' && url.hostname !== 'localhost'
        ? `\\\\${url.hostname}${pathname.replace(/\//g, '\\')}`
        : /^\/[A-Za-z]:[\\/]/.test(pathname)
          ? pathname.slice(1).replace(/\//g, '\\')
          : pathname
    } catch {
      return null
    }
  }
  if (hasControlCharacter(target) || FORBIDDEN.test(target) || COMMAND_TAIL.test(target)) return null
  if (DRIVE.test(target)) {
    kind = 'windows'
  } else if (SCHEME.test(target)) {
    // Any other scheme - `http:`, `shell:`, `studio-file:` - is not a
    // filesystem reference, whatever follows the colon.
    return null
  } else if (/^[\\/]{2}[.?][\\/]/.test(target)) {
    // Device paths are namespace objects, not folders a person browses.
    return null
  } else if (/^[\\/]{2}/.test(target)) {
    kind = 'network'
  } else if (target.startsWith('/')) {
    kind = 'unix'
  } else {
    kind = 'relative'
  }

  // Alternate data streams and extra schemes are not browsable items.
  if ((kind === 'windows' ? target.slice(2) : target).includes(':')) return null
  const root = /^[A-Za-z]:[\\/]+$/.test(target)
  const directory = /[\\/]$/.test(target)
  if (root) target = `${target.slice(0, 2)}\\`
  else if (target !== '/') target = target.replace(/[\\/]+$/, '')

  const lastSeparator = Math.max(target.lastIndexOf('\\'), target.lastIndexOf('/'))
  const finalSegment = target.slice(lastSeparator + 1)
  if (!directory && lastSeparator === -1 && !EXTENSION.test(finalSegment) && kind === 'relative') return null
  if (target === '') return null

  return { raw: text, target, line, column, kind }
}

/** Files that carry no extension, which would otherwise read as folders. */
const EXTENSIONLESS_FILES = /^(?:makefile|dockerfile|license|licence|readme|changelog|notice|gemfile|rakefile|procfile|jenkinsfile)$/i

/**
 * Whether a reference reads as a folder, for choosing its mark and nothing else.
 *
 * A trailing separator says so outright. Past that this is a best reading: a
 * path with a separator and no extension is nearly always a directory. Nothing
 * touches the disk to settle it, and being wrong costs one glyph. Reveal never
 * consults this; the native side decides what a path is.
 */
export function namesFolder(reference: PathReference): boolean {
  if (reference.line !== null) return false
  const written = reference.raw
  if (/[\\/]$/.test(written)) return true
  const separator = Math.max(written.lastIndexOf('\\'), written.lastIndexOf('/'))
  if (separator === -1) return false
  const name = written.slice(separator + 1)
  return !name.includes('.') && !EXTENSIONLESS_FILES.test(name)
}

/**
 * The absolute path a reference names, or null when this client cannot name
 * one. Rooted kinds already carry their answer; a relative reference is
 * resolved against the workspace its own conversation stands in - never
 * against this window's process directory, and never against another
 * conversation's workspace.
 */
export function resolvePathReference(reference: PathReference, workspaceRoot: string | null): string | null {
  if (reference.kind !== 'relative') return reference.target
  if (workspaceRoot === null || workspaceRoot === '') return null
  return joinWindowsPath(workspaceRoot, reference.target)
}

/**
 * Join a relative reference onto a workspace root, with Windows semantics and
 * no filesystem access. Traversal stops at the volume or UNC share root,
 * matching Windows path resolution without replacing a server or share.
 */
function joinWindowsPath(root: string, relative: string): string | null {
  const network = /^[\\/]{2}[^\\/]+[\\/][^\\/]+/.test(root)
  if (!DRIVE.test(root) && !network) return null
  const parts = root.split(/[\\/]/).filter((segment) => segment !== '')
  const floor = network ? 2 : 1
  for (const segment of relative.split(/[\\/]/)) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      // Traversal cannot replace a volume, server or share.
      if (parts.length > floor) parts.pop()
      continue
    }
    parts.push(segment)
  }
  return `${network ? '\\\\' : ''}${parts.join('\\')}${parts.length === 1 ? '\\' : ''}`
}
