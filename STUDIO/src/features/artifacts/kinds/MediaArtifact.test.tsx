/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Artifact } from '@/domain/artifacts/types'
import { MediaArtifact } from './MediaArtifact'

vi.mock('@/stores/navigation', () => ({ useNavigation: () => ({ route: { kind: 'home' } }) }))
vi.mock('@/stores/workspace', () => ({ useWorkspace: () => ({ conversations: [] }) }))
afterEach(cleanup)

const artifact: Artifact = {
  id: 'flowers', kind: 'image_generation', title: 'Flowers', status: 'done',
  data: { url: 'data:image/png;base64,AAAA', prompt: 'A white flower.' },
}

describe('saving generated pictures', () => {
  it('offers a text-free control inside the picture without opening the image on save', () => {
    const keep = vi.fn()
    render(<MediaArtifact artifact={artifact} video={false} onKeep={keep} />)
    const save = screen.getByRole('button', { name: 'Keep in the library' })
    const open = screen.getByRole('button', { name: 'Open Flowers' })
    expect(save.textContent).toBe('')
    expect(open.parentElement?.contains(save)).toBe(true)
    fireEvent.click(save)
    expect(keep).toHaveBeenCalledWith(expect.objectContaining({ url: artifact.data?.['url'] }), 0)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(open)
    expect(screen.getByRole('dialog', { name: 'Flowers' })).toBeTruthy()
  })

  it('keeps each action attached to its own picture in a multiple-output artifact', () => {
    const outputs = [{ url: 'data:image/png;base64,AAAA' }, { url: 'data:image/png;base64,BBBB' }]
    const keep = vi.fn()
    render(<MediaArtifact artifact={{ ...artifact, data: { outputs } }} video={false} onKeep={keep} />)
    const save = screen.getByRole('button', { name: 'Keep 2 in the library' })
    const open = screen.getByRole('button', { name: 'Open Flowers (2 of 2)' })
    expect(open.parentElement?.contains(save)).toBe(true)
    fireEvent.click(save)
    expect(keep).toHaveBeenCalledWith(expect.objectContaining(outputs[1]), 1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
