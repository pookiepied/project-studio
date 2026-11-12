/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StreamedMarkdown } from '@/features/chat/streaming/StreamedMarkdown'
import { Markdown } from '../Markdown'
import { parseVisual } from './parse'

vi.mock('./PlaceMapCanvas', () => ({ default: () => <span role="status">Basemap unavailable. Places are listed below.</span> }))
afterEach(cleanup)

const places = [
  { name: 'Library', lat: 23.81, lng: 90.41, detail: 'First stop' },
  { name: 'Garden', lat: 23.79, lng: 90.43, detail: 'Second stop' },
]
const json = JSON.stringify({ title: 'City stops', places })
const open = '```map\n' + json
const closed = open + '\n```'

describe('maps in replies', () => {
  it('bounds and validates map inputs before rendering', () => {
    expect(parseVisual('map', json, false)).toMatchObject({ kind: 'visual', visual: { places } })
    expect(parseVisual('map', JSON.stringify({ places: [{ name: 'Unknown', lat: '23.81', lng: 90.4 }] }), false))
      .toMatchObject({ kind: 'invalid', message: expect.stringContaining('numeric coordinates') })
    expect(parseVisual('map', JSON.stringify({ places: [{ ...places[0], lng: 181 }] }), false)).toMatchObject({ kind: 'invalid' })
    expect(parseVisual('map', ' '.repeat(16_385), false)).toEqual({ kind: 'invalid', message: 'The map is too large' })
  })

  it('waits for a real closing fence in the assistant transcript and keeps previews inert', () => {
    const { rerender } = render(<StreamedMarkdown text={open} streaming allowMaps />)
    expect(screen.queryByRole('button', { name: 'Expand map' })).toBeNull()
    rerender(<StreamedMarkdown text={open} streaming={false} allowMaps />)
    expect(screen.queryByRole('button', { name: 'Expand map' })).toBeNull()
    rerender(<Markdown text={closed} />)
    expect(screen.queryByRole('button', { name: 'Expand map' })).toBeNull()
    rerender(<StreamedMarkdown text={closed + '\n\nThese are the two stops.'} streaming allowMaps />)
    expect(screen.getByRole('button', { name: 'Expand map' })).toBeTruthy()
  })

  it('keeps linked place selection usable when the basemap fails and shares it with the larger view', async () => {
    render(<StreamedMarkdown text={closed} streaming={false} allowMaps />)
    await screen.findByText('Basemap unavailable. Places are listed below.')
    fireEvent.click(screen.getByRole('button', { name: 'Garden' }))
    expect(screen.getByText('Second stop')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Expand map' }))
    const expanded = within(screen.getByRole('dialog', { name: 'City stops' }))
    expect(expanded.getByRole('button', { name: 'Garden' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(expanded.getByRole('button', { name: 'Library' }))
    expect(screen.getAllByText('First stop')).toHaveLength(2)
  })
})
