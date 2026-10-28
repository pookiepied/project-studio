/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ProviderConnection, ProviderModel } from '@/platform/harness'
import { VoiceModelSetting } from './VoiceModelSetting'
import { voiceModelSetting } from '@/features/voice/settings'

vi.mock('@/features/voice/settings', () => ({
  voiceModelSetting: vi.fn(async () => ({ ok: true, value: { modelId: null } })),
}))

const connection = { id: 'openrouter', catalogProvider: 'openrouter', serves: { language: {} } } as unknown as ProviderConnection
const model = (modelId: string, displayName: string) => ({
  connectionId: 'openrouter', modelId, displayName, available: true, hidden: false,
  capability: { textGeneration: 'supported' },
}) as unknown as ProviderModel

describe('VoiceModelSetting', () => {
  afterEach(() => { cleanup() })

  it('filters the voice model picker by name or id', async () => {
    render(<VoiceModelSetting connections={[connection]} models={[
      model('nvidia/nemotron-3.5-lightning', 'Nemotron 3.5 Lightning'),
      model('deepseek/deepseek-v4.1-flash', 'DeepSeek V4.1 Flash'),
    ]} />)
    const trigger = screen.getByText('Choose').closest('button') as HTMLButtonElement
    await waitFor(() => { expect(trigger.disabled).toBe(false) })
    fireEvent.click(trigger)
    fireEvent.change(screen.getByPlaceholderText('Search models'), { target: { value: 'nemotron' } })
    expect(screen.getByText('Nemotron 3.5 Lightning')).toBeTruthy()
    expect(screen.queryByText('DeepSeek V4.1 Flash')).toBeNull()
    fireEvent.change(screen.getByPlaceholderText('Search models'), { target: { value: 'deepseek/' } })
    expect(screen.getByText('DeepSeek V4.1 Flash')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('Search models'), { target: { value: 'zzz' } })
    expect(screen.getByText('No model by that name.')).toBeTruthy()
  })

  it('offers the voice-task model with the chat\'s own as the default, saves it under its role, and says a refusal', async () => {
    const setting = vi.mocked(voiceModelSetting)
    render(<VoiceModelSetting role="tasks" connections={[connection]} models={[model('acme/talker', 'Talker')]} />)
    expect(screen.getByText('Voice tasks')).toBeTruthy()
    expect(screen.getByText('Same as the chat (default)')).toBeTruthy()
    await waitFor(() => { expect(setting).toHaveBeenCalledWith(undefined, 'tasks') })
    setting.mockResolvedValueOnce({ ok: false, error: { message: 'That model cannot call tools, and voice tasks work through tools.' } } as never)
    const trigger = screen.getByText('Choose').closest('button') as HTMLButtonElement
    await waitFor(() => { expect(trigger.disabled).toBe(false) })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByText('Talker'))
    await waitFor(() => { expect(setting).toHaveBeenLastCalledWith({ modelId: 'openrouter/acme/talker' }, 'tasks') })
    expect(await screen.findByRole('status')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('cannot call tools')
  })
})
