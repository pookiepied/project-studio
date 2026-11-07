import { describe, expect, it } from 'vitest'
import { namesFolder, parsePathReference, resolvePathReference, type PathReference } from './pathReference'

/** A reference the test asserts on; a null would be a broken fixture. */
function reference(text: string): PathReference {
  const parsed = parsePathReference(text)
  if (parsed === null) throw new Error(`fixture is not a reference: ${text}`)
  return parsed
}

/**
 * What counts as a path a reply mentioned, decided before anything is
 * clickable. The boundaries that matter: the drive colon is never a line
 * number, a command tail is not a path, and a rooted reference is one
 * whatever its extension - the whole reason directories and executables
 * work without a hand-kept list.
 */
describe('parsePathReference', () => {
  it('reads rooted Windows paths whatever their extension', () => {
    for (const [text, target] of [
      ['C:\\Apps\\Studio', 'C:\\Apps\\Studio'],
      ['C:\\Apps\\Studio\\Studio.exe', 'C:\\Apps\\Studio\\Studio.exe'],
      ['C:/Apps/Studio/Studio.exe', 'C:/Apps/Studio/Studio.exe'],
      ['D:\\data\\report.pdf', 'D:\\data\\report.pdf'],
      ['C:\\Übersicht\\日期.md', 'C:\\Übersicht\\日期.md'],
    ] as const) {
      const reference = parsePathReference(text)
      expect(reference?.kind, text).toBe('windows')
      expect(reference?.target, text).toBe(target)
    }
  })

  it('keeps the drive colon and the reference whole while reading a line suffix', () => {
    const reference = parsePathReference('C:\\Project\\src\\app.ts:42:7')
    expect(reference).not.toBeNull()
    expect(reference?.raw).toBe('C:\\Project\\src\\app.ts:42:7')
    expect(reference?.target).toBe('C:\\Project\\src\\app.ts')
    expect(reference?.line).toBe(42)
    expect(reference?.column).toBe(7)
    expect(reference?.kind).toBe('windows')
    expect(parsePathReference('report.md:3')?.line).toBe(3)
    // Drive-relative references have no stable location; drive roots do.
    expect(parsePathReference('C:42')).toBeNull()
    expect(parsePathReference('C:\\')?.target).toBe('C:\\')
    // A clock is not a line reference, whatever the suffix shape says.
    expect(parsePathReference('12:30')).toBeNull()
    // Three levels of suffix is nothing this feature claimed to read.
    expect(parsePathReference('app.ts:42:7:9')).toBeNull()
  })

  it('recognises a file in a spaced directory but not a command tail', () => {
    expect(parsePathReference('C:\\Program Files\\Studio\\app.ts')?.kind).toBe('windows')
    // The final segment holding the arguments is the executable's command
    // line, and this feature does not act on command lines.
    expect(parsePathReference('C:\\Apps\\Studio\\Studio.exe --flag')).toBeNull()
    expect(parsePathReference('C:\\Windows\\system32\\cmd.exe /c whoami')).toBeNull()
    expect(parsePathReference('C:\\a.exe & C:\\b.exe')).toBeNull()
    expect(parsePathReference('C:\\My Docs\\My File.txt')?.target).toBe('C:\\My Docs\\My File.txt')
    expect(parsePathReference('%APPDATA%\\x.png')).toBeNull()
  })

  it('refuses schemes, URIs, namespaces and device paths', () => {
    for (const text of [
      'https://example.com/chart.png',
      'http://localhost:3000/api/report',
      'shell:Downloads',
      'shell:::{20D04FE0-3AEA-1069-A2D8-08002B30309D}',
      '::{20D04FE0-3AEA-1069-A2D8-08002B30309D}',
      '\\\\.\\pipe\\studio',
      '\\\\?\\C:\\Windows',
      'javascript:alert(1)',
      'studio-file:%ZZ',
    ]) {
      expect(parsePathReference(text), text).toBeNull()
    }
  })

  it('names network paths as network paths without probing them', () => {
    expect(parsePathReference('\\\\server\\share\\file.txt')?.kind).toBe('network')
    expect(parsePathReference('//server/share/file.txt')?.kind).toBe('network')
  })

  it('names POSIX absolute paths as unavailable, not as guesses', () => {
    const reference = parsePathReference('/home/user/report.md')
    expect(reference?.kind).toBe('unix')
    expect(reference?.target).toBe('/home/user/report.md')
  })

  it('reads a file: address as the path it spells', () => {
    const reference = parsePathReference('file:///C:/docs/plot.png')
    expect(reference?.kind).toBe('windows')
    expect(reference?.target).toBe('C:\\docs\\plot.png')
    expect(parsePathReference('file:///home/user/plot.png')?.kind).toBe('unix')
    expect(parsePathReference('file:///C:/docs/report%20final.pdf')?.target).toBe('C:\\docs\\report final.pdf')
    expect(parsePathReference('file://localhost/C:/docs/plot.png')?.kind).toBe('windows')
    expect(parsePathReference('file://server/share/plot.png')?.kind).toBe('network')
    expect(parsePathReference('file:///C:/bad%ZZ.txt')).toBeNull()
    expect(parsePathReference('file:///C:/bad%00.txt')).toBeNull()
  })

  it('accepts ordinary Windows names without interpreting shell punctuation', () => {
    for (const text of ['C:\\Program Files', "C:\\O'Brien\\R&D; 50%.txt", 'docs/My Report.pdf', 'C:/']) {
      expect(parsePathReference(text), text).not.toBeNull()
    }
    expect(parsePathReference('C:\\report.txt:secret')).toBeNull()
  })

  it('accepts relative references only when they are file-shaped', () => {
    for (const text of ['workspace/chart.png', 'report.pdf', './build/out.js', '../shared/types.ts']) {
      expect(parsePathReference(text)?.kind, text).toBe('relative')
    }
    expect(parsePathReference('src/features')?.kind).toBe('relative')
    expect(parsePathReference('./docs/')?.target).toBe('./docs')
    for (const text of ['README', 'npm i', 'npm i vite', 'it "quoted"']) {
      expect(parsePathReference(text), text).toBeNull()
    }
  })

  it('recognises executables, shortcuts and archives as relative references too', () => {
    for (const text of ['Studio.exe', 'setup.msi', 'run.ps1', 'backup.zip', 'bundle.tar.gz']) {
      expect(parsePathReference(text)?.kind, text).toBe('relative')
    }
  })

  it('trims a trailing separator instead of naming nothing', () => {
    const reference = parsePathReference('C:\\Projects\\')
    expect(reference?.target).toBe('C:\\Projects')
  })

  it('rejects whitespace padding and forbidden characters', () => {
    expect(parsePathReference(' app.ts')).toBeNull()
    expect(parsePathReference('C:\\a\nb')).toBeNull()
    expect(parsePathReference('C:\\a\u{0000}b')).toBeNull()
    expect(parsePathReference('C:\\it"s.png')).toBeNull()
    expect(parsePathReference('reports/*.pdf')).toBeNull()
  })
})

/**
 * Resolution joins a relative reference onto the conversation's workspace -
 * and onto nothing else. There is no process directory to fall back to.
 */
describe('namesFolder', () => {
  const folder = (text: string) => {
    const reference = parsePathReference(text)
    if (reference === null) throw new Error('not a reference')
    return namesFolder(reference)
  }

  it('reads a trailing separator and an extensionless path as a folder', () => {
    expect(folder('src/features/')).toBe(true)
    expect(folder('C:\\Apps\\Studio')).toBe(true)
    expect(folder('src/features')).toBe(true)
  })

  it('leaves files alone, including the ones with no extension', () => {
    expect(folder('src/App.tsx')).toBe(false)
    expect(folder('README.md')).toBe(false)
    expect(folder('tools/Makefile')).toBe(false)
    expect(folder('src/.gitignore')).toBe(false)
    expect(folder('src/main:12')).toBe(false)
  })
})

describe('resolvePathReference', () => {
  it('joins a relative reference onto the workspace it belongs to', () => {
    const docs = reference('docs/readme.md')
    expect(resolvePathReference(docs, 'C:\\Work\\Proj')).toBe('C:\\Work\\Proj\\docs\\readme.md')
    expect(resolvePathReference(docs, 'C:\\Work\\Proj\\')).toBe('C:\\Work\\Proj\\docs\\readme.md')
  })

  it('climbs with .. and stops at the drive root', () => {
    expect(resolvePathReference(reference('../shared/x.ts'), 'C:\\Work\\Proj\\sub'))
      .toBe('C:\\Work\\Proj\\shared\\x.ts')
    expect(resolvePathReference(reference('..\\..\\..\\x.png'), 'C:\\Work'))
      .toBe('C:\\x.png')
  })

  it('keeps a UNC workspace whole', () => {
    expect(resolvePathReference(reference('notes/todo.txt'), '\\\\server\\share'))
      .toBe('\\\\server\\share\\notes\\todo.txt')
    expect(resolvePathReference(reference('../../notes.txt'), '\\\\server\\share'))
      .toBe('\\\\server\\share\\notes.txt')
    expect(resolvePathReference(reference('notes.txt'), '/home/user')).toBeNull()
    expect(resolvePathReference(reference('notes.txt'), 'C:relative')).toBeNull()
  })

  it('resolves nothing when there is no workspace to resolve against', () => {
    expect(resolvePathReference(reference('docs/readme.md'), null)).toBeNull()
  })

  it('returns rooted targets as they are, workspace or not', () => {
    expect(resolvePathReference(reference('C:\\Apps\\Studio'), null)).toBe('C:\\Apps\\Studio')
    expect(resolvePathReference(reference('\\\\server\\share\\x'), 'C:\\Work')).toBe('\\\\server\\share\\x')
    expect(resolvePathReference(reference('/home/user/x'), 'C:\\Work')).toBe('/home/user/x')
  })
})
