import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')

function components(directory = new URL('../src/', import.meta.url)): URL[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)
    if (entry.isDirectory()) return components(path)
    return entry.name.endsWith('.tsx') && !entry.name.includes('.test.') ? [path] : []
  })
}

describe('shared interface typography', () => {
  it('keeps conversation body and code on the same scale as the interface', () => {
    const prose = source('styles/prose.css').match(/\.studio-prose\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(prose).toContain('font-size: var(--text-body)')
    expect(prose).not.toContain('--code-size:')
    expect(source('styles/type.css')).not.toContain('--text-prose:')
    expect(source('features/chat/ChatPage.tsx').match(/maxWidth: SHELL\.measure/g)).toHaveLength(2)
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
