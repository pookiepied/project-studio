// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { McpServerRecord } from '@/platform/harness'
import { useMcpServers } from './useMcpServers'

const { connect } = vi.hoisted(() => ({ connect: vi.fn() }))
vi.mock('@/platform/harness', () => ({ useHarnessClient: () => connect }))

it('refreshes a starting server through its handshake and stops polling when ready', async () => {
  const server: McpServerRecord = {
    id: 'studio-chrome', title: 'Chrome DevTools by Studio', description: '', provenance: 'system',
    transport: 'stdio', args: [], env: {}, auth: 'none', needsNetwork: true, enabledByDefault: true,
  }
  const starting = { state: 'starting', attempts: 0, diagnostics: [] } as const
  const ready = { state: 'ready', era: 'modern', protocolVersion: '2026-07-28', attempts: 0, diagnostics: [] } as const
  const listMcpServers = vi.fn()
    .mockResolvedValueOnce({ ok: true, value: [{ ...server, status: starting }] })
    .mockResolvedValueOnce({ ok: true, value: [{ ...server, status: ready }] })
  connect.mockResolvedValue({ listMcpServers })
  vi.useFakeTimers()
  const { result, unmount } = renderHook(() => useMcpServers())
  try {
    await act(async () => {})
    expect(result.current.view).toMatchObject({ status: 'ready', servers: [{ status: starting }] })
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(result.current.view).toMatchObject({ status: 'ready', servers: [{ status: ready }] })
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000) })
    expect(listMcpServers).toHaveBeenCalledTimes(2)
  } finally {
    unmount()
    vi.useRealTimers()
  }
})
