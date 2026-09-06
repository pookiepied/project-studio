/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { diffLines, wholeFileDiff } from './diffLines'
import { FileDiff } from './FileDiff'

afterEach(() => {
  // The config does not set `globals: true`, so testing-library's automatic
  // cleanup never registers.
  cleanup()
})

/**
 * The expanded working-out of a file-writing call. The assertions that
 * matter are the honesty ones: the card colours its own text (the app sets
 * no default, and an uncoloured card is invisible in dark mode), it prints
 * line numbers only when the diff actually carries them, and the head names
 * the file and counts what the rows show.
 */
describe('FileDiff', () => {
  it('names the file and counts the rows it shows', () => {
    const { container } = render(
      <FileDiff path="STUDIO/src/x.ts" diff={wholeFileDiff('one\ntwo\nthree')} />,
    )
    expect(screen.getByText('x.ts')).toBeTruthy()
    expect(screen.getByText('STUDIO/src/')).toBeTruthy()
    expect(screen.getByText('+3')).toBeTruthy()
    expect(screen.getByText('-0')).toBeTruthy()
    expect(container.querySelectorAll('code')).toHaveLength(3)
  })

  it('prints the gutters a whole-file write knows', () => {
    const { container } = render(<FileDiff path="x.ts" diff={wholeFileDiff('one\ntwo\nthree')} />)
    expect(screen.getByText('1')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
    // A number on a changed row takes the row's direction, as its sign does.
    expect(screen.getByText('3').className).toContain('text-diff-add')
    // And the gutters sit behind their own divider, which runs the full
    // height of the track rather than per row.
    expect(container.querySelector('[class*="after:left-20"]')).not.toBeNull()
  })

  it('draws no gutter divider when there are no gutters', () => {
    const { container } = render(<FileDiff path="x.ts" diff={diffLines('a\nb\nc', 'a\nx\nc')} />)
    expect(container.querySelector('[class*="after:left-20"]')).toBeNull()
  })

  it('prints no gutters for lines an edit cannot place', () => {
    render(<FileDiff path="x.ts" diff={diffLines('a\nb\nc', 'a\nx\nc')} />)
    // The edit's rows would be numbered 1..3 only by invention; nothing here
    // may guess where the span sits in the file.
    expect(screen.queryByText('1')).toBeNull()
    expect(screen.queryByText('3')).toBeNull()
    expect(screen.getByText('+1')).toBeTruthy()
    expect(screen.getByText('-1')).toBeTruthy()
  })

  it('signs and tints the rows the change touched', () => {
    const { container } = render(<FileDiff path="x.ts" diff={diffLines('a\nb', 'a\nc')} />)
    expect(screen.getByText('+')).toBeTruthy()
    expect(screen.getByText('-')).toBeTruthy()
    const added = [...container.querySelectorAll('code')].find((code) => code.textContent === 'c')
    expect(added?.parentElement?.className).toContain('bg-diff-add-ground')
    expect(added?.parentElement?.className).toContain('before:bg-diff-add')
    // The deletion bar hatches: solid says "this row is red", the cut says
    // "this row is gone".
    const removed = [...container.querySelectorAll('code')].find((code) => code.textContent === 'b')
    expect(removed?.parentElement?.className).toContain('studio-diff-del-bar')
    expect(removed?.parentElement?.className).toContain('bg-diff-del-ground')
  })

  it('colours its own text, because nothing else will', () => {
    const { container } = render(<FileDiff path="x.ts" diff={wholeFileDiff('one')} />)
    const root = container.firstElementChild
    expect(root?.className).toContain('text-foreground')
    expect(root?.className).toContain('bg-code-surface')
  })

  it('carries the code-text setting on its body, the way every code surface does', () => {
    // The body is code. text-ui pinned it to the interface size, so the
    // appearance row could move every code block except the one under a
    // tool chip -- the code a reader watches most.
    const { container } = render(<FileDiff path="x.ts" diff={wholeFileDiff('one\ntwo')} />)
    const body = container.querySelector('.studio-scroll-frame')
    expect(body?.className).toContain('text-code')
    expect(body?.className).not.toContain('text-ui')
  })

  it('renders an empty write as a head with nothing under it', () => {
    const { container } = render(<FileDiff path="x.ts" diff={wholeFileDiff('')} />)
    expect(screen.getByText('+0')).toBeTruthy()
    expect(container.querySelector('code')).toBeNull()
  })
})
