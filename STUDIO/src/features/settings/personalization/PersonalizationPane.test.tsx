/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { PersonalizationPane } from './PersonalizationPane'

/**
 * The pane, from the env vars down to the request, like the Library pane's
 * test: the harness's answers come from a stubbed `fetch` and everything
 * between is the code the window runs. What is pinned: the profile saves
 * what was typed, the switch writes the setting, a memory is added with its
 * kind and priority, and select mode deletes several in one request.
 */

const BASE_URL = 'http://127.0.0.1:4319'

interface Call {
  readonly url: string
  readonly method: string
  readonly body: string | null
}

function memory(id: string, content: string): Record<string, unknown> {
  return {
    id,
    scope: 'personal',
    projectId: null,
    kind: 'preference',
    content,
    tags: [],
    priority: 2,
    author: 'model',
    sourceConversationId: 'conv-1',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  }
}

const PROFILE = { name: '', preferredName: '', about: '', replyStyle: '' }

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
}

function serveMemory(items: readonly Record<string, unknown>[]): Call[] {
  vi.stubEnv('VITE_HARNESS_BASE_URL', BASE_URL)
  vi.stubEnv('VITE_HARNESS_TOKEN', 'a-test-credential')
  const calls: Call[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = input instanceof URL ? input.toString() : typeof input === 'string' ? input : input.url
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? init.body : null
    calls.push({ url, method, body })
    if (url.includes('/api/memory/profile')) {
      return jsonResponse({ profile: method === 'PUT' && body !== null ? { ...PROFILE, ...JSON.parse(body) } : PROFILE })
    }
    if (url.includes('/api/memory/settings')) {
      return jsonResponse({ settings: { enabled: method === 'PUT' && body !== null ? JSON.parse(body).enabled : true } })
    }
    if (url.includes('/api/memory/items/forget')) return jsonResponse({ results: [{ ok: true }, { ok: true }] })
    if (url.includes('/api/memory/items') && method === 'POST') {
      return jsonResponse({ results: [{ ok: true, existed: false, item: memory('mem_new', 'Drinks tea') }] })
    }
    if (url.includes('/api/memory/items')) return jsonResponse({ items, total: items.length })
    return new Response(null, { status: 404 })
  }
  vi.stubGlobal('fetch', fetch)
  return calls
}

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('PersonalizationPane', () => {
  it('saves the profile that was typed', async () => {
    const calls = serveMemory([])
    render(<PersonalizationPane />)
    const field = await screen.findByRole('textbox', { name: 'What should Studio call you?' })
    fireEvent.change(field, { target: { value: 'Sam' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    await waitFor(() => {
      const put = calls.find((call) => call.method === 'PUT' && call.url.endsWith('/api/memory/profile'))
      expect(put).toBeDefined()
      expect(JSON.parse(put?.body ?? '{}').preferredName).toBe('Sam')
    })
  })

  it('switches memory off for new conversations', async () => {
    const calls = serveMemory([])
    render(<PersonalizationPane />)
    fireEvent.click(await screen.findByRole('switch', { name: 'Use memory in new conversations' }))
    await waitFor(() => {
      const put = calls.find((call) => call.method === 'PUT' && call.url.endsWith('/api/memory/settings'))
      expect(JSON.parse(put?.body ?? '{}')).toEqual({ enabled: false })
    })
  })

  it('adds a memory with its kind and priority', async () => {
    const calls = serveMemory([])
    render(<PersonalizationPane />)
    await screen.findByText('Nothing remembered yet.')
    fireEvent.click(screen.getByRole('button', { name: 'Add memory' }))
    fireEvent.change(screen.getByPlaceholderText(/One short statement/), { target: { value: 'Drinks tea' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Fact' }))
    fireEvent.click(screen.getByRole('radio', { name: 'High' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => {
      const post = calls.find((call) => call.method === 'POST' && call.url.endsWith('/api/memory/items'))
      expect(JSON.parse(post?.body ?? '{}').items).toEqual([
        { content: 'Drinks tea', kind: 'fact', priority: 3, scope: 'personal', projectId: null, tags: [] },
      ])
    })
  })

  it('deletes several selected memories in one request', async () => {
    const calls = serveMemory([memory('mem_a', 'Likes dark themes'), memory('mem_b', 'Uses pnpm')])
    render(<PersonalizationPane />)
    await screen.findByText('Likes dark themes')
    fireEvent.click(screen.getByRole('button', { name: 'Select' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Likes dark themes' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Uses pnpm' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete 2' }))
    await waitFor(() => {
      const forget = calls.filter((call) => call.url.endsWith('/api/memory/items/forget'))
      expect(forget).toHaveLength(1)
      expect(JSON.parse(forget[0]?.body ?? '{}')).toEqual({ ids: ['mem_a', 'mem_b'] })
    })
  })
})
