/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseVisual } from '@/features/chat/markdown/visuals/parse'
import type { ToolCallView } from '@/features/chat/transcript/projection'
import { present } from '@/platform/harness/contracts/chunks'
import { activitySections } from './ActivityBlock'
import { ToolArtifact } from './ToolArtifact'
import { readWalkingRoute } from './walkingRouteCall'

vi.mock('@/features/chat/markdown/visuals/PlaceMapCanvas', () => ({ default: () => <span>Map canvas</span> }))
afterEach(cleanup)

const stops = [
  { name: 'Park', lat: 23.7375, lng: 90.3998 },
  { name: 'Garden', lat: 23.7281, lng: 90.4042 },
  { name: 'Palace', lat: 23.7086, lng: 90.4064 },
]
const result = {
  kind: 'walking-route', version: 1, stops,
  coordinates: [[90.3998, 23.7375], [90.403, 23.735], [90.4042, 23.7281], [90.4064, 23.7086]],
  distanceMeters: 3500, durationSeconds: 2400,
  legs: [{ distanceMeters: 1200, durationSeconds: 840 }, { distanceMeters: 2300, durationSeconds: 1560 }],
}
const call: ToolCallView = {
  toolCallId: 'route-1', toolName: 'walking_route', input: null, output: present(result), errorText: null,
}

describe('walking routes in the transcript', () => {
  it('renders the saved tool result as a standalone itinerary with every leg and shared selection', () => {
    const sections = activitySections([{ id: 'tools-1', kind: 'tools', groups: [{ id: 'group-1', calls: [call], file: null }] }])
    expect(sections).toEqual([{ kind: 'artifact', id: 'route-1', call }])
    render(<ToolArtifact call={call} conversationId="conversation" />)
    expect(screen.getByText('3.5 km · est. 40 min')).toBeTruthy()
    expect(screen.getByText('1.2 km · est. 14 min')).toBeTruthy()
    expect(screen.getByText('2.3 km · est. 26 min')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Palace/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Expand map' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Walking itinerary' }))
    expect(dialog.getByRole('button', { name: /Palace/ }).getAttribute('aria-pressed')).toBe('true')
  })

  it('rejects failed or malformed results and leaves model-authored map fences as pins', () => {
    expect(readWalkingRoute({ ...call, errorText: 'Could not calculate a route' })).toBeNull()
    expect(readWalkingRoute({ ...call, output: present({ ...result, legs: [] }) })).toBeNull()
    expect(readWalkingRoute({ ...call, toolName: 'mcp_walking_route' })).toBeNull()
    expect(parseVisual('map', JSON.stringify({ places: stops, route: result }), false))
      .toEqual({ kind: 'visual', visual: { kind: 'map', title: undefined, subtitle: undefined, places: stops.map((stop) => ({ ...stop, detail: undefined })) } })
  })
})
