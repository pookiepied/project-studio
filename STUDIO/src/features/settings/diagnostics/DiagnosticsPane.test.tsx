/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiagnosticHealth, DiagnosticPolicy } from '@/platform/harness/client/diagnostics'
import { DiagnosticsPane } from './DiagnosticsPane'

const fixture = vi.hoisted(() => ({ desktop: true, connect: vi.fn(), share: vi.fn(async (_enabled?: boolean) => ({ enabled: false, path: null, status: 'off' })) }))
vi.mock('@/platform/tauri', () => ({ isTauri: () => fixture.desktop }))
vi.mock('@/platform/harness/react', () => ({ useHarnessClient: () => fixture.connect }))
vi.mock('@/stores/workspace', () => ({ useWorkspace: () => ({ conversations: [{ id: 'cnv_one', title: 'Investigate' }] }) }))
vi.mock('@/platform/diagnostics/native', () => ({
  syncNativeCapture: async () => true, readNativeCapture: async () => null, clearNativeCapture: async () => undefined,
  inspectorSharing: fixture.share,
}))

let health: DiagnosticHealth
const configure = vi.fn(async (policy: Partial<DiagnosticPolicy>) => {
  health = { ...health, policy: { ...health.policy, ...policy } }
  return { ok: true, value: health }
})
const clear = vi.fn(async () => ({ ok: true }))
const copy = vi.fn(async (_text: string) => undefined)

beforeEach(() => {
  fixture.desktop = true
  health = { bootId: 'boot', captureId: 'capture', latestSequence: 1, retainedEvents: 1, retainedBytes: 500, evictedEvents: 0, droppedEvents: 0,
    policy: { enabled: false, captureContent: false, conversations: [], maxEvents: 2000, maxBytes: 4096, maxEventBytes: 2048 } }
  fixture.connect.mockResolvedValue({
    getDiagnostics: async () => ({ ok: true, value: health }), configureDiagnostics: configure,
    clearDiagnostics: clear,
    readDiagnostics: async () => ({ ok: true, value: { events: [{ v: 1, eventId: 'event', sequence: 1 }], nextSequence: 1, gap: false, health } }),
  })
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: copy }, configurable: true })
})
afterEach(() => { cleanup(); vi.clearAllMocks(); Reflect.deleteProperty(navigator, 'clipboard') })

describe('diagnostic recording controls', () => {
  it('shares only after an explicit action and never enables recording as a side effect', async () => {
    render(<DiagnosticsPane />)
    await screen.findByText('Start recording')
    expect(fixture.share.mock.calls.every((args) => args[0] === undefined)).toBe(true)
    expect(configure).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Share with local Inspector'))
    await waitFor(() => expect(fixture.share).toHaveBeenCalledWith(true))
    expect(configure).not.toHaveBeenCalled()
  })

  it('does not enable recording on mount and lets the person start it explicitly', async () => {
    render(<DiagnosticsPane />)
    fireEvent.click(await screen.findByText('Start recording'))
    await waitFor(() => expect(configure).toHaveBeenCalledWith({ enabled: true }, 'capture'))
    expect(await screen.findByText('Stop recording')).not.toBeNull()
    expect(screen.getByLabelText('Capture conversation content')).toHaveProperty('checked', false)
  })

  it('keeps diagnostic controls off the paired browser surface', () => {
    fixture.desktop = false
    render(<DiagnosticsPane />)
    expect(screen.getByText('Open this page on the desktop')).not.toBeNull()
    expect(fixture.connect).not.toHaveBeenCalled()
  })

  it('stops recording before copying the bounded evidence window', async () => {
    render(<DiagnosticsPane />)
    fireEvent.click(await screen.findByText('Copy events'))
    await waitFor(() => expect(copy).toHaveBeenCalledOnce())
    expect(configure).toHaveBeenCalledWith({ enabled: false }, 'capture')
    const copied: unknown = JSON.parse(copy.mock.calls[0]?.[0] ?? '{}')
    expect(copied).toMatchObject({ format: 'project-studio.diagnostics', version: 1, events: [{ eventId: 'event' }] })
    expect(await screen.findByText('Copied')).not.toBeNull()
  })
})
