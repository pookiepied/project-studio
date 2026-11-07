/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { JobsPanel } from './JobsPanel'
import type { BackgroundJob } from '@/platform/harness'

/**
 * The background commands, as a person sees them.
 *
 * The pill answers "is it still going" and the panel answers "what did it say"
 * and "make it stop". The assertions below fail if either grows past that: no
 * timings, no resource figures, no filters. A person did not start these
 * processes, and a number they would have to interpret about one is worse than
 * no number.
 */

afterEach(() => {
  cleanup()
})

function job(overrides: Partial<BackgroundJob> = {}): BackgroundJob {
  return {
    id: 'job_ab1',
    command: 'npm run dev',
    title: null,
    state: 'running',
    exitCode: null,
    startedAt: 1,
    endedAt: null,
    output: 'listening on 3000',
    dropped: 0,
    ...overrides,
  }
}

let server: readonly BackgroundJob[]
const list = vi.fn<() => Promise<{ ok: true; value: readonly BackgroundJob[] }>>()
const stopJob = vi.fn(async (_conversationId: string, jobId: string) => {
  const stopped = server.find((entry) => entry.id === jobId)
  server = server.map((entry) =>
    entry.id === jobId ? { ...entry, state: 'stopped' as const, endedAt: 5 } : entry,
  )
  return {
    ok: true as const,
    value: stopped === undefined ? null : { ...stopped, state: 'stopped' as const, endedAt: 5 },
  }
})

vi.mock('@/stores/workspace', () => ({
  useWorkspace: () => ({
    backgroundJobs: {
      list: () => list(),
      stop: (conversationId: string, jobId: string) => stopJob(conversationId, jobId),
    },
  }),
}))

beforeEach(() => {
  server = [job()]
  list.mockImplementation(async () => ({ ok: true as const, value: server }))
})

describe('the background commands panel', () => {
  it('shows the command, its state and its output', async () => {
    render(<JobsPanel conversationId="cnv_x" />)

    await screen.findByText('npm run dev')
    expect(screen.getByText('Running')).toBeTruthy()
    // The output is the reason the job is in the list; it is not behind a
    // disclosure.
    expect(screen.getByText('listening on 3000')).toBeTruthy()
  })

  it('says how many lines scrolled off the tail', async () => {
    server = [job({ dropped: 120 })]
    render(<JobsPanel conversationId="cnv_x" />)

    // A tail that silently begins mid-stream reads as the whole output.
    await screen.findByText('120 earlier lines dropped')
  })

  it('stops a running command, and stops offering to', async () => {
    render(<JobsPanel conversationId="cnv_x" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }))

    await waitFor(() => expect(screen.getByText('Stopped')).toBeTruthy())
    expect(stopJob).toHaveBeenCalledWith('cnv_x', 'job_ab1')
    // There is nothing left to stop, so the control goes rather than sitting
    // there doing nothing.
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
  })

  it('names a non-zero exit rather than calling it finished', async () => {
    server = [job({ state: 'exited', exitCode: 1, endedAt: 5, output: 'EADDRINUSE' })]
    render(<JobsPanel conversationId="cnv_x" />)

    await screen.findByText('Exited 1')
  })

  it('says plainly when the conversation has none', async () => {
    server = []
    render(<JobsPanel conversationId="cnv_x" />)

    await screen.findByText('Nothing is running in the background for this conversation.')
  })
})
