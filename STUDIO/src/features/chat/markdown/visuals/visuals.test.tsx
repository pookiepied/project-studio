/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Markdown } from '../Markdown'
import { ReplyConversation } from '../ReplyImage'
import { niceTicks } from './Chart'
import { formatValue, parseVisual } from './parse'

vi.mock('@/platform/harness', async (original) => ({
  ...await original<typeof import('@/platform/harness')>(),
  harnessBytesDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,AAAA'),
}))
afterEach(cleanup)

const fenced = (fence: string, body: unknown) => `Here it is.\n\n\`\`\`${fence}\n${JSON.stringify(body)}\n\`\`\`\n`

describe('reading a visual', () => {
  it('reads a chart, forgiving quoted numbers and the single-series shorthand', () => {
    const result = parseVisual('chart', JSON.stringify({ type: 'bar', data: [{ label: 'Rust', value: '1,204' }, { label: 'Go', value: 9 }] }), false)
    expect(result).toMatchObject({ kind: 'visual', visual: { type: 'bar', x: ['Rust', 'Go'], series: [{ values: [1204, 9] }] } })
  })

  it('refuses what it would have to guess at', () => {
    const uneven = parseVisual('chart', JSON.stringify({ x: ['a', 'b'], series: [{ name: 'S', values: [1] }] }), false)
    expect(uneven).toEqual({ kind: 'invalid', message: 'Series 1 has 1 values for 2 labels' })
    const many = parseVisual('chart', JSON.stringify({ x: ['a'], series: Array.from({ length: 9 }, () => ({ values: [1] })) }), false)
    expect(many).toMatchObject({ kind: 'invalid', message: 'At most 8 series' })
  })

  it('waits quietly for a fence that is still arriving, and names a finished one that is broken', () => {
    expect(parseVisual('stats', '{"items": [{"label"', true)).toEqual({ kind: 'pending' })
    expect(parseVisual('stats', '{"items": [{"label"', false)).toMatchObject({ kind: 'invalid' })
  })

  it('reads a delta as good or bad news by which way is good', () => {
    const result = parseVisual('stats', JSON.stringify({ items: [
      { label: 'Revenue', value: '$4M', delta: '+12%' },
      { label: 'Churn', value: '2%', delta: '-0.4pt', good: 'down' },
      { label: 'Cost', value: 3, delta: 5, good: 'down' },
    ] }), false)
    expect(result.kind === 'visual' && result.visual.kind === 'stats' && result.visual.items.map((item) => item.tone))
      .toEqual(['good', 'good', 'bad'])
  })

  it('formats values with the unit on the side a reader expects', () => {
    expect(formatValue(4200, '$', true)).toBe('$4.2K')
    expect(formatValue(-3, '$')).toBe('-$3')
    expect(formatValue(12.5, '%')).toBe('12.5%')
    expect(formatValue(40, 'ms')).toBe('40 ms')
  })

  it('puts round ticks around the data', () => {
    expect(niceTicks(0, 87)).toEqual([0, 25, 50, 75, 100])
    expect(niceTicks(-3, 3)).toEqual([-4, -2, 0, 2, 4])
    expect(niceTicks(5, 5)).toEqual([0, 2, 4, 6])
  })
})

describe('drawing a visual in a reply', () => {
  const chart = {
    type: 'line', title: 'Active users', x: ['Jan', 'Feb', 'Mar'],
    series: [{ name: 'iOS', values: [1, 2, 3] }, { name: 'Android', values: [2, null, 4] }],
  }

  it('draws a chart with a legend, and the same numbers as a table on request', () => {
    render(<Markdown text={fenced('chart', chart)} />)
    expect(screen.getByRole('img', { name: 'Active users' })).toBeTruthy()
    expect(screen.getByText('Android')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Show as table' }))
    const rows = screen.getAllByRole('row').map((row) => row.textContent)
    expect(rows).toEqual(['LabeliOSAndroid', 'Jan12', 'Feb2\u2013', 'Mar34'])
    fireEvent.click(screen.getByRole('button', { name: 'Show as chart' }))
    expect(screen.getByRole('img', { name: 'Active users' })).toBeTruthy()
  })

  it('draws figures, progress and a timeline', () => {
    render(<Markdown text={[
      fenced('stats', { items: [{ label: 'Revenue', value: '$4.2M', delta: '+12%' }] }),
      fenced('progress', { items: [{ label: 'API routes', value: 34, max: 52 }] }),
      fenced('timeline', { items: [{ title: 'Beta', status: 'done' }, { title: 'Launch', status: 'current' }] }),
    ].join('\n')} />)
    expect(screen.getByText('$4.2M')).toBeTruthy()
    expect(screen.getByText('\u2191 +12%')).toBeTruthy()
    const bar = screen.getByRole('progressbar', { name: 'API routes' })
    expect(bar.getAttribute('aria-valuenow')).toBe('34')
    expect(screen.getByText('34 of 52')).toBeTruthy()
    expect(screen.getByText('Launch').closest('li')?.getAttribute('aria-current')).toBe('step')
  })

  it('draws cards whose title opens through the link capsule and whose picture comes through the harness', async () => {
    render(
      <ReplyConversation.Provider value="cnv-1">
        <Markdown text={fenced('cards', { items: [{ title: 'XM6', url: 'https://example.com/xm6', image: 'https://example.com/xm6.jpg', price: '$399', rating: 4.7 }] })} />
      </ReplyConversation.Provider>,
    )
    expect(screen.getByRole('link', { name: 'XM6' })).toBeTruthy()
    expect(await screen.findByRole('img', { name: 'XM6' })).toBeTruthy()
    expect(screen.getByLabelText('Rated 4.7 out of 5')).toBeTruthy()
  })

  it('shows a broken visual as the JSON it is, with the reason', () => {
    render(<Markdown text={'```chart\n{"x": ["a"]}\n```'} />)
    expect(screen.getByText(/This chart could not be drawn: Series needs at least one entry/)).toBeTruthy()
    expect(screen.getByText('JSON')).toBeTruthy()
  })

  it("leaves a visual fence in a person's own message as text", () => {
    render(<Markdown user text={fenced('stats', { items: [{ label: 'A', value: 1 }] })} />)
    expect(screen.queryByText('A')).toBeNull()
    expect(screen.getByText(/"label":"A"/)).toBeTruthy()
  })
})
