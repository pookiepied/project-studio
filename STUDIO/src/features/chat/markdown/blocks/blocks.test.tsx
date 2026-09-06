/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Markdown } from '@/features/chat/markdown/Markdown'
import { CodeBlock } from './CodeBlock'
import { TextBlock } from './TextBlock'

afterEach(() => {
  // The config does not set `globals: true`, so testing-library's automatic
  // cleanup never registers.
  cleanup()
  vi.unstubAllGlobals()
})

/**
 * The block container, after the preview era. The property that outranks the
 * rest: nothing is hidden. The old frame held long content behind a gradient
 * fade and called the clipboard the way back; a coding session cannot work
 * like that. The assertions pin the replacement -- everything rendered, a
 * scroller instead of a fade, the language's own mark, the count, the copy.
 */
describe('CodeBlock', () => {
  it('counts a closing newline as a terminator, not a fourth line', () => {
    // A fence's content usually ends in a break. Counting the split's parts
    // called every such block one line longer than it is.
    render(<CodeBlock code={['a', 'b', 'c', ''].join('\n')} fence="ts" />)
    expect(screen.getByText('3 lines')).toBeTruthy()
  })

  it('says one line for a single line with no break at all', () => {
    render(<CodeBlock code={'only'} fence="ts" />)
    expect(screen.getByText('1 line')).toBeTruthy()
  })

  it('names the file, counts the lines, and carries the language mark', () => {
    const { container } = render(<CodeBlock code={'const a = 1\nconst b = 2\nconst c = 3'} fence="ts:src/x.ts" />)
    expect(screen.getByText('src/x.ts')).toBeTruthy()
    expect(screen.getByText('3 lines')).toBeTruthy()
    // The language glyph is a filled mark -- the same family the tool chips draw.
    expect(container.querySelector('svg[fill="currentColor"]')).not.toBeNull()
  })

  it('names an unknown language without inventing a mark for it', () => {
    const { container } = render(<CodeBlock code='print("hi")' fence="brainfuck" />)
    expect(screen.getByText('BRAINFUCK')).toBeTruthy()
    // No language mark exists for it: the coding mark, not a guess.
    expect(container.querySelector('svg.lucide-code')).not.toBeNull()
    expect(container.querySelector('svg[fill="currentColor"]')).toBeNull()
  })

  it('marks languages the highlighter does not parse, by the fence\'s word', () => {
    // `java` is not a registered grammar -- the code renders unhighlighted --
    // but the fence names a language with a published mark, so the header
    // carries it instead of the generic coding mark.
    const { container } = render(<CodeBlock code={'class A {}'} fence="java" />)
    expect(container.querySelector('svg[fill="currentColor"]')).not.toBeNull()
    expect(container.querySelector('svg.lucide-code')).toBeNull()
  })

  it('hides nothing: no fade mask, and the body scrolls inside the frame', () => {
    const { container } = render(
      <CodeBlock code={Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n')} fence="py" />,
    )
    const frame = container.firstElementChild as HTMLElement | null
    expect(frame?.style.maskImage ?? '').toBe('')
    // The frame scroller: the thumb is held back by the frame's radius
    // instead of running into the rounded corners.
    expect(container.querySelector('[class*="overflow-auto"]')?.className).toContain(
      'studio-scroll-frame',
    )
    expect(screen.getByText('60 lines')).toBeTruthy()
  })

  it('numbers the lines, unselectable beside the code', () => {
    const { container } = render(<CodeBlock code={'a\nb\nc'} fence="py" />)
    const numbers = container.querySelectorAll('.react-syntax-highlighter-line-number')
    expect(numbers).toHaveLength(3)
    const first = numbers[0]
    expect(first?.getAttribute('style') ?? '').toContain('user-select: none')
  })

  it('copies the code it shows', async () => {
    const writes: string[] = []
    vi.stubGlobal('navigator', {
      ...globalThis.navigator,
      clipboard: { writeText: async (text: string) => void writes.push(text) },
    })
    render(<CodeBlock code={'const a = 1'} fence="ts" />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }))
    await waitFor(() => expect(writes).toEqual(['const a = 1']))
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy()
  })
})

describe('TextBlock', () => {
  it('frames writing as an object: named, copyable, no code furniture', () => {
    const { container } = render(<TextBlock text={'* keep the asterisk literal'} fence="draft" />)
    expect(screen.getByText('Draft')).toBeTruthy()
    expect(screen.getByText('* keep the asterisk literal').textContent).toBe('* keep the asterisk literal')
    // No file-type mark and no line count: it is text, not code.
    expect(container.querySelector('svg[fill="currentColor"]')).toBeNull()
    expect(screen.queryByText(/\d+ lines/)).toBeNull()
  })

  it('copies exactly what was fenced', async () => {
    const writes: string[] = []
    vi.stubGlobal('navigator', {
      ...globalThis.navigator,
      clipboard: { writeText: async (text: string) => void writes.push(text) },
    })
    render(<TextBlock text="the draft" fence="text" />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy text' }))
    await waitFor(() => expect(writes).toEqual(['the draft']))
  })
})

/**
 * The routing, at the only level it can be decided. An unlabeled fence is the
 * common case -- a plain ``` block -- and it used to fall through to the
 * inline-code chip and render as a grey pill, or seem to render no block at
 * all, depending on what the model wrote. Every fence has one fate now.
 */
describe('fence routing', () => {
  it('renders a named fence as a code block', () => {
    render(<Markdown text={'```ts\nconst a = 1\n```'} />)
    expect(screen.getByText('1 line')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeTruthy()
  })

  it('renders an unlabeled fence as a text block', () => {
    render(<Markdown text={'```\njust some writing\n```'} />)
    expect(screen.getByText('Text')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy text' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Copy code' })).toBeNull()
  })

  it('renders a prose fence under its own name', () => {
    render(<Markdown text={'```draft\nthe rewrite\n```'} />)
    expect(screen.getByText('Draft')).toBeTruthy()
  })

  it('leaves inline code inline', () => {
    const { container } = render(<Markdown text="run `npm i` now" />)
    expect(container.querySelector('code')?.textContent).toBe('npm i')
    expect(screen.queryByRole('button', { name: /Copy/ })).toBeNull()
  })

  it('sets a table on the sunken ground, filling it edge to edge', () => {
    const { container } = render(<Markdown text={'| A | B |\n| - | - |\n| 1 | 2 |'} />)
    // The frame scroller is the table's whole scrollbar treatment now -- the
    // always-drawn pill bars and the radius insets live on the frame class,
    // so the sideways bar is defined once for code, diff and table alike.
    const wrapper = container.querySelector('div.studio-scroll-frame')
    expect(wrapper?.className).not.toContain('studio-scroll-x')
    expect(wrapper?.className).toContain('bg-surface-sunken')
    // The header band touches the frame's own corners: the inset belongs to
    // the cells, not to the container. Padding on the wrapper is what made
    // the band read as a centred bar, unscaled to the box around it.
    expect(wrapper?.className).not.toContain('p-3')
    expect(wrapper?.querySelector('thead')).not.toBeNull()
  })

  /**
   * Inline SVG used to vanish whole: the sanitiser's default schema has no
   * `svg`, so an illustration the model drew was parsed and then deleted.
   * The curated allowlist draws shapes and nothing that can execute or point
   * outward -- a script tag inside the same svg is still removed.
   */
  describe('inline svg', () => {
    it('renders the shapes a model drew', () => {
      const { container } = render(
        <Markdown
          text={
            '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="8" fill="#333"></circle></svg>'
          }
        />,
      )
      expect(container.querySelector('svg')).not.toBeNull()
      expect(container.querySelector('circle')).not.toBeNull()
    })

    it('keeps the execution vocabulary out', () => {
      const { container } = render(
        <Markdown
          text={
            '<svg viewBox="0 0 24 24"><script>alert(1)</script><rect width="4" height="4" onclick="alert(1)"></rect><foreignObject>html</foreignObject></svg>'
          }
        />,
      )
      expect(container.querySelector('svg')).not.toBeNull()
      expect(container.querySelector('rect')).not.toBeNull()
      expect(container.querySelector('script')).toBeNull()
      expect(container.querySelector('foreignobject')).toBeNull()
      // The handler is an attribute, not an element: the rect surviving means
      // the attribute list, not the tag list, did the refusing.
      expect(container.querySelector('rect')?.getAttribute('onclick')).toBeNull()
    })
  })

  it('renders math through the katex pipeline', () => {
    const { container } = render(<Markdown text={'$E = mc^2$'} />)
    // KaTeX marks its output with its own class; a formula that fell through
    // would render as the literal `$E = mc^2$` text.
    expect(container.querySelector('.katex')).not.toBeNull()
  })
})
