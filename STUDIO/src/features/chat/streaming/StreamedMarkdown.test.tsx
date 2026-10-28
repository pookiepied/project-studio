/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { StreamedMarkdown } from './StreamedMarkdown'

afterEach(cleanup)

describe('streamed document structure', () => {
  it('keeps a loose nested list and continuation in their parent item', () => {
    const text = '1. **Inspect** the result.\n\n   Keep this explanation with the first step.\n\n   - Check the chart\n   - Check the labels\n\n2. Finish.'
    const { container, rerender } = render(<StreamedMarkdown text={text} streaming />)
    const assertStructure = () => {
      expect(container.querySelectorAll('ol')).toHaveLength(1)
      expect(container.querySelectorAll('ol > li')).toHaveLength(2)
      expect(container.querySelector('ol > li > p + p')?.textContent).toBe('Keep this explanation with the first step.')
      expect(container.querySelectorAll('ol > li > ul > li')).toHaveLength(2)
    }
    assertStructure()
    rerender(<StreamedMarkdown text={text} streaming={false} />)
    assertStructure()
  })

  it('resolves reference links across paragraph boundaries', () => {
    render(<StreamedMarkdown text={'Read [the guide][guide].\n\nAnother paragraph.\n\n[guide]: https://example.com/guide'} streaming={false} />)
    expect(screen.getByRole('link', { name: 'the guide' }).getAttribute('href')).toBeNull()
  })

  it('retains finished paragraph nodes as ordinary prose grows', () => {
    const { container, rerender } = render(<StreamedMarkdown text={'First paragraph.\n\nSecond'} streaming />)
    const first = container.querySelector('p')
    rerender(<StreamedMarkdown text={'First paragraph.\n\nSecond paragraph grows.'} streaming />)
    expect(container.querySelector('p')).toBe(first)
  })
})
