import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cn } from '../src/lib/cn.js'
import ts from 'typescript'

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')

function components(directory = new URL('../src/', import.meta.url)): URL[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)
    if (entry.isDirectory()) return components(path)
    return entry.name.endsWith('.tsx') && !entry.name.includes('.test.') ? [path] : []
  })
}

describe('shared interface typography', () => {
  it('rejects literal font sizes in JSX class expressions across the client', () => {
    const violations: string[] = []
    for (const path of components()) {
      const file = ts.createSourceFile(path.pathname, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
      const visit = (node: ts.Node) => {
        if (ts.isJsxAttribute(node) && node.name.getText(file) === 'className' && node.initializer) {
          const inspect = (value: ts.Node) => {
            if (ts.isStringLiteralLike(value) || ts.isTemplateHead(value) || ts.isTemplateMiddle(value) || ts.isTemplateTail(value)) {
              if (/\btext-\[(?:\d|length:\d)/.test(value.text)) violations.push(`${path.pathname}:${file.getLineAndCharacterOfPosition(value.pos).line + 1}`)
            }
            ts.forEachChild(value, inspect)
          }
          inspect(node.initializer)
        }
        ts.forEachChild(node, visit)
      }
      visit(file)
    }
    expect(violations).toEqual([])
  })
  it('preserves every typography role beside colours and replaces conflicting sizes', () => {
    const roles = [...source('styles/components.css').matchAll(/\.text-([\w-]+)\s*\{([^}]+)\}/g)]
      .filter((match) => match[2].includes('font-size:'))
      .map((match) => match[1])
    expect(roles).toContain('code')
    for (const role of roles) {
      expect(cn(`text-${role}`, 'text-muted-foreground')).toBe(`text-${role} text-muted-foreground`)
      expect(cn('text-ui', `text-${role}`)).toBe(`text-${role}`)
    }
  })

  it('keeps migrated settings lists and media controls on shared geometry', () => {
    for (const path of components(new URL('../src/features/settings/', import.meta.url))) {
      expect(readFileSync(path, 'utf8'), path.pathname).not.toContain('flex items-start justify-between gap-6 py-3.5')
    }
    const player = source('styles/player.css')
    expect(player).toContain('--media-control-height: var(--button-sm)')
    expect(source('components/primitives/IconButton/IconButton.tsx')).toContain("sm: 'size-[var(--button-sm)]'")
    expect(player).toContain('--media-button-icon-width: var(--icon-sm)')
    expect(player).toContain('width: var(--control-xl)')
  })

  it('keeps conversation body and code on the same scale as the interface', () => {
    const prose = source('styles/prose.css').match(/\.studio-prose\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(prose).toContain('font-size: var(--text-body)')
    expect(prose).not.toContain('--code-size:')
    expect(source('styles/type.css')).not.toContain('--text-prose:')
    expect(source('features/chat/ChatPage.tsx').match(/className="studio-content-column/g)).toHaveLength(2)
    for (const path of ['features/home/HomePage.tsx', 'features/projects/ProjectPage.tsx']) {
      expect(source(path), path).toContain('className="studio-content-column"')
      expect(source(path), path).not.toMatch(/SHELL\.(measure|gutter)/)
    }
  })

  it('keeps chat and rail control labels off fixed Tailwind font sizes', () => {
    for (const path of components()) {
      expect(readFileSync(path, 'utf8').match(/\btext-(?:xs|sm|base|lg|xl|\d+xl)\b/g) ?? [], path.pathname).toEqual([])
    }
  })

  it('keeps shared text controls on the same geometry scale as icon buttons', () => {
    for (const path of ['Button/Button', 'Field/TextField', 'Segmented/Segmented', 'Popover/MenuItem', 'NavRow/NavRow']) {
      const text = source(`components/primitives/${path}.tsx`)
      expect(text, path).toContain('studio-control')
      expect(text.match(/\bh-(?:6|7|8|10)\b/g) ?? [], path).toEqual([])
    }
    expect(source('components/primitives/Button/Button.tsx')).not.toContain('font-medium leading-none')
  })

  it('uses sentence typography for filenames and a stronger weight for inline code', () => {
    const text = source('styles/prose.css')
    const file = text.match(/code\.studio-file-reference\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(file).toContain('font-family: inherit')
    expect(file).toContain('font-size: 1em')
    expect(file).toContain('font-weight: 500')
    expect(text.match(/:not\(pre\) > code\s*\{([^}]+)\}/)?.[1]).toContain('font-weight: 500')
  })

  it('keeps slider thumb geometry and its end-position correction on one scale', () => {
    const slider = source('components/primitives/Slider/StepSlider.tsx')
    expect(slider.includes('size-[var(--icon-sm)]')).toBe(true)
    expect(slider.includes('${progress} * var(--icon-sm)')).toBe(true)
    expect(slider.match(/\bh-5\b|size-3\.5/g) ?? []).toEqual([])
  })
})
