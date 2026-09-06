/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { FileTypeMark, fileTypeOf, formatOfName, markOfName, splitFilePath } from './fileTypes'

afterEach(() => {
  // The config does not set `globals: true`, so testing-library's automatic
  // cleanup never registers.
  cleanup()
})

/**
 * The file-type marks. The map is the whole contract: the extension a path
 * carries decides the glyph, an unknown or missing extension decides the
 * generic file mark, and nothing anywhere guesses.
 */
describe('fileTypeOf', () => {
  it('names the mark each known extension earns', () => {
    expect(fileTypeOf('src/x.ts')).toBe('typescript')
    expect(fileTypeOf('src/App.tsx')).toBe('react')
    expect(fileTypeOf('src/i.js')).toBe('javascript')
    expect(fileTypeOf('main.py')).toBe('python')
    expect(fileTypeOf('crate/main.rs')).toBe('rust')
    expect(fileTypeOf('index.html')).toBe('html')
    expect(fileTypeOf('style.css')).toBe('css')
    expect(fileTypeOf('README.md')).toBe('markdown')
    expect(fileTypeOf('package.json')).toBe('json')
  })

  it('covers the demo garden: every language the writer actually emits', () => {
    expect(fileTypeOf('Hello.java')).toBe('java')
    expect(fileTypeOf('demo.c')).toBe('c')
    expect(fileTypeOf('demo.cpp')).toBe('cplusplus')
    expect(fileTypeOf('Hello.cs')).toBe('csharp')
    expect(fileTypeOf('demo.go')).toBe('go')
    expect(fileTypeOf('demo.rb')).toBe('ruby')
    expect(fileTypeOf('index.php')).toBe('php')
    expect(fileTypeOf('demo.swift')).toBe('swift')
    expect(fileTypeOf('demo.kt')).toBe('kotlin')
    expect(fileTypeOf('demo.scala')).toBe('scala')
    expect(fileTypeOf('demo.dart')).toBe('dart')
    expect(fileTypeOf('script.pl')).toBe('perl')
    expect(fileTypeOf('Demo.hs')).toBe('haskell')
    expect(fileTypeOf('demo.lua')).toBe('lua')
    expect(fileTypeOf('demo.jl')).toBe('julia')
    expect(fileTypeOf('demo.exs')).toBe('elixir')
    expect(fileTypeOf('demo.sh')).toBe('gnubash')
    expect(fileTypeOf('demo.fsx')).toBe('fsharp')
    expect(fileTypeOf('schema.graphql')).toBe('graphql')
    expect(fileTypeOf('run.ps1')).toBe('powershell')
    expect(fileTypeOf('demo.R')).toBe('r')
    expect(fileTypeOf('PlanetRegistry.sol')).toBe('solidity')
    expect(fileTypeOf('demo.zig')).toBe('zig')
    expect(fileTypeOf('demo.toml')).toBe('toml')
  })

  it('reads a Dockerfile by its name, which has no extension', () => {
    expect(fileTypeOf('docker/Dockerfile')).toBe('docker')
    expect(fileTypeOf('docker/dockerfile')).toBe('docker')
  })

  it('reads extensions case-insensitively, on either separator', () => {
    expect(fileTypeOf('C:\\repo\\MAIN.TS')).toBe('typescript')
    expect(fileTypeOf('a\\b\\c.rs')).toBe('rust')
  })

  it('refuses to guess what it has never heard of', () => {
    expect(fileTypeOf('notes.txt')).toBeNull()
    expect(fileTypeOf('Makefile')).toBeNull()
    expect(fileTypeOf('.gitignore')).toBeNull()
    // `.m` is MATLAB's or Objective-C's -- the extension alone cannot say,
    // so it is the generic file rather than a coin flip.
    expect(fileTypeOf('demo.m')).toBeNull()
  })
})

describe('markOfName', () => {
  it('keys on the language word a fence carries, aliases included', () => {
    expect(markOfName('java')).toBe('java')
    expect(markOfName(' Python ')).toBe('python')
    expect(markOfName('cpp')).toBe('cplusplus')
    expect(markOfName('c++')).toBe('cplusplus')
    expect(markOfName('C#')).toBe('csharp')
    expect(markOfName('dockerfile')).toBe('docker')
    expect(markOfName('bash')).toBe('gnubash')
    expect(markOfName('f#')).toBe('fsharp')
    expect(markOfName('sql')).toBeNull()
    expect(markOfName('klingon')).toBeNull()
  })
})

/**
 * SQL, XML and YAML are standards with no brand, so no published mark exists
 * to borrow -- the concept's registry icon stands in, on the chip and in the
 * code block's header alike.
 */
describe('brand-less formats', () => {
  it('stands the concept icon in for the extension', () => {
    expect(formatOfName('sql')).toBe('database')
    expect(formatOfName('xml')).toBe('codeXml')
    expect(formatOfName('svg')).toBe('codeXml')
    expect(formatOfName(' yaml ')).toBe('fileCog')
    expect(formatOfName('yml')).toBe('fileCog')
    expect(formatOfName('java')).toBeNull()
  })

  it('draws the stand-in on a chip where no brand mark exists', () => {
    const { container } = render(<FileTypeMark path="db/query.sql" />)
    expect(container.querySelector('svg.lucide-database')).not.toBeNull()
  })

  it('draws yaml and xml stand-ins too', () => {
    const yaml = render(<FileTypeMark path="config/prod.yaml" />)
    expect(yaml.container.querySelector('svg.lucide-file-cog')).not.toBeNull()
    const xml = render(<FileTypeMark path="feed.xml" />)
    expect(xml.container.querySelector('svg.lucide-code-xml')).not.toBeNull()
  })
})

describe('splitFilePath', () => {
  it('splits on either separator and keeps no dangling slash', () => {
    expect(splitFilePath('a/b/c.ts')).toEqual({ name: 'c.ts', dir: 'a/b' })
    expect(splitFilePath('a\\b\\c.ts')).toEqual({ name: 'c.ts', dir: 'a\\b' })
    expect(splitFilePath('c.ts')).toEqual({ name: 'c.ts', dir: null })
  })
})

describe('FileTypeMark', () => {
  it('draws the language glyph for a known file', () => {
    const { container } = render(<FileTypeMark path="x.ts" />)
    const path = container.querySelector('svg path')
    expect(path).not.toBeNull()
    // The vendored TypeScript square starts at the glyph's origin.
    expect(path?.getAttribute('d')?.startsWith('M1.125')).toBe(true)
  })

  it('falls back to the registry file mark for an unknown kind', () => {
    const { container } = render(<FileTypeMark path="notes.txt" />)
    // The fallback goes through the registry, so it is the stroked generic
    // file -- never an invented glyph.
    expect(container.querySelector('svg.lucide-file-text')).not.toBeNull()
  })
})
