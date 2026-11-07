/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Markdown } from './Markdown'

afterEach(cleanup)

const caretIn = (text: string) => {
  const { container } = render(<Markdown text={text} caret />)
  return { container, caret: container.querySelector('.studio-stream-caret') }
}

describe('the streaming caret', () => {
  it('stands beside the last word of a paragraph, not under it', () => {
    const { caret } = caretIn('Hello there')
    expect(caret?.parentElement?.tagName).toBe('P')
    expect(caret?.previousSibling?.textContent).toBe('Hello there')
  })

  it('reaches the last item of a nested list', () => {
    const { caret } = caretIn('- one\n- two\n  - deep')
    expect(caret?.parentElement?.tagName).toBe('LI')
    expect(caret?.parentElement?.textContent).toBe('deep')
  })

  it('follows emphasis and inline code rather than entering them', () => {
    expect(caretIn('some **bold**').caret?.parentElement?.tagName).toBe('P')
    cleanup()
    expect(caretIn('run `pnpm`').caret?.parentElement?.tagName).toBe('P')
  })

  it('works inside a heading and a quote', () => {
    expect(caretIn('## Title').caret?.parentElement?.tagName).toBe('H2')
    cleanup()
    expect(caretIn('> quoted').caret?.parentElement?.tagName).toBe('P')
  })

  it('stays out of a table', () => {
    expect(caretIn('| a |\n|---|\n| b |').caret).toBeNull()
  })

  it('stays out of a code block and a rule', () => {
    expect(caretIn('```ts\nconst a = 1\n```').caret).toBeNull()
    cleanup()
    expect(caretIn('text\n\n---').caret).toBeNull()
  })

  it('draws nothing for a finished reply', () => {
    const { container } = render(<Markdown text="Hello" />)
    expect(container.querySelector('.studio-stream-caret')).toBeNull()
  })
})
