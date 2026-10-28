/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { StreamedMarkdown } from '@/features/chat/streaming'
import { Markdown } from './Markdown'
import { prepareMath } from './prepareMath'
import { scanSources } from './rehypeReply'

afterEach(cleanup)

const SOURCED = [
  'WCAG 2.2 is a W3C Recommendation [1][2]. It adds nine criteria [1, 2].',
  '',
  'An unknown marker [7] stays text.',
  '',
  '**Sources**',
  '1. W3C, *WCAG 2.2*. https://www.w3.org/TR/WCAG22',
  '2. U.S. Access Board, "WCAG 2.2 Now Available." https://www.access-board.gov/news/wcag',
].join('\n')

describe('citations', () => {
  it('links bare numbered markers to the source list and labels them by site', () => {
    const { container } = render(<Markdown text={SOURCED} />)
    const chips = [...container.querySelectorAll('a.studio-citation')]
    expect(chips.map((chip) => chip.textContent)).toEqual(['w3.org', 'access-board.gov', 'w3.org', 'access-board.gov'])
    expect(screen.getAllByRole('link', { name: 'Source 1: w3.org' })).toHaveLength(2)
    expect(container.textContent).toContain('[7]')
    expect(container.textContent).not.toContain('[1]')
  })

  it('shows the source list compactly with addresses as their site', () => {
    const { container } = render(<Markdown text={SOURCED} />)
    const list = container.querySelector('ol.studio-sources')
    expect(list).not.toBeNull()
    expect([...(list?.querySelectorAll('a') ?? [])].map((link) => link.textContent)).toEqual(['w3.org', 'access-board.gov'])
  })

  it('resolves markers against a list in a later streamed block', () => {
    const { container } = render(<StreamedMarkdown text={SOURCED} streaming={false} />)
    expect(container.querySelectorAll('a.studio-citation')).toHaveLength(4)
  })

  it('reads the labelled list over an earlier list of links', () => {
    const sources = scanSources('1. https://a.example/x\n\nSources:\n\n1. Real https://b.example/y')
    expect(sources.get(1)).toEqual({ url: 'https://b.example/y', title: 'Real' })
  })

  it('leaves markers alone when the reply has no source list', () => {
    const { container } = render(<Markdown text="Plain [1] text." />)
    expect(container.querySelector('a')).toBeNull()
  })
})

describe('checklists', () => {
  it('draws done, open and blocked marks in place of browser checkboxes', () => {
    const { container } = render(<Markdown text={'- [x] Shipped\n- [ ] Pending\n- [~] Waiting on vendor'} />)
    expect(container.querySelector('input')).toBeNull()
    expect(container.querySelector('ul')?.className).toContain('contains-task-list')
    expect(screen.getByRole('img', { name: 'Done' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Not done' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Blocked' })).toBeTruthy()
    expect(container.textContent).not.toContain('[~]')
  })
})

describe('maths delimiters', () => {
  it('keeps prices in a sentence as dollars', () => {
    expect(prepareMath('fell from about $100 in January to about $74 in June')).toBe('fell from about \\$100 in January to about \\$74 in June')
  })

  it('keeps real inline formulas', () => {
    expect(prepareMath('growth is $g = 1.2$, or more')).toBe('growth is $g = 1.2$, or more')
  })

  it('rewrites an escaped dollar inside a formula so it cannot close the span', () => {
    expect(prepareMath('falls from $x = \\$100.00$ to')).toBe('falls from $x = \\char36 100.00$ to')
  })

  it('opens a one-line display formula into a block', () => {
    expect(prepareMath('$$r = 0.99$$')).toBe('$$\nr = 0.99\n$$')
  })

  it('leaves code untouched', () => {
    const code = '```sh\necho $HOME $PATH\n```\n\nRun `cost $5 $6` now.'
    expect(prepareMath(code)).toBe(code)
  })

  it('leaves a fence nested in a list item untouched', () => {
    const code = '1. Run it:\n\n    ```sh\n    echo $HOME $PATH\n    ```'
    expect(prepareMath(code)).toBe(code)
  })
})
