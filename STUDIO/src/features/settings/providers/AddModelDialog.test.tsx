/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AddModelDialog } from './AddModelDialog'
import type { ModelFacts } from '@/platform/harness'
import type { ManualModelInput } from '@/platform/harness/client'

/**
 * The form asks the catalog about the slug and fills what it learns into the
 * fields the person has left alone. What is pinned: the numbers arrive, a
 * number the person typed first is kept, an unlisted slug says so, and an
 * empty window says what it costs.
 */

const GLM: ModelFacts = {
  found: true,
  entries: 4,
  contextWindow: 1_000_000,
  maxOutputTokens: 131_072,
  reasoning: true,
  reasoningLevels: ['low', 'medium', 'high'],
  vision: true,
}

function mount(lookup: (modelId: string) => Promise<ModelFacts | null>) {
  const added: ManualModelInput[] = []
  render(
    <AddModelDialog
      open
      onClose={() => undefined}
      connectionName="DevPass"
      onLookup={lookup}
      onAdd={(model) => {
        added.push(model)
        return Promise.resolve(null)
      }}
    />,
  )
  return added
}

function field(label: string): HTMLInputElement {
  return screen.getByLabelText<HTMLInputElement>(label)
}

afterEach(cleanup)

describe('AddModelDialog', () => {
  it('fills the window, the output cap and the capabilities from the catalog', async () => {
    const lookup = vi.fn(() => Promise.resolve(GLM))
    const added = mount(lookup)

    fireEvent.change(field('Model id (slug)'), { target: { value: 'glm-5.3-flash' } })
    await waitFor(() => expect(field('Context window').value).toBe('1000000'))
    expect(lookup).toHaveBeenCalledWith('glm-5.3-flash')
    expect(field('Max output tokens').value).toBe('131072')
    expect(field('Reasoning').checked).toBe(true)
    expect(field('Vision').checked).toBe(true)
    expect(screen.getByText(/Filled from 4 catalog entries/)).toBeTruthy()
    // The note about a missing window is gone once there is one.
    expect(screen.queryByText(/Without a context window/)).toBeNull()

    fireEvent.change(field('Display name'), { target: { value: 'GLM 5.3 Flash' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add model' }))
    await waitFor(() => expect(added).toHaveLength(1))
    expect(added[0]?.capability?.contextWindow).toBe(1_000_000)
    expect(added[0]?.reasoningLevels).toEqual(['low', 'medium', 'high'])
  })

  it('keeps a number the person typed before the catalog answered', async () => {
    let answer: (facts: ModelFacts) => void = () => undefined
    const lookup = () => new Promise<ModelFacts>((resolve) => (answer = resolve))
    mount(lookup)

    fireEvent.change(field('Context window'), { target: { value: '32000' } })
    fireEvent.change(field('Model id (slug)'), { target: { value: 'glm-5.3-flash' } })
    await waitFor(() => expect(screen.queryByText(/Filled from/)).toBeNull())
    // Let the debounce fire, then answer.
    await new Promise((resolve) => setTimeout(resolve, 400))
    answer(GLM)
    await waitFor(() => expect(screen.getByText(/Filled from 4 catalog entries/)).toBeTruthy())
    expect(field('Context window').value).toBe('32000')
    expect(field('Max output tokens').value).toBe('131072')
  })

  it('says when the catalog has never heard of the slug, and what an empty window costs', async () => {
    mount(() => Promise.resolve({ found: false }))
    expect(screen.getByText(/Without a context window/)).toBeTruthy()
    fireEvent.change(field('Model id (slug)'), { target: { value: 'my-finetune' } })
    await waitFor(() => expect(screen.getByText(/Not in the catalog/)).toBeTruthy())
    expect(field('Context window').value).toBe('')
  })
})
